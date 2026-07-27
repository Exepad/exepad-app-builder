
import React, { useState } from 'react';
import { AppContextProvider } from '@/context/AppContext';
import { EditModeProvider } from '@/context/EditModeContext';
import { ConfigUpdateProvider } from '@/context/ConfigUpdateContext';
import { NavigationGuard } from './editable/NavigationGuard';
import { WebAppProps } from '@/app_runtime/interfaces/apps/webapp';
import { HashScrollHandler } from './HashScrollHandler';

interface ClientWrapperProps {
  children: React.ReactNode;
  basePath: string;
  currentPageSlug?: string;
  currentPageUuid?: string;
  isPreview?: boolean;
  cleanAppId?: string;
  appConfig?: WebAppProps | null;
}

/**
 * Check if we're running inside an iframe (the editor embeds preview in iframe)
 */
function getIsInEditorIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch (e) {
    // If we can't access window.top due to cross-origin restrictions,
    // we're definitely in an iframe
    return true;
  }
}

/**
 * Client-side wrapper that provides React Context to children.
 * Provides React Context (AppContext, EditMode, etc.) to children.
 * 
 * IMPORTANT: EditModeProvider is only loaded when inside the editor iframe.
 * Opening preview URLs in a new tab will NOT load edit mode components.
 */
export const ClientWrapper: React.FC<ClientWrapperProps> = ({ 
  children, 
  basePath, 
  currentPageSlug,
  currentPageUuid,
  isPreview = false,
  cleanAppId,
  appConfig
}) => {
  // Check if we're in the editor iframe
  const [isInEditorIframe] = useState(() => getIsInEditorIframe());
  
  const appContent = (
    <AppContextProvider basePath={basePath} currentPageSlug={currentPageSlug} currentPageUuid={currentPageUuid}>
      <HashScrollHandler />
      {children}
    </AppContextProvider>
  );

  // Only wrap with ConfigUpdateProvider and EditModeProvider if:
  // 1. In preview mode AND
  // 2. Has cleanAppId AND
  // 3. Running inside the editor iframe
  if (isPreview && cleanAppId && isInEditorIframe) {
    return (
      <ConfigUpdateProvider initialConfig={appConfig || null}>
        <EditModeProvider isPreview={isPreview} appId={cleanAppId}>
          <NavigationGuard>
            {appContent}
          </NavigationGuard>
        </EditModeProvider>
      </ConfigUpdateProvider>
    );
  }

  return appContent;
};

export default ClientWrapper;