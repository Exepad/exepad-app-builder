import type { ExepadPlatformAPI } from './platform/types';

declare global {
  interface Window {
    ExepadState?: {
      // State access
      getState: () => Record<string, unknown>;
      set: (key: string, value: unknown) => void;
      subscribe: (listener: (state: unknown, prevState: unknown) => void) => () => void;
    };
    ExepadPlatform?: ExepadPlatformAPI;
  }
}
