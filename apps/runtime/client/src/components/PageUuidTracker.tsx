import { useEffect, useRef } from 'react';
import { useEditMode } from '../context/EditModeContext';
import { useAppStore } from '../stores/appStore';
import { getEditorOrigin } from '../lib/editor-origin';

interface PageUuidTrackerProps {
  pageUuid: string;
  appId: string;
}

/**
 * Client component that tracks page UUID changes and sends them to the parent window
 * via postMessage (for immediate availability) and WebSocket (when connected)
 */
export const PageUuidTracker: React.FC<PageUuidTrackerProps> = ({ pageUuid, appId }) => {
  const { sendWebSocketMessage, isEditMode } = useEditMode();
  const wsConnectionStatus = useAppStore(state => state.wsConnectionStatus);
  const lastSentPageUuid = useRef<string | null>(null);

  useEffect(() => {
    if (pageUuid && lastSentPageUuid.current !== pageUuid) {
      // Announce the pageUuid to the parent editor as soon as we know it.
      // Targeted at editorOrigin only, so non-editor parents never see it —
      // safe to emit before the runtime has entered edit mode.
      try {
        const editorOrigin = getEditorOrigin();
        window.parent.postMessage({
          type: 'page_changed',
          pageUuid: pageUuid,
          appId: appId,
          source: 'exepad-runtime'
        }, editorOrigin);
      } catch (error) {
        console.error('Failed to send postMessage:', error);
      }

      // The WebSocket channel is only meaningful while the runtime is in edit mode.
      if (isEditMode && wsConnectionStatus === 'connected') {
        sendWebSocketMessage({
          type: 'page_changed',
          data: {
            pageUuid: pageUuid,
            appId: appId
          }
        });
      }

      lastSentPageUuid.current = pageUuid;
    }
  }, [pageUuid, appId, isEditMode, wsConnectionStatus, sendWebSocketMessage]);

  // This component doesn't render anything
  return null;
};

