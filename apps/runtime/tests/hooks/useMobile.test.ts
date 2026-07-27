/**
 * useMobile Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '@/hooks/useMobile';

describe('useIsMobile', () => {
  const originalInnerWidth = window.innerWidth;
  let mockMatchMedia: ReturnType<typeof vi.fn>;
  let mediaQueryListeners: Map<string, Function[]>;

  beforeEach(() => {
    mediaQueryListeners = new Map();
    
    mockMatchMedia = vi.fn((query: string) => {
      const listeners: Function[] = [];
      mediaQueryListeners.set(query, listeners);
      
      return {
        matches: window.innerWidth < 768,
        media: query,
        onchange: null,
        addEventListener: vi.fn((event: string, callback: Function) => {
          listeners.push(callback);
        }),
        removeEventListener: vi.fn((event: string, callback: Function) => {
          const index = listeners.indexOf(callback);
          if (index > -1) {
            listeners.splice(index, 1);
          }
        }),
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        dispatchEvent: vi.fn(),
      };
    });

    window.matchMedia = mockMatchMedia;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    vi.clearAllMocks();
  });

  const setWindowWidth = (width: number) => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
  };

  describe('initial state', () => {
    it('should return false for desktop width (>= 768)', () => {
      setWindowWidth(1024);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(false);
    });

    it('should return true for mobile width (< 768)', () => {
      setWindowWidth(375);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(true);
    });

    it('should return false for exactly 768px', () => {
      setWindowWidth(768);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(false);
    });

    it('should return true for 767px', () => {
      setWindowWidth(767);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(true);
    });
  });

  describe('media query setup', () => {
    it('should set up matchMedia with correct breakpoint', () => {
      setWindowWidth(1024);
      renderHook(() => useIsMobile());
      
      expect(mockMatchMedia).toHaveBeenCalledWith('(max-width: 767px)');
    });

    it('should add change event listener', () => {
      setWindowWidth(1024);
      renderHook(() => useIsMobile());
      
      const mqlMock = mockMatchMedia.mock.results[0].value;
      expect(mqlMock.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('resize handling', () => {
    it('should update when window resizes from desktop to mobile', () => {
      setWindowWidth(1024);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(false);
      
      // Simulate resize
      act(() => {
        setWindowWidth(375);
        const query = '(max-width: 767px)';
        const listeners = mediaQueryListeners.get(query);
        if (listeners) {
          listeners.forEach(listener => listener());
        }
      });
      
      expect(result.current).toBe(true);
    });

    it('should update when window resizes from mobile to desktop', () => {
      setWindowWidth(375);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(true);
      
      // Simulate resize
      act(() => {
        setWindowWidth(1024);
        const query = '(max-width: 767px)';
        const listeners = mediaQueryListeners.get(query);
        if (listeners) {
          listeners.forEach(listener => listener());
        }
      });
      
      expect(result.current).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove event listener on unmount', () => {
      setWindowWidth(1024);
      const { unmount } = renderHook(() => useIsMobile());
      
      const mqlMock = mockMatchMedia.mock.results[0].value;
      
      unmount();
      
      expect(mqlMock.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('edge cases', () => {
    it('should handle very small widths', () => {
      setWindowWidth(320);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(true);
    });

    it('should handle very large widths', () => {
      setWindowWidth(2560);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(false);
    });

    it('should handle tablet-ish widths (just below breakpoint)', () => {
      setWindowWidth(767);
      const { result } = renderHook(() => useIsMobile());
      
      expect(result.current).toBe(true);
    });
  });

  describe('return type', () => {
    it('should always return boolean (not undefined)', () => {
      setWindowWidth(1024);
      const { result } = renderHook(() => useIsMobile());
      
      expect(typeof result.current).toBe('boolean');
    });
  });
});
