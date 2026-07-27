/**
 * AppConfigContext Integration Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { 
  AppConfigProvider, 
  useAppConfig, 
  useAppConfigOptional,
  AppMode,
  RouteType
} from '@/context/AppConfigContext';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import { PageProps } from '@/app_runtime/interfaces/apps/page';

// Create a test wrapper component
const TestConsumer = () => {
  const { appConfig, basePath, appId, mode, routeType, getPageBySlug, getHomePage } = useAppConfig();
  
  return (
    <div>
      <div data-testid="app-name">{appConfig.name}</div>
      <div data-testid="base-path">{basePath}</div>
      <div data-testid="app-id">{appId}</div>
      <div data-testid="mode">{mode}</div>
      <div data-testid="route-type">{routeType}</div>
      <div data-testid="home-page">{getHomePage()?.title || 'No home'}</div>
      <div data-testid="about-page">{getPageBySlug('/about')?.title || 'Not found'}</div>
    </div>
  );
};

// Sample test data
const createMockConfig = (overrides?: Partial<WebAppProps>): WebAppProps => {
  // Default pages
  const defaultPages = [
    {
      uuid: 'page-1',
      pageType: 'WebPageProps',
      title: 'Home',
      slug: '/',
      summary: 'Home page',
      shortSummary: 'Home',
      lastUpdatedEpoch: Date.now() / 1000,
      content: [],
    },
    {
      uuid: 'page-2',
      pageType: 'WebPageProps',
      title: 'About Us',
      slug: '/about',
      summary: 'About us',
      shortSummary: 'About',
      lastUpdatedEpoch: Date.now() / 1000,
      content: [],
    },
    {
      uuid: 'page-3',
      pageType: 'BlogMainPageProps',
      title: 'Blog',
      slug: '/blog',
      summary: 'Our blog',
      shortSummary: 'Blog',
      lastUpdatedEpoch: Date.now() / 1000,
      content: [],
    },
  ] as PageProps[];

  // Allow overriding pages via either overrides.pages or overrides.frontend?.pages
  const pages = (overrides as any)?.pages || (overrides as any)?.frontend?.pages || defaultPages;

  return {
    uuid: 'app-1',
    appType: 'WebAppProps',
    appSecondaryType: 'website',
    name: 'Test App',
    summary: 'Test summary',
    shortSummary: 'Test',
    lastUpdatedEpoch: Date.now() / 1000,
    runtimeVersion: '1.0.0',
    agentVersion: '1.0.0',
    alias: 'test-app',
    languages: [{ code: 'en', nameEnglish: 'English', nameNative: 'English', isDefault: true }],
    layout: 'wide',
    menuPosition: 'HeaderMenuTop',
    theme: { radius: '0.5rem' },
    sidebar: [],
    header: [],
    // AppConfigContext looks for pages at frontend.pages
    frontend: {
      pages,
    },
    footer: [],
    ...overrides,
  } as WebAppProps;
};

describe('AppConfigProvider', () => {
  describe('context value', () => {
    it('should provide app configuration to consumers', () => {
      const mockConfig = createMockConfig();

      render(
        <AppConfigProvider
          appConfig={mockConfig}
          basePath="/demo/test-app"
          appId="test-app"
          mode="published"
          routeType="demo"
        >
          <TestConsumer />
        </AppConfigProvider>
      );

      expect(screen.getByTestId('app-name')).toHaveTextContent('Test App');
      expect(screen.getByTestId('base-path')).toHaveTextContent('/demo/test-app');
      expect(screen.getByTestId('app-id')).toHaveTextContent('test-app');
      expect(screen.getByTestId('mode')).toHaveTextContent('published');
      expect(screen.getByTestId('route-type')).toHaveTextContent('demo');
    });

    it('should use default mode and routeType when not provided', () => {
      const mockConfig = createMockConfig();

      render(
        <AppConfigProvider
          appConfig={mockConfig}
          basePath="/a/app-id"
          appId="app-id"
        >
          <TestConsumer />
        </AppConfigProvider>
      );

      expect(screen.getByTestId('mode')).toHaveTextContent('published');
      expect(screen.getByTestId('route-type')).toHaveTextContent('production');
    });
  });

  describe('getPageBySlug', () => {
    it('should resolve page by exact slug', () => {
      const mockConfig = createMockConfig();

      render(
        <AppConfigProvider
          appConfig={mockConfig}
          basePath="/test"
          appId="test"
        >
          <TestConsumer />
        </AppConfigProvider>
      );

      expect(screen.getByTestId('about-page')).toHaveTextContent('About Us');
    });

    it('should resolve root page', () => {
      const mockConfig = createMockConfig();

      render(
        <AppConfigProvider
          appConfig={mockConfig}
          basePath="/test"
          appId="test"
        >
          <TestConsumer />
        </AppConfigProvider>
      );

      expect(screen.getByTestId('home-page')).toHaveTextContent('Home');
    });

    it('should normalize slugs with and without leading slash', () => {
      const mockConfig = createMockConfig();

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      // Both should work
      expect(result.current.getPageBySlug('/about')?.title).toBe('About Us');
      expect(result.current.getPageBySlug('about')?.title).toBe('About Us');
    });

    it('should handle trailing slashes', () => {
      const mockConfig = createMockConfig();

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      expect(result.current.getPageBySlug('/about/')?.title).toBe('About Us');
    });

    it('should return undefined for non-existent pages', () => {
      const mockConfig = createMockConfig();

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      expect(result.current.getPageBySlug('/non-existent')).toBeUndefined();
    });

  });

  describe('getPageById', () => {
    it('should resolve page by UUID', () => {
      const mockConfig = createMockConfig();

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      expect(result.current.getPageById('page-2')?.title).toBe('About Us');
    });

    it('should return undefined for non-existent UUID', () => {
      const mockConfig = createMockConfig();

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      expect(result.current.getPageById('non-existent-uuid')).toBeUndefined();
    });
  });

  describe('getHomePage', () => {
    it('should return page with root slug', () => {
      const mockConfig = createMockConfig();

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      expect(result.current.getHomePage()?.title).toBe('Home');
    });

    it('should fall back to first page if no root page exists', () => {
      const mockConfig = createMockConfig({
        pages: [
          {
            uuid: 'page-1',
            pageType: 'WebPageProps',
            title: 'Services',
            slug: '/services',
            summary: 'Our services',
            shortSummary: 'Services',
            lastUpdatedEpoch: Date.now() / 1000,
            content: [],
          },
        ] as PageProps[],
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      expect(result.current.getHomePage()?.title).toBe('Services');
    });
  });

  describe('useAppConfig hook', () => {
    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAppConfig());
      }).toThrow('useAppConfig must be used within an AppConfigProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('useAppConfigOptional hook', () => {
    it('should return null when used outside provider', () => {
      const { result } = renderHook(() => useAppConfigOptional());

      expect(result.current).toBeNull();
    });

    it('should return context value when used inside provider', () => {
      const mockConfig = createMockConfig();

      const { result } = renderHook(() => useAppConfigOptional(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      expect(result.current).not.toBeNull();
      expect(result.current?.appConfig.name).toBe('Test App');
    });
  });

  describe('memoization', () => {
    it('should memoize getPageBySlug callback', () => {
      const mockConfig = createMockConfig();

      const { result, rerender } = renderHook(() => useAppConfig(), {
        wrapper: ({ children }) => (
          <AppConfigProvider appConfig={mockConfig} basePath="/test" appId="test">
            {children}
          </AppConfigProvider>
        ),
      });

      const firstCallback = result.current.getPageBySlug;
      
      rerender();
      
      const secondCallback = result.current.getPageBySlug;
      
      expect(firstCallback).toBe(secondCallback);
    });
  });
});
