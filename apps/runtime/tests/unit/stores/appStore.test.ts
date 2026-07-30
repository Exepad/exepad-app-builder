/**
 * AppStore Tests
 * Tests for the preview-mode Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/stores/appStore';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';

// Suppress console.log for cleaner test output
const originalLog = console.log;
beforeEach(() => {
  console.log = vi.fn();
  // Reset store to initial state before each test
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
});

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
  pages: [],
  footer: [],
  frontend: {
    header: [
      {
        uuid: 'header-1',
        componentType: 'CodeComponentProps',
        children: [
          { uuid: 'btn-1', componentType: 'CodeComponentProps', text: 'Home' },
        ],
      },
    ],
    footer: [
      { uuid: 'footer-1', componentType: 'CodeComponentProps' },
    ],
    sidebar: [],
    pages: [
      {
        uuid: 'page-1',
        pageType: 'WebPageProps',
        title: 'Home',
        slug: '/',
        summary: 'Home page',
        shortSummary: 'Home',
        lastUpdatedEpoch: Date.now() / 1000,
        content: [
          { uuid: 'section-1', componentType: 'CodeComponentProps' },
        ],
      },
    ],
  },
};

describe('AppStore', () => {
  describe('config state', () => {
    it('should initialize with null config', () => {
      const state = useAppStore.getState();
      expect(state.appConfig).toBeNull();
    });

    it('should set app config', () => {
      useAppStore.getState().setAppConfig(mockAppConfig);

      const state = useAppStore.getState();
      expect(state.appConfig).toEqual(mockAppConfig);
    });

    it('should clear content updates when setting new config', () => {
      // Add some content updates first
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'test',
        isSaved: false,
      });
      useAppStore.getState().selectComponent('comp-1');
      useAppStore.getState().setComponentProcessing('comp-1', true);

      expect(useAppStore.getState().contentUpdates.size).toBe(1);

      // Set new config
      useAppStore.getState().setAppConfig(mockAppConfig);

      expect(useAppStore.getState().contentUpdates.size).toBe(0);
      expect(useAppStore.getState().selectedComponentId).toBeNull();
      expect(useAppStore.getState().processingComponentIds.size).toBe(0);
    });
  });

  describe('selection state', () => {
    it('should initialize with null selected component', () => {
      const state = useAppStore.getState();
      expect(state.selectedComponentId).toBeNull();
    });

    it('should select a component', () => {
      useAppStore.getState().selectComponent('comp-1');

      expect(useAppStore.getState().selectedComponentId).toBe('comp-1');
    });

    it('should deselect component when null is passed', () => {
      useAppStore.getState().selectComponent('comp-1');
      useAppStore.getState().selectComponent(null);

      expect(useAppStore.getState().selectedComponentId).toBeNull();
    });

    it('should accept optional metadata', () => {
      useAppStore.getState().selectComponent('comp-1', { 
        componentType: 'CodeComponentProps', 
        textPreview: 'Click me' 
      });

      expect(useAppStore.getState().selectedComponentId).toBe('comp-1');
    });
  });

  describe('edit mode state', () => {
    it('should initialize with edit mode disabled', () => {
      expect(useAppStore.getState().isEditMode).toBe(false);
    });

    it('should enable edit mode', () => {
      useAppStore.getState().setEditMode(true);

      expect(useAppStore.getState().isEditMode).toBe(true);
    });

    it('should disable edit mode', () => {
      useAppStore.getState().setEditMode(true);
      useAppStore.getState().setEditMode(false);

      expect(useAppStore.getState().isEditMode).toBe(false);
    });
  });

  describe('content updates', () => {
    it('should initialize with empty content updates', () => {
      expect(useAppStore.getState().contentUpdates.size).toBe(0);
    });

    it('should add content update', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'Updated text',
        isSaved: false,
      });

      const updates = useAppStore.getState().contentUpdates;
      expect(updates.size).toBe(1);
      expect(updates.get('comp-1')).toMatchObject({
        componentId: 'comp-1',
        field: 'text',
        value: 'Updated text',
        isSaved: false,
      });
    });

    it('should override existing content update for same component', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'First update',
        isSaved: false,
      });

      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'Second update',
        isSaved: false,
      });

      const updates = useAppStore.getState().contentUpdates;
      expect(updates.size).toBe(1);
      expect(updates.get('comp-1')?.value).toBe('Second update');
    });

    it('should mark content as saved', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'test',
        isSaved: false,
      });

      useAppStore.getState().markContentAsSaved('comp-1');

      const update = useAppStore.getState().contentUpdates.get('comp-1');
      expect(update?.isSaved).toBe(true);
    });

    it('should clear content update for specific component', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'test',
        isSaved: false,
      });
      useAppStore.getState().updateContent({
        componentId: 'comp-2',
        field: 'text',
        value: 'test2',
        isSaved: false,
      });

      useAppStore.getState().clearContentUpdate('comp-1');

      const updates = useAppStore.getState().contentUpdates;
      expect(updates.size).toBe(1);
      expect(updates.has('comp-1')).toBe(false);
      expect(updates.has('comp-2')).toBe(true);
    });

    it('should clear all updates', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'test',
        isSaved: false,
      });
      useAppStore.getState().updateContent({
        componentId: 'comp-2',
        field: 'text',
        value: 'test2',
        isSaved: false,
      });

      useAppStore.getState().clearUpdates();

      expect(useAppStore.getState().contentUpdates.size).toBe(0);
    });
  });

  describe('processing state', () => {
    it('should initialize with empty processing set', () => {
      expect(useAppStore.getState().processingComponentIds.size).toBe(0);
    });

    it('should add component to processing', () => {
      useAppStore.getState().setComponentProcessing('comp-1', true);

      expect(useAppStore.getState().processingComponentIds.has('comp-1')).toBe(true);
    });

    it('should remove component from processing', () => {
      useAppStore.getState().setComponentProcessing('comp-1', true);
      useAppStore.getState().setComponentProcessing('comp-1', false);

      expect(useAppStore.getState().processingComponentIds.has('comp-1')).toBe(false);
    });

    it('should track multiple processing components', () => {
      useAppStore.getState().setComponentProcessing('comp-1', true);
      useAppStore.getState().setComponentProcessing('comp-2', true);

      const processing = useAppStore.getState().processingComponentIds;
      expect(processing.has('comp-1')).toBe(true);
      expect(processing.has('comp-2')).toBe(true);
    });
  });

  describe('WebSocket state', () => {
    it('should initialize with disconnected status', () => {
      expect(useAppStore.getState().wsConnectionStatus).toBe('disconnected');
    });

    it('should set connection status', () => {
      useAppStore.getState().setWsConnectionStatus('connected');
      expect(useAppStore.getState().wsConnectionStatus).toBe('connected');

      useAppStore.getState().setWsConnectionStatus('connecting');
      expect(useAppStore.getState().wsConnectionStatus).toBe('connecting');

      useAppStore.getState().setWsConnectionStatus('error');
      expect(useAppStore.getState().wsConnectionStatus).toBe('error');
    });
  });

  describe('derived state', () => {
    it('should return false for hasUnsavedChanges when no updates', () => {
      expect(useAppStore.getState().hasUnsavedChanges()).toBe(false);
    });

    it('should return true for hasUnsavedChanges when unsaved updates exist', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'test',
        isSaved: false,
      });

      expect(useAppStore.getState().hasUnsavedChanges()).toBe(true);
    });

    it('should return false for hasUnsavedChanges when all saved', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'test',
        isSaved: false,
      });
      useAppStore.getState().markContentAsSaved('comp-1');

      expect(useAppStore.getState().hasUnsavedChanges()).toBe(false);
    });

    it('should return unsaved updates only', () => {
      useAppStore.getState().updateContent({
        componentId: 'comp-1',
        field: 'text',
        value: 'unsaved',
        isSaved: false,
      });
      useAppStore.getState().updateContent({
        componentId: 'comp-2',
        field: 'text',
        value: 'saved',
        isSaved: false,
      });
      useAppStore.getState().markContentAsSaved('comp-2');

      const unsaved = useAppStore.getState().getUnsavedUpdates();
      expect(unsaved.length).toBe(1);
      expect(unsaved[0].componentId).toBe('comp-1');
    });
  });

  describe('component lookup', () => {
    beforeEach(() => {
      useAppStore.getState().setAppConfig(mockAppConfig);
    });

    it('should return null when no config', () => {
      useAppStore.setState({ appConfig: null });
      expect(useAppStore.getState().getComponentById('any-id')).toBeNull();
    });

    it('should find component in header', () => {
      const component = useAppStore.getState().getComponentById('header-1');
      expect(component).not.toBeNull();
      expect(component?.uuid).toBe('header-1');
    });

    it('should find nested component in header', () => {
      const component = useAppStore.getState().getComponentById('btn-1');
      expect(component).not.toBeNull();
      expect(component?.uuid).toBe('btn-1');
      expect(component?.componentType).toBe('CodeComponentProps');
    });

    it('should find component in footer', () => {
      const component = useAppStore.getState().getComponentById('footer-1');
      expect(component).not.toBeNull();
      expect(component?.uuid).toBe('footer-1');
    });

    it('should find component in page content', () => {
      const component = useAppStore.getState().getComponentById('section-1');
      expect(component).not.toBeNull();
      expect(component?.uuid).toBe('section-1');
    });

    it('should return null for non-existent component', () => {
      const component = useAppStore.getState().getComponentById('non-existent');
      expect(component).toBeNull();
    });
  });
});
