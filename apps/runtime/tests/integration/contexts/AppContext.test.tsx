/**
 * AppContext Tests
 * Tests for the application context provider
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { AppContextProvider, useAppContext } from '@/context/AppContext';

describe('AppContext', () => {
  describe('AppContextProvider', () => {
    it('should render children', () => {
      render(
        <AppContextProvider basePath="/test">
          <div>Test child</div>
        </AppContextProvider>
      );

      expect(screen.getByText('Test child')).toBeInTheDocument();
    });

    it('should provide basePath to children', () => {
      const TestComponent = () => {
        const { basePath } = useAppContext();
        return <div data-testid="basepath">{basePath}</div>;
      };

      render(
        <AppContextProvider basePath="/my-app">
          <TestComponent />
        </AppContextProvider>
      );

      expect(screen.getByTestId('basepath')).toHaveTextContent('/my-app');
    });

    it('should provide currentPageSlug when set', () => {
      const TestComponent = () => {
        const { currentPageSlug } = useAppContext();
        return <div data-testid="slug">{currentPageSlug || 'undefined'}</div>;
      };

      render(
        <AppContextProvider basePath="/app" currentPageSlug="/about">
          <TestComponent />
        </AppContextProvider>
      );

      expect(screen.getByTestId('slug')).toHaveTextContent('/about');
    });

    it('should provide currentPageUuid when set', () => {
      const TestComponent = () => {
        const { currentPageUuid } = useAppContext();
        return <div data-testid="uuid">{currentPageUuid || 'undefined'}</div>;
      };

      render(
        <AppContextProvider basePath="/app" currentPageUuid="page-123">
          <TestComponent />
        </AppContextProvider>
      );

      expect(screen.getByTestId('uuid')).toHaveTextContent('page-123');
    });

    it('should provide mode when set', () => {
      const TestComponent = () => {
        const { mode } = useAppContext();
        return <div data-testid="mode">{mode || 'undefined'}</div>;
      };

      render(
        <AppContextProvider basePath="/app" mode="preview">
          <TestComponent />
        </AppContextProvider>
      );

      expect(screen.getByTestId('mode')).toHaveTextContent('preview');
    });

    it('should handle all props together', () => {
      const TestComponent = () => {
        const { basePath, currentPageSlug, currentPageUuid, mode } = useAppContext();
        return (
          <div>
            <span data-testid="basepath">{basePath}</span>
            <span data-testid="slug">{currentPageSlug}</span>
            <span data-testid="uuid">{currentPageUuid}</span>
            <span data-testid="mode">{mode}</span>
          </div>
        );
      };

      render(
        <AppContextProvider
          basePath="/demo/beauty-center"
          currentPageSlug="/services"
          currentPageUuid="page-456"
          mode="published"
        >
          <TestComponent />
        </AppContextProvider>
      );

      expect(screen.getByTestId('basepath')).toHaveTextContent('/demo/beauty-center');
      expect(screen.getByTestId('slug')).toHaveTextContent('/services');
      expect(screen.getByTestId('uuid')).toHaveTextContent('page-456');
      expect(screen.getByTestId('mode')).toHaveTextContent('published');
    });
  });

  describe('useAppContext', () => {
    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const originalError = console.error;
      console.error = vi.fn();

      expect(() => {
        renderHook(() => useAppContext());
      }).toThrow('useAppContext must be used within an AppContextProvider');

      console.error = originalError;
    });

    it('should return context value when used inside provider', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AppContextProvider basePath="/test" mode="preview">
          {children}
        </AppContextProvider>
      );

      const { result } = renderHook(() => useAppContext(), { wrapper });

      expect(result.current.basePath).toBe('/test');
      expect(result.current.mode).toBe('preview');
    });

    it('should have optional properties as undefined when not set', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AppContextProvider basePath="/test">
          {children}
        </AppContextProvider>
      );

      const { result } = renderHook(() => useAppContext(), { wrapper });

      expect(result.current.basePath).toBe('/test');
      expect(result.current.currentPageSlug).toBeUndefined();
      expect(result.current.currentPageUuid).toBeUndefined();
      expect(result.current.mode).toBeUndefined();
    });
  });

  describe('nested providers', () => {
    it('should use closest provider value', () => {
      const TestComponent = () => {
        const { basePath } = useAppContext();
        return <div data-testid="basepath">{basePath}</div>;
      };

      render(
        <AppContextProvider basePath="/outer">
          <AppContextProvider basePath="/inner">
            <TestComponent />
          </AppContextProvider>
        </AppContextProvider>
      );

      expect(screen.getByTestId('basepath')).toHaveTextContent('/inner');
    });
  });
});
