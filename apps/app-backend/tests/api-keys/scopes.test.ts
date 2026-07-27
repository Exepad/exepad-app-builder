/**
 * Tests for API key scope checking — hasScope, buildCrudScope, buildHandlerScope.
 */

import { describe, it, expect } from 'vitest';
import {
  hasScope,
  buildCrudScope,
  buildHandlerScope,
  isValidScope,
} from '../../src/auth/api-keys';

describe('hasScope', () => {
  it('wildcard grants everything', () => {
    expect(hasScope(['*'], 'model:contacts:create')).toBe(true);
    expect(hasScope(['*'], 'handler:getStats')).toBe(true);
    expect(hasScope(['*'], 'anything')).toBe(true);
  });

  it('exact match grants access', () => {
    expect(hasScope(['model:contacts:create'], 'model:contacts:create')).toBe(true);
    expect(hasScope(['handler:getStats'], 'handler:getStats')).toBe(true);
  });

  it('non-matching scope denies access', () => {
    expect(hasScope(['model:contacts:read'], 'model:contacts:create')).toBe(false);
    expect(hasScope(['handler:getStats'], 'handler:otherHandler')).toBe(false);
  });

  it('empty scopes deny access', () => {
    expect(hasScope([], 'model:contacts:read')).toBe(false);
  });

  it('multiple scopes checked (any match)', () => {
    const scopes = ['model:contacts:read', 'model:contacts:create', 'handler:getStats'];
    expect(hasScope(scopes, 'model:contacts:create')).toBe(true);
    expect(hasScope(scopes, 'handler:getStats')).toBe(true);
    expect(hasScope(scopes, 'model:contacts:delete')).toBe(false);
  });

  it('different model same operation denied', () => {
    expect(hasScope(['model:orders:read'], 'model:contacts:read')).toBe(false);
  });
});

describe('buildCrudScope', () => {
  it('builds model:name:operation format', () => {
    expect(buildCrudScope('contacts', 'create')).toBe('model:contacts:create');
    expect(buildCrudScope('contacts', 'read')).toBe('model:contacts:read');
    expect(buildCrudScope('contacts', 'list')).toBe('model:contacts:list');
    expect(buildCrudScope('contacts', 'update')).toBe('model:contacts:update');
    expect(buildCrudScope('contacts', 'delete')).toBe('model:contacts:delete');
  });

  it('works with different model names', () => {
    expect(buildCrudScope('orders', 'read')).toBe('model:orders:read');
    expect(buildCrudScope('user_settings', 'update')).toBe('model:user_settings:update');
  });
});

describe('buildHandlerScope', () => {
  it('builds handler:name format', () => {
    expect(buildHandlerScope('getStats')).toBe('handler:getStats');
    expect(buildHandlerScope('processData')).toBe('handler:processData');
  });
});

describe('isValidScope', () => {
  it('accepts wildcard', () => {
    expect(isValidScope('*')).toBe(true);
  });

  it('accepts valid model scopes', () => {
    expect(isValidScope('model:contacts:create')).toBe(true);
    expect(isValidScope('model:contacts:read')).toBe(true);
    expect(isValidScope('model:contacts:list')).toBe(true);
    expect(isValidScope('model:contacts:update')).toBe(true);
    expect(isValidScope('model:contacts:delete')).toBe(true);
    expect(isValidScope('model:user_settings:read')).toBe(true);
  });

  it('accepts valid handler scopes', () => {
    expect(isValidScope('handler:getStats')).toBe(true);
    expect(isValidScope('handler:process_data')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidScope('')).toBe(false);
    expect(isValidScope('random')).toBe(false);
    expect(isValidScope('model:contacts')).toBe(false);
    expect(isValidScope('model:contacts:unknown_op')).toBe(false);
    expect(isValidScope('handler:')).toBe(false);
    expect(isValidScope('model::read')).toBe(false);
  });
});
