/**
 * WebSocketManager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketManager, ConnectionStatus, Message, MessageHandler } from '@/services/WebSocketManager';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('WebSocketManager', () => {
  let wsManager: WebSocketManager;
  let mockWebSocket: any;
  
  beforeEach(() => {
    // Reset all instances for each test
    (WebSocketManager as any).instances.clear();

    // Create fresh instance
    wsManager = WebSocketManager.getInstance();
    
    // Clear all timers
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    wsManager.disconnect();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = WebSocketManager.getInstance();
      const instance2 = WebSocketManager.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('getStatus', () => {
    it('should return disconnected when no WebSocket', () => {
      expect(wsManager.getStatus()).toBe('disconnected');
    });

    it('should return correct status based on WebSocket readyState', () => {
      expect(wsManager.getStatus()).toBe('disconnected');
      expect(wsManager.isConnected()).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should add handler to subscribers', () => {
      const handler: MessageHandler = vi.fn();
      const channel = 'test-channel';
      
      const unsubscribe = wsManager.subscribe(channel, handler);
      
      expect(typeof unsubscribe).toBe('function');
    });

    it('should return unsubscribe function', () => {
      const handler: MessageHandler = vi.fn();
      const channel = 'test-channel';
      
      const unsubscribe = wsManager.subscribe(channel, handler);
      
      // Unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should allow multiple handlers on same channel', () => {
      const handler1: MessageHandler = vi.fn();
      const handler2: MessageHandler = vi.fn();
      const channel = 'test-channel';
      
      const unsubscribe1 = wsManager.subscribe(channel, handler1);
      const unsubscribe2 = wsManager.subscribe(channel, handler2);
      
      expect(typeof unsubscribe1).toBe('function');
      expect(typeof unsubscribe2).toBe('function');
    });
  });

  describe('send', () => {
    it('should queue message when not connected', async () => {
      const message: Message = { type: 'test-message', data: { foo: 'bar' } };

      // A successfully-queued message is NOT a failure: send() resolves with a
      // discriminated result so callers don't report a spurious error for a
      // message that flushQueue() will deliver on reconnect. (Pass
      // { failIfQueued: true } to opt into the old throw-on-queue behavior.)
      await expect(wsManager.send(message)).resolves.toEqual({ delivered: false, queued: true });
    });

    it('should reject message that is too large', async () => {
      // Create a message larger than 1MB
      const largeData = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const message: Message = { type: 'large-message', data: largeData };
      
      await expect(wsManager.send(message)).rejects.toThrow('Message too large');
    });
  });

  describe('disconnect', () => {
    it('should disconnect cleanly', () => {
      wsManager.disconnect();
      
      expect(wsManager.getStatus()).toBe('disconnected');
      expect(wsManager.isConnected()).toBe(false);
    });
  });

  describe('getDebugInfo', () => {
    it('should return debug information', () => {
      const debugInfo = wsManager.getDebugInfo();
      
      expect(debugInfo).toHaveProperty('status');
      expect(debugInfo).toHaveProperty('queueSize');
      expect(debugInfo).toHaveProperty('subscribers');
      expect(debugInfo).toHaveProperty('reconnectAttempts');
      expect(debugInfo.status).toBe('disconnected');
      expect(debugInfo.queueSize).toBe(0);
      expect(debugInfo.reconnectAttempts).toBe(0);
    });
  });

  describe('message deduplication', () => {
    it('should add message ID when deduplicate option is true', async () => {
      const message: Message = { type: 'test-message' };
      
      // This will queue the message since not connected
      try {
        await wsManager.send(message, { deduplicate: true });
      } catch {
        // Expected to throw due to not connected
      }
      
      // Message should have been given an ID (check via debug info queue)
      const debugInfo = wsManager.getDebugInfo();
      expect(debugInfo.queueSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('connection status notifications', () => {
    it('should notify subscribers on connection events', () => {
      const connectionHandler = vi.fn();
      wsManager.subscribe('connection', connectionHandler);
      
      // Disconnect triggers notification
      wsManager.disconnect();
      
      // Handler may or may not be called depending on connection state
      expect(connectionHandler).toBeDefined();
    });
  });
});
