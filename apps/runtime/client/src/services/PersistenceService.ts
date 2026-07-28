/**
 * Persistence Service (Preview-Only)
 * Handles saving configuration changes to the backend
 * 
 * IMPORTANT: This should only be imported in preview mode
 */

import { WebSocketManager } from './WebSocketManager';

export interface ContentUpdate {
  componentId: string;
  content: string;
  componentType: string;
  target_field: string;
  timestamp: number;
  isSaved?: boolean;
}

export interface SaveOptions {
  forced?: boolean;
  autoSave?: boolean;
}

export interface SaveResult {
  success: boolean;
  savedCount?: number;
  error?: Error;
  /**
   * True when the WebSocket was offline and the save was buffered for delivery
   * on reconnect (rather than sent immediately). The change WILL be persisted,
   * so callers should not treat this as a hard failure.
   */
  queued?: boolean;
}

/**
 * PersistenceService - Manages saving configuration changes
 */
export class PersistenceService {
  private wsManager: WebSocketManager;
  private pendingSaves = new Map<string, NodeJS.Timeout>();
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(wsManager?: WebSocketManager) {
    this.wsManager = wsManager ?? WebSocketManager.getInstance();
  }

  /**
   * Save updates to the backend
   */
  async save(
    appId: string,
    updates: ContentUpdate[],
    options: SaveOptions = {}
  ): Promise<SaveResult> {
    try {
      console.log(`[PersistenceService] Saving ${updates.length} updates for app ${appId}`);

      const sendResult = await this.wsManager.send({
        type: 'app_config_saved',
        data: {
          appId,
          updatesCount: updates.length,
          updates,
          timestamp: Date.now(),
          forced: options.forced || false,
          isAutoSaved: options.autoSave || false,
        },
      });

      if (sendResult.queued) {
        // The socket was offline; the save was buffered and will be flushed on
        // reconnect. Report success with the `queued` flag so the caller marks
        // the content as saved (avoiding a duplicate re-send storm) rather than
        // reporting a spurious failure for a message that will be delivered.
        console.log('[PersistenceService] Save queued (offline) — will flush on reconnect');
        return { success: true, savedCount: updates.length, queued: true };
      }

      console.log('[PersistenceService] Save successful');
      return { success: true, savedCount: updates.length };
    } catch (error) {
      console.error('[PersistenceService] Save failed:', error);
      return { success: false, error: error as Error };
    }
  }

  /**
   * Enable auto-save functionality
   */
  enableAutoSave(
    appId: string,
    getUpdates: () => ContentUpdate[],
    intervalMs = 30000
  ): void {
    if (this.autoSaveInterval) {
      console.warn('[PersistenceService] Auto-save already enabled');
      return;
    }

    console.log(`[PersistenceService] Auto-save enabled (interval: ${intervalMs}ms)`);

    this.autoSaveInterval = setInterval(async () => {
      const updates = getUpdates();
      const unsavedUpdates = updates.filter((u) => !u.isSaved);

      if (unsavedUpdates.length > 0) {
        console.log(`[PersistenceService] Auto-saving ${unsavedUpdates.length} updates`);
        await this.save(appId, unsavedUpdates, { autoSave: true });
      }
    }, intervalMs);
  }

  /**
   * Disable auto-save functionality
   */
  disableAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      console.log('[PersistenceService] Auto-save disabled');
    }
  }

  /**
   * Get count of unsaved updates
   */
  getUnsavedCount(updates: Map<string, ContentUpdate>): number {
    return Array.from(updates.values()).filter((u) => !u.isSaved).length;
  }

  /**
   * Schedule a save with debouncing
   */
  scheduleSave(
    appId: string,
    updates: ContentUpdate[],
    delayMs = 2000
  ): void {
    // Clear any existing pending save
    const existing = this.pendingSaves.get(appId);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule new save
    const timeout = setTimeout(() => {
      this.save(appId, updates);
      this.pendingSaves.delete(appId);
    }, delayMs);

    this.pendingSaves.set(appId, timeout);
    console.log(`[PersistenceService] Save scheduled for ${appId} in ${delayMs}ms`);
  }

  /**
   * Cancel pending save
   */
  cancelPendingSave(appId: string): void {
    const pending = this.pendingSaves.get(appId);
    if (pending) {
      clearTimeout(pending);
      this.pendingSaves.delete(appId);
      console.log(`[PersistenceService] Cancelled pending save for ${appId}`);
    }
  }

  /**
   * Cleanup - clear all intervals and timeouts
   */
  cleanup(): void {
    this.disableAutoSave();

    // Clear all pending saves
    this.pendingSaves.forEach((timeout) => clearTimeout(timeout));
    this.pendingSaves.clear();

    console.log('[PersistenceService] Cleaned up');
  }
}

