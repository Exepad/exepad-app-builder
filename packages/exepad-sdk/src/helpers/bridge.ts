import type { ExepadPlatformAPI } from '../platform/types';

export function getPlatform(): ExepadPlatformAPI | null {
  if (typeof window !== 'undefined' && (window as any).ExepadPlatform) {
    return (window as any).ExepadPlatform;
  }
  return null;
}
