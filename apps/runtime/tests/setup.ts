/// <reference types="node" />
/**
 * Test Setup
 * Global test configuration and mocks for Vitest
 */

import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock requestAnimationFrame and cancelAnimationFrame for jsdom
globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
});

globalThis.cancelAnimationFrame = vi.fn((id: number) => {
  clearTimeout(id);
});

// Mock scrollIntoView for jsdom (used by Radix UI Select).
// Guarded so node-environment tests (`// @vitest-environment node`) can reuse
// this global setup without a DOM.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

// Mock React Router
const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'default' }),
  };
});

// Mock Vite environment variables
(globalThis as any).import = {
  meta: {
    env: {
      MODE: 'test',
      VITE_BACKEND_URL: 'http://localhost:8000',
      VITE_WS_URL: 'ws://localhost:8000',
    },
  },
};

// Mock WebSocket
(globalThis as any).WebSocket = class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = 1; // OPEN
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => {
      if (this.onopen) this.onopen({});
    }, 0);
  }

  send(data: string) {
    // Mock send
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({});
  }
} as any;

// Suppress console errors in tests (optional - can be commented out for debugging)
globalThis.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
};

// Export mocks for use in tests
export { mockNavigate };
