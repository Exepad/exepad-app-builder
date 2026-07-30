/**
 * LlmKeyGate — the studio's "no AI provider key yet" state.
 *
 * Without a key the agent cannot build anything, so the studio's preview pane
 * used to promise a preview ("Your preview will appear here.") that could never
 * arrive: a prompt started a build that planned, failed several steps deep, and
 * reported "the agent reported a failure" — naming neither the key nor the fix.
 *
 * Asserts: the FULL provider form renders (every provider, not just
 * OpenRouter), the payload carries the chosen provider, blank optional fields
 * are omitted rather than sent as '', a custom OpenAI-compatible endpoint
 * cannot be saved without its base URL, failures are reported without
 * signalling success, and a successful save notifies the parent.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsInput } from '@/services/StudioStream';
import { PROVIDERS } from '@/components/settings/llm-providers';

const saveSettings = vi.fn();
const getProviderModels = vi.fn();

vi.mock('@/services/StudioStream', () => ({
  saveSettings: (...a: unknown[]) => saveSettings(...a),
  getProviderModels: (...a: unknown[]) => getProviderModels(...a),
}));

import { LlmKeyGate } from '@/components/studio/LlmKeyGate';

function renderGate(onSaved = vi.fn()) {
  render(<LlmKeyGate onSaved={onSaved} />);
  return { onSaved };
}

const keyField = () => screen.getByLabelText(/api key/i) as HTMLInputElement;
const providerSelect = () => screen.getByLabelText(/provider/i) as HTMLSelectElement;
const modelField = () => screen.getByLabelText(/model/i) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /save and start building/i });
const lastPayload = () => saveSettings.mock.calls[0][0] as SettingsInput;

beforeEach(() => {
  saveSettings.mockReset();
  saveSettings.mockResolvedValue({ ok: true });
  getProviderModels.mockReset();
  getProviderModels.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LlmKeyGate', () => {
  it('offers every provider, not just OpenRouter', () => {
    renderGate();
    const options = Array.from(providerSelect().options).map((o) => o.value);
    expect(options).toEqual(PROVIDERS.map((p) => p.value));
    // Guards the regression this test exists for: a gate that silently assumes
    // OpenRouter is useless to anyone holding a Gemini or Anthropic key.
    expect(options).toContain('gemini');
    expect(options).toContain('anthropic');
    expect(options).toContain('openai');
    expect(options).toContain('custom');
  });

  it('renders the provider, key and model fields', () => {
    renderGate();
    expect(providerSelect()).toBeTruthy();
    expect(keyField()).toBeTruthy();
    expect(modelField()).toBeTruthy();
  });

  it('blocks save until a key is entered', () => {
    renderGate();
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(keyField(), { target: { value: 'sk-or-abc123' } });
    expect(saveButton().hasAttribute('disabled')).toBe(false);
  });

  it('does not enable save for whitespace alone', () => {
    renderGate();
    fireEvent.change(keyField(), { target: { value: '   ' } });
    expect(saveButton().hasAttribute('disabled')).toBe(true);
  });

  it('saves the chosen provider, trimmed, and omits blank optionals', async () => {
    const { onSaved } = renderGate();
    fireEvent.change(providerSelect(), { target: { value: 'anthropic' } });
    fireEvent.change(keyField(), { target: { value: '  sk-ant-abc  ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    // No `model`/`baseUrl` keys at all — sending '' would pin the model to empty
    // instead of letting the provider default apply.
    expect(lastPayload()).toEqual({ llm: { provider: 'anthropic', apiKey: 'sk-ant-abc' } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('includes the model when one is given', async () => {
    renderGate();
    fireEvent.change(providerSelect(), { target: { value: 'openai' } });
    fireEvent.change(keyField(), { target: { value: 'sk-abc' } });
    fireEvent.change(modelField(), { target: { value: ' gpt-4o ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toEqual({
      llm: { provider: 'openai', apiKey: 'sk-abc', model: 'gpt-4o' },
    });
  });

  it('requires a base URL for a custom OpenAI-compatible endpoint', async () => {
    renderGate();
    fireEvent.change(providerSelect(), { target: { value: 'custom' } });
    fireEvent.change(keyField(), { target: { value: 'anything' } });
    // A custom endpoint without its URL is unusable, so the key alone is not enough.
    expect(saveButton().hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText(/base url/i), {
      target: { value: 'http://localhost:11434/v1' },
    });
    expect(saveButton().hasAttribute('disabled')).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toEqual({
      llm: {
        provider: 'custom',
        apiKey: 'anything',
        baseUrl: 'http://localhost:11434/v1',
      },
    });
  });

  it('shows the base URL field only for the custom provider', () => {
    renderGate();
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
    fireEvent.change(providerSelect(), { target: { value: 'custom' } });
    expect(screen.queryByLabelText(/base url/i)).not.toBeNull();
  });

  it('loads the OpenRouter catalogue only for OpenRouter', async () => {
    renderGate();
    await waitFor(() => expect(getProviderModels).toHaveBeenCalledWith('openrouter'));
    getProviderModels.mockClear();
    fireEvent.change(providerSelect(), { target: { value: 'gemini' } });
    expect(getProviderModels).not.toHaveBeenCalled();
  });

  it('reports a failed save and does not signal success', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'Invalid key' });
    const { onSaved } = renderGate();
    fireEvent.change(keyField(), { target: { value: 'sk-bad' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid key'));
    expect(onSaved).not.toHaveBeenCalled();
    // The key stays so the user can correct it rather than retype from scratch.
    expect(keyField().value).toBe('sk-bad');
  });

  it('falls back to a generic message when the server gives no reason', async () => {
    saveSettings.mockResolvedValue({ ok: false });
    renderGate();
    fireEvent.change(keyField(), { target: { value: 'sk-bad' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not save/i));
  });
});
