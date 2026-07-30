/**
 * JWT Helper Tests
 * Tests for token retrieval, storage, expiration checking, and fallback chain.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getJWTTokenFromWindow,
  getJWTTokenFromStorage,
  setJWTTokenInStorage,
  clearJWTToken,
  getJWTToken,
} from '@/lib/jwt-helper';

/**
 * Helper to create a mock JWT with a specific `exp` timestamp.
 * The signature is fake — only the payload matters for expiration checks.
 */
function createMockJWT(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ exp, sub: 'test-user' }));
  return `${header}.${payload}.mock-signature`;
}

/** Return a valid (non-expired) mock JWT. */
function validJWT(): string {
  return createMockJWT(Math.floor(Date.now() / 1000) + 300); // expires in 5 min
}

describe('jwt-helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset window properties
    if (typeof window !== 'undefined') {
      delete (window as any).__JWT_TOKEN;
      try {
        window.sessionStorage.clear();
      } catch (e) {
        // Ignore if sessionStorage is not available
      }
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Low-level getters/setters ──────────────────────────────────────

  describe('getJWTTokenFromWindow', () => {
    it('should return token from window global', () => {
      (window as any).__JWT_TOKEN = 'test-jwt-token';

      const token = getJWTTokenFromWindow();

      expect(token).toBe('test-jwt-token');
    });

    it('should return undefined when no token in window', () => {
      delete (window as any).__JWT_TOKEN;

      const token = getJWTTokenFromWindow();

      expect(token).toBeUndefined();
    });
  });

  describe('getJWTTokenFromStorage', () => {
    it('should return token from session storage', () => {
      window.sessionStorage.setItem('jwt_token', 'storage-jwt-token');

      const token = getJWTTokenFromStorage();

      expect(token).toBe('storage-jwt-token');
    });

    it('should return undefined when no token in storage', () => {
      window.sessionStorage.removeItem('jwt_token');

      const token = getJWTTokenFromStorage();

      expect(token).toBeUndefined();
    });
  });

  describe('setJWTTokenInStorage', () => {
    it('should set token in session storage', () => {
      setJWTTokenInStorage('new-jwt-token');

      expect(window.sessionStorage.getItem('jwt_token')).toBe('new-jwt-token');
    });

    it('should overwrite existing token', () => {
      window.sessionStorage.setItem('jwt_token', 'old-token');

      setJWTTokenInStorage('new-token');

      expect(window.sessionStorage.getItem('jwt_token')).toBe('new-token');
    });
  });

  describe('clearJWTToken', () => {
    it('should remove token from session storage', () => {
      window.sessionStorage.setItem('jwt_token', 'token-to-clear');

      clearJWTToken();

      expect(window.sessionStorage.getItem('jwt_token')).toBeNull();
    });

    it('should not throw when no token exists', () => {
      window.sessionStorage.removeItem('jwt_token');

      expect(() => clearJWTToken()).not.toThrow();
    });
  });

  // ── getJWTToken (with expiration checking) ─────────────────────────

  describe('getJWTToken', () => {
    it('should prioritize window global over session storage', () => {
      const windowToken = validJWT();
      const storageToken = validJWT();
      (window as any).__JWT_TOKEN = windowToken;
      window.sessionStorage.setItem('jwt_token', storageToken);

      const token = getJWTToken();

      expect(token).toBe(windowToken);
    });

    it('should fall back to session storage when no window token', () => {
      delete (window as any).__JWT_TOKEN;
      const storageToken = validJWT();
      window.sessionStorage.setItem('jwt_token', storageToken);

      const token = getJWTToken();

      expect(token).toBe(storageToken);
    });

    it('should return undefined when no token found', () => {
      delete (window as any).__JWT_TOKEN;
      window.sessionStorage.removeItem('jwt_token');

      const token = getJWTToken();

      expect(token).toBeUndefined();
    });

    it('should reject expired token from window global', () => {
      const expiredToken = createMockJWT(Math.floor(Date.now() / 1000) - 300);
      (window as any).__JWT_TOKEN = expiredToken;

      const token = getJWTToken();

      expect(token).toBeUndefined();
      // Expired token should be cleared from window
      expect((window as any).__JWT_TOKEN).toBeUndefined();
    });

    it('should reject token expiring within 60-second buffer', () => {
      // Expires in 30 seconds — within the 60s safety margin
      const soonToken = createMockJWT(Math.floor(Date.now() / 1000) + 30);
      (window as any).__JWT_TOKEN = soonToken;

      const token = getJWTToken();

      expect(token).toBeUndefined();
    });

    it('should accept token expiring in more than 60 seconds', () => {
      const laterToken = createMockJWT(Math.floor(Date.now() / 1000) + 90);
      (window as any).__JWT_TOKEN = laterToken;

      const token = getJWTToken();

      expect(token).toBeTruthy();
    });

    it('should reject malformed (non-JWT) token', () => {
      (window as any).__JWT_TOKEN = 'not-a-valid-jwt';

      const token = getJWTToken();

      expect(token).toBeUndefined();
    });

    it('should reject expired token from session storage and clear it', () => {
      const expiredToken = createMockJWT(Math.floor(Date.now() / 1000) - 300);
      window.sessionStorage.setItem('jwt_token', expiredToken);

      const token = getJWTToken();

      expect(token).toBeUndefined();
      expect(window.sessionStorage.getItem('jwt_token')).toBeNull();
    });

    it('should skip expired window token and use valid storage token', () => {
      const expiredWindow = createMockJWT(Math.floor(Date.now() / 1000) - 300);
      const validStorage = validJWT();
      (window as any).__JWT_TOKEN = expiredWindow;
      window.sessionStorage.setItem('jwt_token', validStorage);

      const token = getJWTToken();

      expect(token).toBe(validStorage);
    });
  });
});
