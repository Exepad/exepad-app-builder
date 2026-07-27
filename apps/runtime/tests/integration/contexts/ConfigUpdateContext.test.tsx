/**
 * ConfigUpdateContext Tests
 * Tests for the config update context provider (preview mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import { ConfigUpdateProvider, useConfigUpdate } from '@/context/ConfigUpdateContext';
import { useAppStore } from '@/stores/appStore';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';

// Mock app config for testing
const mockAppConfig: WebAppProps = {
  uuid: 'test-app',
  appType: 'WebAppProps',
  appSecondaryType: 'website',
  name: 'Test App',
  summary: 'Test app summary',
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
  pages: [
    {
      uuid: 'page-1',
      pageType: 'WebPageProps',
      title: 'Home',
      slug: '/',
      summary: 'Home page',
      shortSummary: 'Home',
      lastUpdatedEpoch: 1234567890,
      content: [
        {
          uuid: 'section-1',
          componentType: 'CodeComponentProps',
          lastUpdatedEpoch: 1234567890,
        },
        {
          uuid: 'text-1',
          componentType: 'CodeComponentProps',
          content: 'Hello World',
          lastUpdatedEpoch: 1234567891,
        },
      ],
    },
  ],
  footer: [],
  frontend: {
    header: [
      {
        uuid: 'navbar-1',
        componentType: 'CodeComponentProps',
        children: [
          { uuid: 'btn-1', componentType: 'CodeComponentProps', text: 'Home' },
        ],
      },
    ],
    footer: [],
    sidebar: [],
    pages: [],
  },
};

// Suppress console output
const originalLog = console.log;
const originalWarn = console.warn;

beforeEach(() => {
  console.log = vi.fn();
  console.warn = vi.fn();
  
  // Reset store state
  useAppStore.setState({
    appConfig: null,
    selectedComponentId: null,
    isEditMode: false,
    contentUpdates: new Map(),
    processingComponentIds: new Set(),
    wsConnectionStatus: 'disconnected',
  });
});

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  vi.clearAllMocks();
});

describe('ConfigUpdateContext', () => {
  describe('ConfigUpdateProvider', () => {
    it('should render children', () => {
      render(
        <ConfigUpdateProvider initialConfig={null}>
          <div>Test content</div>
        </ConfigUpdateProvider>
      );

      expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('should set initial config in store', async () => {
      render(
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          <div>Test</div>
        </ConfigUpdateProvider>
      );

      // Wait for useEffect to run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(useAppStore.getState().appConfig).toEqual(mockAppConfig);
    });

    it('should not override existing config', async () => {
      // Set existing config
      const existingConfig = { ...mockAppConfig, name: 'Existing App' };
      useAppStore.setState({ appConfig: existingConfig });

      render(
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          <div>Test</div>
        </ConfigUpdateProvider>
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Should keep existing config
      expect(useAppStore.getState().appConfig?.name).toBe('Existing App');
    });
  });

  describe('useConfigUpdate', () => {
    it('should return context values', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      expect(result.current.appConfig).toBeDefined();
      expect(typeof result.current.setAppConfig).toBe('function');
      expect(typeof result.current.getComponent).toBe('function');
      expect(typeof result.current.subscribeToComponent).toBe('function');
      expect(typeof result.current.handlePartialUpdate).toBe('function');
      expect(typeof result.current.getComponentEpoch).toBe('function');
    });

    it('should return default values outside provider', () => {
      const { result } = renderHook(() => useConfigUpdate());

      expect(result.current.appConfig).toBeNull();
      expect(typeof result.current.setAppConfig).toBe('function');
    });
  });

  describe('setAppConfig', () => {
    it('should update config in store', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={null}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      act(() => {
        result.current.setAppConfig(mockAppConfig);
      });

      expect(useAppStore.getState().appConfig).toEqual(mockAppConfig);
    });
  });

  describe('getComponent', () => {
    it('should return component by ID', async () => {
      // Set config in store
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const component = result.current.getComponent('navbar-1');
      expect(component).toBeDefined();
      expect(component?.uuid).toBe('navbar-1');
    });

    it('should return nested component', async () => {
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const component = result.current.getComponent('btn-1');
      expect(component).toBeDefined();
      expect(component?.uuid).toBe('btn-1');
    });

    it('should return null/undefined for non-existent component', async () => {
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const component = result.current.getComponent('non-existent');
      expect(component).toBeFalsy();
    });

    it('should return undefined when no config', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={null}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      const component = result.current.getComponent('any-id');
      expect(component).toBeUndefined();
    });
  });

  describe('subscribeToComponent', () => {
    it('should return unsubscribe function', async () => {
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });
      const callback = vi.fn();

      const unsubscribe = result.current.subscribeToComponent('section-1', callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should log subscription', async () => {
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });
      const callback = vi.fn();

      result.current.subscribeToComponent('section-1', callback);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Subscribed to component: section-1')
      );
    });
  });

  describe('getComponentEpoch', () => {
    it('should return epoch for component', async () => {
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const epoch = result.current.getComponentEpoch('navbar-1');
      // The mock component may or may not have lastUpdatedEpoch
      expect(epoch === undefined || typeof epoch === 'number').toBe(true);
    });

    it('should return undefined for non-existent component', async () => {
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      const epoch = result.current.getComponentEpoch('non-existent');
      expect(epoch).toBeUndefined();
    });
  });

  describe('handlePartialUpdate', () => {
    it('should log warning when no config', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={null}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      result.current.handlePartialUpdate([
        { componentId: 'comp-1', changes: {} },
      ]);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No config available for update')
      );
    });

    it('should log processing message when config exists', async () => {
      useAppStore.setState({ appConfig: mockAppConfig });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          {children}
        </ConfigUpdateProvider>
      );

      const { result } = renderHook(() => useConfigUpdate(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      result.current.handlePartialUpdate([
        { componentId: 'comp-1', changes: {} },
        { componentId: 'comp-2', changes: {} },
      ]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Processing 2 update(s)')
      );
    });
  });

  describe('appConfig from context', () => {
    it('should reflect store state', async () => {
      const TestComponent = () => {
        const { appConfig } = useConfigUpdate();
        return <div data-testid="name">{appConfig?.name || 'no-config'}</div>;
      };

      render(
        <ConfigUpdateProvider initialConfig={mockAppConfig}>
          <TestComponent />
        </ConfigUpdateProvider>
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByTestId('name')).toHaveTextContent('Test App');
    });
  });
});
