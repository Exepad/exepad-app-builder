/**
 * EditModeContext Tests
 * Tests for the edit mode context provider (preview mode functionality)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { EditModeProvider, useEditMode } from '@/context/EditModeContext';
import { useAppStore } from '@/stores/appStore';

// Mock the lifecycle hook
vi.mock('@/hooks/useLifecycle', () => ({
  useLifecycle: vi.fn(() => ({
    add: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

// Mock JWT helper
vi.mock('@/lib/jwt-helper', () => ({
  getJWTTokenAsync: vi.fn(() => Promise.resolve(null)),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock WebSocketManager
const mockWsInstance = {
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => false),
  send: vi.fn(() => Promise.resolve()),
  subscribe: vi.fn(() => vi.fn()),
};

vi.mock('@/services/WebSocketManager', () => ({
  WebSocketManager: {
    getInstance: vi.fn(() => mockWsInstance),
  },
}));

// Mock PersistenceService
vi.mock('@/services/PersistenceService', () => {
  return {
    PersistenceService: class MockPersistenceService {
      save = vi.fn(() => Promise.resolve({ success: true }));
      cleanup = vi.fn();
    },
  };
});

// Mock ConfigService
vi.mock('@/services/ConfigService', () => ({
  ConfigService: {
    fetch: vi.fn(() => Promise.resolve(null)),
    compareConfigs: vi.fn(() => []),
  },
}));

// Suppress console for cleaner output
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
  
  vi.clearAllMocks();
});

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
});

describe('EditModeContext', () => {
  describe('EditModeProvider', () => {
    it('should render children', () => {
      render(
        <MemoryRouter><EditModeProvider isPreview={false} appId="test-app">
          <div>Test content</div>
        </EditModeProvider></MemoryRouter>
      );

      expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('should provide default values', () => {
      const TestComponent = () => {
        const { isEditMode, isPreview, hasUnsavedChanges } = useEditMode();
        return (
          <div>
            <span data-testid="edit-mode">{isEditMode.toString()}</span>
            <span data-testid="is-preview">{isPreview.toString()}</span>
            <span data-testid="unsaved">{hasUnsavedChanges.toString()}</span>
          </div>
        );
      };

      render(
        <MemoryRouter><EditModeProvider isPreview={false} appId="test-app">
          <TestComponent />
        </EditModeProvider></MemoryRouter>
      );

      expect(screen.getByTestId('edit-mode')).toHaveTextContent('false');
      expect(screen.getByTestId('is-preview')).toHaveTextContent('false');
      expect(screen.getByTestId('unsaved')).toHaveTextContent('false');
    });

    it('should pass isPreview prop correctly', () => {
      const TestComponent = () => {
        const { isPreview } = useEditMode();
        return <span data-testid="preview">{isPreview.toString()}</span>;
      };

      render(
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          <TestComponent />
        </EditModeProvider></MemoryRouter>
      );

      expect(screen.getByTestId('preview')).toHaveTextContent('true');
    });
  });

  describe('useEditMode', () => {
    it('should return all context functions', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={false} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      expect(typeof result.current.updateContent).toBe('function');
      expect(typeof result.current.saveChanges).toBe('function');
      expect(typeof result.current.selectComponent).toBe('function');
      expect(typeof result.current.sendWebSocketMessage).toBe('function');
      expect(typeof result.current.triggerEditMode).toBe('function');
      expect(typeof result.current.setComponentProcessing).toBe('function');
      expect(typeof result.current.getContentFor).toBe('function');
      expect(typeof result.current.subscribeContent).toBe('function');
    });

    it('should return default values outside provider', () => {
      const { result } = renderHook(() => useEditMode());

      expect(result.current.isEditMode).toBe(false);
      expect(result.current.isPreview).toBe(false);
      expect(result.current.hasUnsavedChanges).toBe(false);
    });
  });

  describe('selectComponent', () => {
    it('should update selected component in store', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={false} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      act(() => {
        result.current.selectComponent('comp-1', { componentType: 'CodeComponentProps' });
      });

      // Check store was updated
      expect(useAppStore.getState().selectedComponentId).toBe('comp-1');
    });

    it('should deselect when null passed', async () => {
      // Set initial selection
      useAppStore.setState({ selectedComponentId: 'comp-1' });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={false} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      act(() => {
        result.current.selectComponent(null);
      });

      expect(useAppStore.getState().selectedComponentId).toBeNull();
    });
  });

  describe('updateContent', () => {
    it('should add content update to store', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      act(() => {
        result.current.updateContent('comp-1', 'New content', 'CodeComponentProps', 'content');
      });

      const updates = useAppStore.getState().contentUpdates;
      expect(updates.has('comp-1')).toBe(true);
      expect(updates.get('comp-1')?.content).toBe('New content');
    });
  });

  describe('getContentFor', () => {
    it('should return content for component', () => {
      // Pre-populate content updates
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        content: 'Test content',
        componentType: 'CodeComponentProps',
        target_field: 'content',
        isSaved: false,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      expect(result.current.getContentFor('comp-1')).toBe('Test content');
    });

    it('should return undefined for non-existent component', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      expect(result.current.getContentFor('non-existent')).toBeUndefined();
    });
  });

  describe('subscribeContent', () => {
    it('should return unsubscribe function', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });
      const callback = vi.fn();

      const unsubscribe = result.current.subscribeContent('comp-1', callback);

      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('setComponentProcessing', () => {
    it('should update processing state in store', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      act(() => {
        result.current.setComponentProcessing('comp-1', true);
      });

      expect(useAppStore.getState().processingComponentIds.has('comp-1')).toBe(true);

      act(() => {
        result.current.setComponentProcessing('comp-1', false);
      });

      expect(useAppStore.getState().processingComponentIds.has('comp-1')).toBe(false);
    });
  });

  describe('sendWebSocketMessage', () => {
    it('should return false when not connected', () => {
      mockWsInstance.isConnected.mockReturnValue(false);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      const sent = result.current.sendWebSocketMessage({ type: 'test' });

      expect(sent).toBe(false);
    });
  });

  describe('triggerEditMode', () => {
    it('should set edit mode in store when WS not connected', () => {
      mockWsInstance.isConnected.mockReturnValue(false);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result } = renderHook(() => useEditMode(), { wrapper });

      act(() => {
        result.current.triggerEditMode(true);
      });

      // Store should be updated directly when WS not connected
      expect(useAppStore.getState().isEditMode).toBe(true);
    });
  });

  describe('hasUnsavedChanges', () => {
    it('should reflect store state', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter><EditModeProvider isPreview={true} appId="test-app">
          {children}
        </EditModeProvider></MemoryRouter>
      );

      const { result, rerender } = renderHook(() => useEditMode(), { wrapper });

      expect(result.current.hasUnsavedChanges).toBe(false);

      // Add unsaved content
      act(() => {
        useAppStore.getState().updateContent({
          componentId: 'comp-1',
          content: 'test',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          isSaved: false,
        });
      });

      // Re-render to get updated value
      rerender();

      // Note: hasUnsavedChanges is computed in the context from store
      expect(useAppStore.getState().hasUnsavedChanges()).toBe(true);
    });
  });
});
