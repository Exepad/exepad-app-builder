/**
 * Tests for bundle configuration utilities
 */

import { describe, it, expect } from 'vitest';
import {
  extractBackendProps,
  validateInjectedConfig,
} from '../src/bundle/config';
import type { InjectedAppConfig } from '../src/bundle/types';

const SAMPLE_MODEL = {
  uuid: 'm1',
  name: 'tasks',
  summary: 'Task tracker',
  columns: [
    { name: 'id', type: 'integer' as const, isPrimary: true },
    { name: 'title', type: 'text' as const, isNullable: false },
    { name: 'done', type: 'integer' as const, defaultValue: 0 },
  ],
  indexes: [{ name: 'idx_tasks_title', columns: ['title'] }],
  crudPolicy: { create: 'authenticated' as const, read: 'public' as const },
  softDelete: true,
  ownerScope: 'user' as const,
  migrationPolicy: 'safe' as const,
};

const SAMPLE_HANDLER = {
  uuid: 'h1',
  name: 'calculateTotal',
  summary: 'Sums values',
  authLevel: 'authenticated' as const,
  inputs: [{ name: 'items', type: 'json' as const, required: true }],
  outputs: [{ name: 'total', type: 'number' as const }],
  method: 'calculateTotal',
  allowedSources: ['orders'],
};

describe('extractBackendProps', () => {
  it('extracts models and handlers from app config', () => {
    const appConfig = {
      backend: {
        models: [SAMPLE_MODEL],
        handlers: [SAMPLE_HANDLER],
      },
    };

    const result = extractBackendProps(appConfig);
    expect(result.models).toHaveLength(1);
    expect(result.models![0].name).toBe('tasks');
    expect(result.handlers).toHaveLength(1);
    expect(result.handlers![0].name).toBe('calculateTotal');
  });

  it('returns empty arrays when no backend config', () => {
    const result = extractBackendProps({});
    expect(result.models).toEqual([]);
    expect(result.handlers).toEqual([]);
  });

  it('returns empty arrays when backend has no models/handlers', () => {
    const result = extractBackendProps({ backend: {} });
    expect(result.models).toEqual([]);
    expect(result.handlers).toEqual([]);
  });

  it('handles backend with only models', () => {
    const result = extractBackendProps({
      backend: { models: [SAMPLE_MODEL] },
    });
    expect(result.models).toHaveLength(1);
    expect(result.handlers).toEqual([]);
  });

  it('handles backend with only handlers', () => {
    const result = extractBackendProps({
      backend: { handlers: [SAMPLE_HANDLER] },
    });
    expect(result.models).toEqual([]);
    expect(result.handlers).toHaveLength(1);
  });

  it('returns empty arrays for none backend', () => {
    const result = extractBackendProps({
      backend: { mode: 'none' },
    });
    expect(result.models).toEqual([]);
    expect(result.handlers).toEqual([]);
  });

  it('extracts storage config', () => {
    const result = extractBackendProps({
      backend: { models: [SAMPLE_MODEL], storage: { enabled: true, maxFileSize: 5242880 } },
    });
    expect(result.storage).toBeDefined();
    expect(result.storage!.enabled).toBe(true);
  });

  it('preserves storage config for a mode:"none" backend (form app with uploads, no models)', () => {
    // Regression: extractBackendProps used to early-return for mode:"none"
    // before copying `storage`, so file-upload form apps shipped STORAGE_DISABLED
    // (no R2 bucket, no _files table, app-backend /files gate failed). macpmszk, 2026-05-24.
    const result = extractBackendProps({
      backend: {
        mode: 'none',
        storage: { enabled: true, maxFileSize: 26214400, allowedMimeTypes: ['image/*', 'application/pdf'] },
      },
    });
    expect(result.models).toEqual([]);
    expect(result.handlers).toEqual([]);
    expect(result.storage).toBeDefined();
    expect(result.storage!.enabled).toBe(true);
    expect(result.storage!.maxFileSize).toBe(26214400);
  });

  it('leaves storage undefined for a mode:"none" backend without a storage block', () => {
    const result = extractBackendProps({ backend: { mode: 'none' } });
    expect(result.storage).toBeUndefined();
  });
});

describe('validateInjectedConfig', () => {
  it('returns no errors for valid config', () => {
    const config: InjectedAppConfig = {
      models: [SAMPLE_MODEL],
      handlers: [SAMPLE_HANDLER],
    };

    const errors = validateInjectedConfig(config);
    expect(errors).toHaveLength(0);
  });

  it('detects model missing name', () => {
    const config: InjectedAppConfig = {
      models: [{ ...SAMPLE_MODEL, name: '' }],
    };

    const errors = validateInjectedConfig(config);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Model missing name');
  });

  it('detects model with no columns', () => {
    const config: InjectedAppConfig = {
      models: [{ ...SAMPLE_MODEL, columns: [] }],
    };

    const errors = validateInjectedConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('has no columns'));
  });

  it('does NOT reject model with no explicit primary key (auto-added by schema builder)', () => {
    const config: InjectedAppConfig = {
      models: [{
        ...SAMPLE_MODEL,
        columns: [
          { name: 'title', type: 'text' as const },
          { name: 'done', type: 'integer' as const },
        ],
      }],
    };

    const errors = validateInjectedConfig(config);
    expect(errors).not.toContainEqual(expect.stringContaining('no primary key'));
  });

  it('detects handler missing name', () => {
    const config: InjectedAppConfig = {
      handlers: [{ ...SAMPLE_HANDLER, name: '' }],
    };

    const errors = validateInjectedConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('Handler missing name'));
  });

  it('detects handler missing method reference', () => {
    const config: InjectedAppConfig = {
      handlers: [{ ...SAMPLE_HANDLER, method: '' }],
    };

    const errors = validateInjectedConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('missing method'));
  });

  it('validates multiple models and handlers', () => {
    const config: InjectedAppConfig = {
      models: [
        { ...SAMPLE_MODEL, name: '' },
        { ...SAMPLE_MODEL, name: 'valid', columns: [] },
      ],
      handlers: [
        { ...SAMPLE_HANDLER, name: '' },
      ],
    };

    const errors = validateInjectedConfig(config);
    expect(errors.length).toBe(3); // missing name, no columns, handler missing name
  });

  it('returns no errors for empty config', () => {
    const errors = validateInjectedConfig({ models: [], handlers: [] });
    expect(errors).toHaveLength(0);
  });

  it('handles undefined models/handlers', () => {
    const errors = validateInjectedConfig({});
    expect(errors).toHaveLength(0);
  });
});

