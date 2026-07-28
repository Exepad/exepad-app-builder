/**
 * SettingsPage — Stock images tab (single active provider) interaction tests.
 *
 * Drives the redesigned tab end-to-end in happy-dom: each provider is a box with
 * an active/inactive slider, exactly one is active, Openverse is the keyless
 * default, and turning a keyed provider ON reveals its REQUIRED key field.
 * Asserts: the boxes render, Openverse is active + keyless, activating a keyed
 * provider swaps in only its field, Save is blocked until an active keyed
 * provider has a key, and the saved payload is the single-provider shape
 * (`images: { provider, [selected]: { apiKey } }`) — never de-selected keys.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecretView, StudioSettings, SettingsInput } from '@/services/StudioStream';

const getSettings = vi.fn();
const saveSettings = vi.fn();
const getProviderModels = vi.fn();

vi.mock('@/services/StudioStream', () => ({
  getSettings: (...a: unknown[]) => getSettings(...a),
  saveSettings: (...a: unknown[]) => saveSettings(...a),
  getProviderModels: (...a: unknown[]) => getProviderModels(...a),
  // UpdateBanner probe (imported by SettingsPage): resolve null = "no banner",
  // keeping these panel tests independent of the update-check feature.
  getUpdateCheck: vi.fn(async () => null),
}));

import SettingsPage from '@/pages/SettingsPage';

const unset: SecretView = { set: false, source: 'none', hint: '' };

function settingsWith(provider: StudioSettings['images']['provider']): StudioSettings {
  return {
    llm: { provider: 'openrouter', model: '', baseUrl: '', apiKey: unset },
    images: {
      provider,
      keepLlmUrls: true,
      pexels: { apiKey: unset },
      unsplash: { apiKey: unset },
      pixabay: { apiKey: unset },
    },
  };
}

async function renderImagesTab(provider: StudioSettings['images']['provider'] = 'openverse') {
  getSettings.mockResolvedValue(settingsWith(provider));
  getProviderModels.mockResolvedValue([]);
  saveSettings.mockResolvedValue({ ok: true });

  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );

  // Wait out the initial getSettings() load, then open the Stock images tab.
  const navButton = await screen.findByRole('button', { name: /Stock images/i });
  fireEvent.click(navButton);
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /Save settings/i }));
const toggle = (name: string) =>
  fireEvent.click(screen.getByRole('switch', { name: new RegExp(`Activate ${name}`, 'i') }));

beforeEach(() => {
  getSettings.mockReset();
  saveSettings.mockReset();
  getProviderModels.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Settings — Stock images tab (single provider, slider boxes)', () => {
  it('renders four provider boxes with Openverse active + keyless (no key field)', async () => {
    await renderImagesTab('openverse');

    for (const name of ['Openverse', 'Pexels', 'Unsplash', 'Pixabay']) {
      expect(screen.getByRole('switch', { name: new RegExp(`Activate ${name}`, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByRole('switch', { name: /Activate Openverse/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Activate Pexels/i })).not.toBeChecked();
    // Keyless: the contextual key input (id="imageKey") is not mounted at all.
    expect(document.getElementById('imageKey')).toBeNull();
    expect(screen.getByText(/searches Creative-Commons imagery/i)).toBeInTheDocument();
  });

  it('reveals only the active keyed provider’s key field, swapping on toggle', async () => {
    await renderImagesTab('openverse');

    toggle('Pexels');
    expect(screen.getByRole('switch', { name: /Activate Pexels/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Activate Openverse/i })).not.toBeChecked();
    expect(screen.getByLabelText(/Pexels API key/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Unsplash API key/i)).not.toBeInTheDocument();

    // Activating another provider swaps the single field — never stacks them.
    toggle('Unsplash');
    expect(screen.getByLabelText(/Unsplash API key/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Pexels API key/i)).not.toBeInTheDocument();
  });

  it('toggling the active provider off falls back to keyless Openverse', async () => {
    await renderImagesTab('openverse');
    toggle('Pixabay');
    expect(screen.getByRole('switch', { name: /Activate Pixabay/i })).toBeChecked();
    toggle('Pixabay'); // turn the active one off → default
    expect(screen.getByRole('switch', { name: /Activate Openverse/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Activate Pixabay/i })).not.toBeChecked();
  });

  it('requires an API key before an active keyed provider can be saved', async () => {
    await renderImagesTab('openverse');

    toggle('Pexels'); // active, but no key entered
    save();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/required while Pexels is the active provider/i),
    ).toBeInTheDocument();

    // Entering the key unblocks the save.
    fireEvent.change(screen.getByLabelText(/Pexels API key/i), { target: { value: 'px-typed-key' } });
    save();
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    const input = saveSettings.mock.calls[0][0] as SettingsInput;
    expect(input.images?.provider).toBe('pexels');
    expect(input.images?.pexels?.apiKey).toBe('px-typed-key');
    // De-selected providers must not be sent to the agent.
    expect(input.images?.unsplash).toBeUndefined();
    expect(input.images?.pixabay).toBeUndefined();
  });

  it('keeps LLM image URLs on by default and carries keepLlmUrls: true on save', async () => {
    await renderImagesTab('openverse');

    expect(screen.getByRole('switch', { name: /Let the AI pick image URLs/i })).toBeChecked();

    save();
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect((saveSettings.mock.calls[0][0] as SettingsInput).images?.keepLlmUrls).toBe(true);
  });

  it('turning off the LLM-image-URL toggle carries keepLlmUrls: false on save', async () => {
    await renderImagesTab('openverse');

    const llmSwitch = screen.getByRole('switch', { name: /Let the AI pick image URLs/i });
    fireEvent.click(llmSwitch);
    expect(llmSwitch).not.toBeChecked();

    save();
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect((saveSettings.mock.calls[0][0] as SettingsInput).images?.keepLlmUrls).toBe(false);
  });

  it('saves keyless openverse with no provider keys', async () => {
    await renderImagesTab('pexels');

    toggle('Openverse'); // switch away from the keyed provider
    save();

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    const input = saveSettings.mock.calls[0][0] as SettingsInput;
    expect(input.images?.provider).toBe('openverse');
    expect(input.images?.pexels).toBeUndefined();
    expect(input.images?.unsplash).toBeUndefined();
    expect(input.images?.pixabay).toBeUndefined();
  });
});
