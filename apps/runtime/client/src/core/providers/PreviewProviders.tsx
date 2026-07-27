/**
 * Preview Providers (Preview-Only)
 * Full provider stack for preview mode with editing capabilities
 * 
 * IMPORTANT: This file should only be imported in preview mode
 * It will be dynamically loaded and tree-shaken from published builds
 */


import { ReactNode } from 'react';
import { ConfigUpdateProvider } from '@/context/ConfigUpdateContext';
import { EditModeProvider } from '@/context/EditModeContext';
import { NavigationGuard } from '@/components/editable/NavigationGuard';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import { logger } from '@/lib/logger';

interface PreviewProvidersProps {
  appId: string;
  appConfig: WebAppProps;
  children: ReactNode;
}

/**
 * PreviewProviders - Full provider stack for preview mode
 * 
 * Includes:
 * - ConfigUpdateProvider: Manages config updates and hot reload
 * - EditModeProvider: Manages edit mode state and WebSocket connection
 */
export default function PreviewProviders({
  appId,
  appConfig,
  children,
}: PreviewProvidersProps) {
  logger.log('[PreviewProviders] Initializing preview mode providers');
  //logger.log('[PreviewProviders] AppConfig:', appConfig);
  return (
    <ConfigUpdateProvider initialConfig={appConfig}>
      <EditModeProvider isPreview={true} appId={appId}>
        <NavigationGuard>
          {children}
        </NavigationGuard>
      </EditModeProvider>
    </ConfigUpdateProvider>
  );
}

