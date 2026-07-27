/**
 * Shared Test Utilities
 * Helper functions for common test operations
 */

import { vi } from 'vitest';

/**
 * Wait for a specified amount of time
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock fetch response
 */
export function createMockFetchResponse<T>(data: T, options: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = options;
  
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: '',
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
  };
}

/**
 * Mock the global fetch function
 */
export function mockFetch(responses: Array<{ data: any; ok?: boolean; status?: number }>) {
  const mockFn = vi.fn();
  
  responses.forEach((response, index) => {
    mockFn.mockResolvedValueOnce(createMockFetchResponse(response.data, {
      ok: response.ok,
      status: response.status,
    }));
  });
  
  global.fetch = mockFn;
  return mockFn;
}

/**
 * Reset all mocks and restore original implementations
 */
export function resetAllMocks() {
  vi.clearAllMocks();
  vi.restoreAllMocks();
}

/**
 * Create a mock event
 */
export function createMockEvent(overrides: Partial<Event> = {}): Event {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: null,
    currentTarget: null,
    ...overrides,
  } as unknown as Event;
}

/**
 * Create a mock mouse event
 */
export function createMockMouseEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    ...createMockEvent(),
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 0,
    ...overrides,
  } as unknown as MouseEvent;
}

/**
 * Create a mock keyboard event
 */
export function createMockKeyboardEvent(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    ...createMockEvent(),
    key,
    code: key,
    keyCode: key.charCodeAt(0),
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  } as unknown as KeyboardEvent;
}

/**
 * Mock localStorage
 */
export function mockLocalStorage() {
  const store: Record<string, string> = {};
  
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach(key => delete store[key]); }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
}

/**
 * Mock IntersectionObserver
 */
export function mockIntersectionObserver() {
  const mockObserver = vi.fn().mockImplementation((callback: IntersectionObserverCallback) => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: '',
    thresholds: [0],
    takeRecords: vi.fn().mockReturnValue([]),
  }));
  
  global.IntersectionObserver = mockObserver;
  return mockObserver;
}

/**
 * Mock ResizeObserver
 */
export function mockResizeObserver() {
  const mockObserver = vi.fn().mockImplementation((callback: ResizeObserverCallback) => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  
  global.ResizeObserver = mockObserver;
  return mockObserver;
}

/**
 * Mock window.matchMedia
 */
export function mockMatchMedia(matches: boolean = false) {
  const mockFn = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: mockFn,
  });
  
  return mockFn;
}

/**
 * Suppress console output during tests
 */
export function suppressConsole() {
  const originalConsole = { ...console };
  
  beforeEach(() => {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });
  
  afterEach(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });
}

/**
 * Generate a random UUID for testing
 */
export function generateTestUuid(): string {
  return `test-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create a deferred promise for async testing
 */
export function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return { promise, resolve: resolve!, reject: reject! };
}
