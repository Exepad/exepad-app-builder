/**
 * Unit tests for RPC router
 */

import { describe, it, expect, vi } from 'vitest';
import { isCrudMethod } from '../src/rpc/types';
import {
  findModel,
  findHandler,
  validateConfig,
} from '../src/rpc/router';
import type { InjectedProps } from '../src/types/env';

describe('RPC Types', () => {
  describe('isCrudMethod', () => {
    it('returns true for CRUD methods', () => {
      expect(isCrudMethod('sys_create')).toBe(true);
      expect(isCrudMethod('sys_read')).toBe(true);
      expect(isCrudMethod('sys_list')).toBe(true);
      expect(isCrudMethod('sys_update')).toBe(true);
      expect(isCrudMethod('sys_delete')).toBe(true);
    });

    it('returns false for non-CRUD methods', () => {
      expect(isCrudMethod('getDashboardStats')).toBe(false);
      expect(isCrudMethod('sys_custom')).toBe(false);
      expect(isCrudMethod('create')).toBe(false);
      expect(isCrudMethod('')).toBe(false);
    });
  });
});

describe('RPC Router', () => {
  const testConfig: InjectedProps = {
    models: [
      {
        uuid: 'model-1',
        name: 'contacts',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'name', type: 'text' },
        ],
      },
      {
        uuid: 'model-2',
        name: 'orders',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'total', type: 'real' },
        ],
      },
    ],
    handlers: [
      {
        uuid: 'handler-1',
        name: 'getDashboardStats',
        authLevel: 'authenticated',
        inputs: [{ name: 'period', type: 'string' }],
        outputs: [{ name: 'revenue', type: 'number' }],
        method: 'getDashboardStats',
      },
    ],
  };

  describe('validateConfig', () => {
    it('passes through valid models and handlers', () => {
      const config = validateConfig(structuredClone(testConfig), 'test');

      expect(config.models).toHaveLength(2);
      expect(config.handlers).toHaveLength(1);
    });

    it('normalizes non-array models/handlers to empty arrays', () => {
      const config = validateConfig({ models: undefined, handlers: undefined } as unknown as InjectedProps, 'test');

      expect(config.models).toEqual([]);
      expect(config.handlers).toEqual([]);
    });

    it('filters out models with invalid names', () => {
      const configWithBadModel: InjectedProps = {
        models: [
          { uuid: 'ok', name: 'valid_name', columns: [{ name: 'id', type: 'integer', isPrimary: true }] },
          { uuid: 'bad', name: 'has-dash', columns: [{ name: 'id', type: 'integer', isPrimary: true }] },
          { uuid: 'bad2', name: '123start', columns: [{ name: 'id', type: 'integer', isPrimary: true }] },
        ],
        handlers: [],
      };
      const config = validateConfig(configWithBadModel, 'test');

      expect(config.models).toHaveLength(1);
      expect(config.models![0].name).toBe('valid_name');
    });

    it('filters out handlers with invalid names', () => {
      const configWithBadHandler: InjectedProps = {
        models: [],
        handlers: [
          { uuid: 'ok', name: 'valid_handler', authLevel: 'public', inputs: [], outputs: [], method: 'valid_handler' },
          { uuid: 'bad', name: 'has-dash', authLevel: 'public', inputs: [], outputs: [], method: 'bad' },
        ],
      };
      const config = validateConfig(configWithBadHandler, 'test');

      expect(config.handlers).toHaveLength(1);
      expect(config.handlers![0].name).toBe('valid_handler');
    });

    it('warns when public read is combined with user scope', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const configWithMismatch: InjectedProps = {
        models: [
          {
            uuid: 'm1',
            name: 'items',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
            crudPolicy: { read: 'public' },
            // ownerScope defaults to 'user'
          },
        ],
        handlers: [],
      };
      validateConfig(configWithMismatch, 'test');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Public (unauthenticated) reads will return empty')
      );
      warnSpy.mockRestore();
    });
  });

  describe('findModel', () => {
    it('finds model by name', () => {
      const model = findModel(testConfig, 'contacts');

      expect(model).toBeDefined();
      expect(model?.name).toBe('contacts');
      expect(model?.uuid).toBe('model-1');
    });

    it('returns undefined for non-existent model', () => {
      const model = findModel(testConfig, 'nonexistent');

      expect(model).toBeUndefined();
    });
  });

  describe('findHandler', () => {
    it('finds handler by name', () => {
      const handler = findHandler(testConfig, 'getDashboardStats');

      expect(handler).toBeDefined();
      expect(handler?.name).toBe('getDashboardStats');
      expect(handler?.uuid).toBe('handler-1');
    });

    it('returns undefined for non-existent handler', () => {
      const handler = findHandler(testConfig, 'nonexistent');

      expect(handler).toBeUndefined();
    });
  });
});
