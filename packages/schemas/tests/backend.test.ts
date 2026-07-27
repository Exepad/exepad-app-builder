/**
 * Unit tests for backend config JSON Schema validation
 */

import { describe, it, expect } from 'vitest';
import { validateBackendProps } from '../src/validator';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Use the new name throughout
const validateBackendConfig = validateBackendProps;

describe('validateBackendProps', () => {
  describe('static backend', () => {
    it('accepts minimal static backend', () => {
      const result = validateBackendConfig({
        mode: 'static',
        data: { datasets: {} },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts static backend with datasets', () => {
      const result = validateBackendConfig({
        mode: 'static',
        data: {
          datasets: {
            contacts: {
              type: 'static',
              records: [{ id: 1, name: 'Alice' }],
              generated: true,
            },
          },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts static backend with dataset schema and _meta', () => {
      const result = validateBackendConfig({
        mode: 'static',
        data: {
          datasets: {
            products: {
              type: 'static',
              records: [{ id: 1, name: 'Widget', price: 9.99 }],
              schema: {
                fields: [
                  { name: 'id', type: 'number' },
                  { name: 'name', type: 'string' },
                ],
                primaryKey: 'id',
              },
              generated: false,
              generationHint: 'e-commerce products',
              _meta: { totalCount: 100, truncated: true, sourceHint: 'from seed' },
            },
          },
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('dynamic backend - valid configs', () => {
    it('accepts minimal model config', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'model-1',
            name: 'items',
            columns: [{ name: 'id', type: 'integer' }],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts full model config with all optional fields', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'model-1',
            name: 'items',
            summary: 'A test model',
            columns: [
              { name: 'id', type: 'integer', isPrimary: true },
              {
                name: 'parent_id',
                type: 'integer',
                isNullable: true,
                references: { model: 'parents', column: 'id', onDelete: 'cascade' },
              },
              { name: 'data', type: 'json', isNullable: true },
            ],
            indexes: [{ name: 'idx_items_parent', columns: ['parent_id'] }],
            crudPolicy: { create: 'authenticated', read: 'public', update: 'admin', delete: 'admin', list: 'public' },
            migrationPolicy: 'safe',
            softDelete: true,
            ownerScope: 'shared',
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid handler config', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        handlers: [
          {
            uuid: 'h-1',
            name: 'getDashboard',
            authLevel: 'authenticated',
            inputs: [{ name: 'period', type: 'string' }],
            outputs: [{ name: 'revenue', type: 'number' }],
            method: 'getDashboard',
            summary: 'Dashboard stats',
            allowedSources: ['orders'],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts complete backend config with models and handlers', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'model-1',
            name: 'contacts',
            columns: [
              { name: 'id', type: 'integer', isPrimary: true },
              { name: 'name', type: 'text' },
            ],
          },
        ],
        handlers: [
          {
            uuid: 'h-1',
            name: 'exportContacts',
            authLevel: 'admin',
            inputs: [],
            outputs: [{ name: 'csv', type: 'string' }],
            method: 'exportContacts',
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts dynamic backend with only mode field', () => {
      const result = validateBackendConfig({ mode: 'dynamic' });
      expect(result.valid).toBe(true);
    });

    // ── AccessLevel parity with @exepad/types (backend.ts AccessLevel) ──
    it.each(['public', 'authenticated', 'owner', 'none', 'admin', 'role:editor', 'role:super-admin_2'])(
      'accepts crudPolicy authLevel "%s"',
      (level) => {
        const result = validateBackendConfig({
          mode: 'dynamic',
          models: [
            {
              uuid: 'm1',
              name: 'items',
              columns: [{ name: 'id', type: 'integer' }],
              crudPolicy: { read: level },
            },
          ],
        });
        expect(result.valid).toBe(true);
      }
    );

    it('rejects malformed role: authLevel', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'id', type: 'integer' }],
            crudPolicy: { read: 'role:has space' },
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('accepts column enumValues', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'status', type: 'text', enumValues: ['open', 'closed'] }],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts model autoExpandFKs and expandSelect', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'id', type: 'integer' }],
            autoExpandFKs: false,
            expandSelect: ['name'],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts handler with handlerType and role authLevel', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        handlers: [
          {
            uuid: 'h-1',
            name: 'listReports',
            authLevel: 'role:analyst',
            inputs: [],
            outputs: [{ name: 'rows', type: 'array', items: 'json' }],
            method: 'listReports',
            handlerType: 'read',
          },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  // Guards against the hand-written schema drifting from the types the agent
  // emits: every real example backend must pass validateBackendProps.
  describe('real agent example backends', () => {
    const examplesDir = resolve(__dirname, '../data/examples/backend');
    const files = readdirSync(examplesDir).filter((f) => f.endsWith('.json'));

    it('has example backends to validate', () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('validates example backend %s', (file) => {
      const app = JSON.parse(readFileSync(resolve(examplesDir, file), 'utf-8'));
      const result = validateBackendConfig(app.backend);
      if (!result.valid) {
        // Surface the offending errors in the failure message.
        throw new Error(`${file} failed: ${JSON.stringify(result.errors, null, 2)}`);
      }
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid configs', () => {
    it('rejects backend config without mode field', () => {
      const result = validateBackendConfig({});
      expect(result.valid).toBe(false);
    });

    it('rejects backend config with unknown mode', () => {
      const result = validateBackendConfig({ mode: 'hybrid' });
      expect(result.valid).toBe(false);
    });

    it('rejects static backend with models (mixing modes)', () => {
      const result = validateBackendConfig({
        mode: 'static',
        data: { datasets: {} },
        models: [],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects dynamic backend with data field (mixing modes)', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        data: { datasets: {} },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects model missing uuid', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [{ name: 'items', columns: [{ name: 'id', type: 'integer' }] }],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects model missing name', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [{ uuid: 'm1', columns: [{ name: 'id', type: 'integer' }] }],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects model missing columns', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [{ uuid: 'm1', name: 'items' }],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid column type', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'id', type: 'varchar' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid model name pattern', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'has-dash',
            columns: [{ name: 'id', type: 'integer' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects model name starting with number', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: '123abc',
            columns: [{ name: 'id', type: 'integer' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid authLevel enum value', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'id', type: 'integer' }],
            crudPolicy: { read: 'superuser' },
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid ownerScope value', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'id', type: 'integer' }],
            ownerScope: 'global',
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid onDelete value', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [
              { name: 'id', type: 'integer' },
              { name: 'ref', type: 'integer', references: { model: 'other', column: 'id', onDelete: 'drop' } },
            ],
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects additional unknown properties on model', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'id', type: 'integer' }],
            unknownProp: true,
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects handler missing required fields', () => {
      const result = validateBackendConfig({
        mode: 'dynamic',
        handlers: [{ uuid: 'h1', name: 'test' }],
      });
      expect(result.valid).toBe(false);
    });

  });

  describe('none backend', () => {
    it('accepts none backend', () => {
      const result = validateBackendConfig({
        mode: 'none',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects none backend with extra properties', () => {
      const result = validateBackendConfig({
        mode: 'none',
        models: [],
      });
      expect(result.valid).toBe(false);
    });
  });

  // Example config validation removed — backend-crud example was deleted during UI component removal
});
