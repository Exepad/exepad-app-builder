// @vitest-environment jsdom
/**
 * Regression test for send() reporting failure on a successfully-queued message.
 *
 * Before the fix, send() threw `WebSocket not connected, message queued` after
 * pushing the message onto the offline queue — so callers (PersistenceService)
 * reported the save as failed even though flushQueue() would still deliver it,
 * causing false-failure UI and duplicate re-sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { WebSocketManager } from './WebSocketManager';

describe('WebSocketManager.send offline queueing', () => {
  beforeEach(() => {
    WebSocketManager.releaseInstance('send-test-app');
  });

  it('resolves with { queued: true } instead of throwing when the socket is not open', async () => {
    const mgr = WebSocketManager.getInstance('send-test-app');
    // Never connected, so this.ws is null → the message is queued, not sent.
    const result = await mgr.send({ type: 'app_config_saved', data: { x: 1 } });
    expect(result).toEqual({ delivered: false, queued: true });
  });

  it('still throws on queue when failIfQueued is set', async () => {
    const mgr = WebSocketManager.getInstance('send-test-app');
    await expect(
      mgr.send({ type: 'app_config_saved' }, { failIfQueued: true })
    ).rejects.toThrow(/queued/i);
  });
});
