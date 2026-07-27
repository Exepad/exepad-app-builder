/**
 * TransitionContext Tests
 * Tests for the page transition context
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import {
  TransitionProvider,
  useTransition,
  useTransitionOptional,
} from '@/context/TransitionContext';
import { TransitionProps, PageTransitionProps } from '@/app_runtime/interfaces/apps/transitions';

// Mock matchMedia
const mockMatchMedia = (prefersReducedMotion: boolean) => {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  
  return vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? prefersReducedMotion : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn((event: string, callback: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listeners.push(callback);
      }
    }),
    removeEventListener: vi.fn((event: string, callback: (e: MediaQueryListEvent) => void) => {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }),
    dispatchEvent: vi.fn(),
    triggerChange: (newValue: boolean) => {
      listeners.forEach((listener) => {
        listener({ matches: newValue } as MediaQueryListEvent);
      });
    },
  }));
};

describe('TransitionContext', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = mockMatchMedia(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe('TransitionProvider', () => {
    it('should render children', () => {
      render(
        <TransitionProvider>
          <div>Test content</div>
        </TransitionProvider>
      );

      expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('should provide default values when no config', () => {
      const TestComponent = () => {
        const { isEnabled, supportsViewTransitions } = useTransition();
        return (
          <div>
            <span data-testid="enabled">{isEnabled.toString()}</span>
            <span data-testid="supports">{supportsViewTransitions.toString()}</span>
          </div>
        );
      };

      render(
        <TransitionProvider>
          <TestComponent />
        </TransitionProvider>
      );

      expect(screen.getByTestId('enabled')).toHaveTextContent('true');
      expect(screen.getByTestId('supports')).toHaveTextContent('false');
    });

    it('should accept global config', () => {
      const globalConfig: TransitionProps = {
        enabled: true,
        type: 'fade',
        timing: 'fast',
      };

      const TestComponent = () => {
        const { globalConfig: config } = useTransition();
        return <div data-testid="type">{config?.type}</div>;
      };

      render(
        <TransitionProvider globalConfig={globalConfig}>
          <TestComponent />
        </TransitionProvider>
      );

      expect(screen.getByTestId('type')).toHaveTextContent('fade');
    });
  });

  describe('useTransition', () => {
    it('should throw error when used outside provider', () => {
      const originalError = console.error;
      console.error = vi.fn();

      expect(() => {
        renderHook(() => useTransition());
      }).toThrow('useTransition must be used within a TransitionProvider');

      console.error = originalError;
    });

    it('should return isEnabled=true by default', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.isEnabled).toBe(true);
    });

    it('should return isEnabled=false when config disabled', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ enabled: false }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.isEnabled).toBe(false);
    });

    it('should return isEnabled=false when prefers-reduced-motion', () => {
      window.matchMedia = mockMatchMedia(true);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ respectReducedMotion: true }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.isEnabled).toBe(false);
      expect(result.current.prefersReducedMotion).toBe(true);
    });
  });

  describe('getEffectiveType', () => {
    it('should return default slideFade when no config', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.getEffectiveType()).toBe('slideFade');
    });

    it('should return global config type', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ type: 'scale' }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.getEffectiveType()).toBe('scale');
    });

    it('should prefer page override over global', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ type: 'fade' }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      const pageOverride: PageTransitionProps = { type: 'slideUp' };
      expect(result.current.getEffectiveType(pageOverride)).toBe('slideUp');
    });
  });

  describe('getEffectiveTiming', () => {
    it('should return default normal when no config', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.getEffectiveTiming()).toBe('normal');
    });

    it('should return global config timing', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ timing: 'slow' }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.getEffectiveTiming()).toBe('slow');
    });

    it('should prefer page override over global', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ timing: 'slow' }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      const pageOverride: PageTransitionProps = { timing: 'fast' };
      expect(result.current.getEffectiveTiming(pageOverride)).toBe('fast');
    });
  });

  describe('getDurationMs', () => {
    it('should return correct duration for fast', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.getDurationMs('fast')).toBe(150);
    });

    it('should return correct duration for normal', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.getDurationMs('normal')).toBe(300);
    });

    it('should return correct duration for slow', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.getDurationMs('slow')).toBe(500);
    });
  });

  describe('shouldSkipTransition', () => {
    it('should return false by default', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.shouldSkipTransition()).toBe(false);
    });

    it('should return true when page override disabled', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider>{children}</TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      const pageOverride: PageTransitionProps = { disabled: true };
      expect(result.current.shouldSkipTransition(pageOverride)).toBe(true);
    });

    it('should return true when global config disabled', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ enabled: false }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.shouldSkipTransition()).toBe(true);
    });

    it('should return true when effective type is none', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ type: 'none' }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransition(), { wrapper });

      expect(result.current.shouldSkipTransition()).toBe(true);
    });
  });

  describe('useTransitionOptional', () => {
    it('should return default values when outside provider', () => {
      const { result } = renderHook(() => useTransitionOptional());

      expect(result.current.isEnabled).toBe(true);
      expect(result.current.supportsViewTransitions).toBe(false);
      expect(result.current.prefersReducedMotion).toBe(false);
      expect(result.current.getEffectiveType()).toBe('slideFade');
      expect(result.current.getEffectiveTiming()).toBe('normal');
      expect(result.current.getDurationMs('normal')).toBe(300);
      expect(result.current.shouldSkipTransition()).toBe(false);
    });

    it('should return provider values when inside provider', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TransitionProvider globalConfig={{ type: 'fade', timing: 'fast' }}>
          {children}
        </TransitionProvider>
      );

      const { result } = renderHook(() => useTransitionOptional(), { wrapper });

      expect(result.current.getEffectiveType()).toBe('fade');
      expect(result.current.getEffectiveTiming()).toBe('fast');
    });
  });
});
