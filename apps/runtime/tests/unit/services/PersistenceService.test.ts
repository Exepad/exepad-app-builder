/**
 * PersistenceService Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersistenceService, ContentUpdate } from '@/services/PersistenceService';
import { WebSocketManager } from '@/services/WebSocketManager';

// Mock WebSocketManager
vi.mock('@/services/WebSocketManager', () => ({
  WebSocketManager: {
    getInstance: vi.fn(() => ({
      send: vi.fn().mockResolvedValue({ delivered: true, queued: false }),
      isConnected: vi.fn().mockReturnValue(true),
    })),
  },
}));

describe('PersistenceService', () => {
  let persistenceService: PersistenceService;
  let mockWsManager: any;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Create mock WS manager
    mockWsManager = {
      send: vi.fn().mockResolvedValue({ delivered: true, queued: false }),
      isConnected: vi.fn().mockReturnValue(true),
    };
    
    // Mock the getInstance to return our mock
    (WebSocketManager.getInstance as any).mockReturnValue(mockWsManager);
    
    persistenceService = new PersistenceService();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    persistenceService.cleanup();
  });

  describe('save', () => {
    it('should save updates via WebSocket', async () => {
      const updates: ContentUpdate[] = [
        {
          componentId: 'comp-1',
          content: 'New content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
        },
      ];

      const result = await persistenceService.save('test-app', updates);

      expect(result.success).toBe(true);
      expect(result.savedCount).toBe(1);
      expect(mockWsManager.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'app_config_saved',
          data: expect.objectContaining({
            appId: 'test-app',
            updatesCount: 1,
            updates,
          }),
        })
      );
    });

    it('should handle save failures', async () => {
      mockWsManager.send.mockRejectedValueOnce(new Error('Network error'));

      const updates: ContentUpdate[] = [
        {
          componentId: 'comp-1',
          content: 'New content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
        },
      ];

      const result = await persistenceService.save('test-app', updates);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include forced flag when specified', async () => {
      const updates: ContentUpdate[] = [
        {
          componentId: 'comp-1',
          content: 'New content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
        },
      ];

      await persistenceService.save('test-app', updates, { forced: true });

      expect(mockWsManager.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            forced: true,
          }),
        })
      );
    });
  });

  describe('scheduleSave', () => {
    it('should schedule save with debouncing', () => {
      const updates: ContentUpdate[] = [
        {
          componentId: 'comp-1',
          content: 'New content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
        },
      ];

      persistenceService.scheduleSave('test-app', updates, 1000);

      // Save should not be called immediately
      expect(mockWsManager.send).not.toHaveBeenCalled();

      // Advance time past delay
      vi.advanceTimersByTime(1000);

      // Now save should be called
      expect(mockWsManager.send).toHaveBeenCalled();
    });

    it('should cancel previous pending save when scheduling new one', () => {
      const updates1: ContentUpdate[] = [
        {
          componentId: 'comp-1',
          content: 'Content 1',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
        },
      ];

      const updates2: ContentUpdate[] = [
        {
          componentId: 'comp-1',
          content: 'Content 2',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
        },
      ];

      // Schedule first save
      persistenceService.scheduleSave('test-app', updates1, 1000);

      // Schedule second save before first completes
      vi.advanceTimersByTime(500);
      persistenceService.scheduleSave('test-app', updates2, 1000);

      // Advance past first timeout
      vi.advanceTimersByTime(600);
      expect(mockWsManager.send).not.toHaveBeenCalled();

      // Advance past second timeout
      vi.advanceTimersByTime(500);
      expect(mockWsManager.send).toHaveBeenCalledTimes(1);
      expect(mockWsManager.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            updates: updates2,
          }),
        })
      );
    });
  });

  describe('cancelPendingSave', () => {
    it('should cancel a pending save', () => {
      const updates: ContentUpdate[] = [
        {
          componentId: 'comp-1',
          content: 'New content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
        },
      ];

      persistenceService.scheduleSave('test-app', updates, 1000);
      persistenceService.cancelPendingSave('test-app');

      // Advance time
      vi.advanceTimersByTime(2000);

      // Save should not have been called
      expect(mockWsManager.send).not.toHaveBeenCalled();
    });
  });

  describe('enableAutoSave', () => {
    it('should enable auto-save at specified interval', () => {
      const getUpdates = vi.fn().mockReturnValue([
        {
          componentId: 'comp-1',
          content: 'Updated content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
          isSaved: false,
        },
      ]);

      persistenceService.enableAutoSave('test-app', getUpdates, 1000);

      // Advance time to trigger auto-save
      vi.advanceTimersByTime(1000);

      expect(getUpdates).toHaveBeenCalled();
      expect(mockWsManager.send).toHaveBeenCalled();
    });

    it('should not save when no unsaved updates', () => {
      const getUpdates = vi.fn().mockReturnValue([
        {
          componentId: 'comp-1',
          content: 'Updated content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
          isSaved: true, // Already saved
        },
      ]);

      persistenceService.enableAutoSave('test-app', getUpdates, 1000);

      // Advance time
      vi.advanceTimersByTime(1000);

      expect(getUpdates).toHaveBeenCalled();
      expect(mockWsManager.send).not.toHaveBeenCalled();
    });
  });

  describe('disableAutoSave', () => {
    it('should disable auto-save', () => {
      const getUpdates = vi.fn().mockReturnValue([
        {
          componentId: 'comp-1',
          content: 'Updated content',
          componentType: 'CodeComponentProps',
          target_field: 'content',
          timestamp: Date.now(),
          isSaved: false,
        },
      ]);

      persistenceService.enableAutoSave('test-app', getUpdates, 1000);
      persistenceService.disableAutoSave();

      // Advance time
      vi.advanceTimersByTime(2000);

      // Should not have been called after disabling
      expect(mockWsManager.send).not.toHaveBeenCalled();
    });
  });

  describe('getUnsavedCount', () => {
    it('should return count of unsaved updates', () => {
      const updates = new Map<string, ContentUpdate>();
      updates.set('comp-1', {
        componentId: 'comp-1',
        content: 'Content 1',
        componentType: 'CodeComponentProps',
        target_field: 'content',
        timestamp: Date.now(),
        isSaved: false,
      });
      updates.set('comp-2', {
        componentId: 'comp-2',
        content: 'Content 2',
        componentType: 'CodeComponentProps',
        target_field: 'content',
        timestamp: Date.now(),
        isSaved: true,
      });
      updates.set('comp-3', {
        componentId: 'comp-3',
        content: 'Content 3',
        componentType: 'CodeComponentProps',
        target_field: 'content',
        timestamp: Date.now(),
        isSaved: false,
      });

      const count = persistenceService.getUnsavedCount(updates);

      expect(count).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should clean up all timers and state', () => {
      const getUpdates = vi.fn().mockReturnValue([]);

      // Set up auto-save and scheduled save
      persistenceService.enableAutoSave('test-app', getUpdates, 1000);
      persistenceService.scheduleSave('test-app', [], 1000);

      // Cleanup
      persistenceService.cleanup();

      // Advance time
      vi.advanceTimersByTime(2000);

      // Neither should have been triggered
      expect(mockWsManager.send).not.toHaveBeenCalled();
    });
  });
});
