
import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useEditMode } from '@/context/EditModeContext';
import { useAppStore } from '@/stores/appStore';
import { Loader2, Image as ImageIcon } from 'lucide-react';

// Significant elements for sub-element selection within components
const SIGNIFICANT_SELECTORS = 'h1, h2, h3, h4, h5, h6, p, span, li, blockquote, figcaption, button, a, img, nav, section, article, header, footer, form, table, video, audio, figure';

const TAG_TO_DISPLAY: Record<string, string> = {
  h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  p: 'Text', span: 'Text', blockquote: 'Quote', figcaption: 'Caption',
  li: 'List Item', button: 'Button', a: 'Link',
  img: 'Image', video: 'Video', audio: 'Audio',
  nav: 'Navigation', section: 'Section', article: 'Article',
  header: 'Header', footer: 'Footer',
  form: 'Form', table: 'Table', figure: 'Figure',
};

function findSignificantElement(target: HTMLElement, container: HTMLElement | null): HTMLElement | null {
  if (!container) return null;
  let el: HTMLElement | null = target;
  while (el && el !== container) {
    if (el.matches(SIGNIFICANT_SELECTORS)) return el;
    el = el.parentElement;
  }
  return null;
}

interface ComponentWrapperProps {
  componentId: string;
  componentType: string;
  children: React.ReactNode;
}

export function ComponentWrapper({ componentId, componentType, children }: ComponentWrapperProps) {
  // Use Zustand selectors for fine-grained reactivity
  // Only re-renders when THIS component's selection/processing state changes
  const isSelected = useAppStore(state => state.selectedComponentId === componentId);
  const isProcessing = useAppStore(state => state.processingComponentIds.has(componentId));

  // These don't change on selection, safe to get from context
  const { isEditMode, selectComponent, sendWebSocketMessage } = useEditMode();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isImageComponent = componentType === 'ImageProps';

  // Handle replace action
  const handleReplace = (e: React.MouseEvent) => {
    e.stopPropagation();

    console.log('[ComponentWrapper] Replace clicked for component:', componentId);

    // Send replace request to frontend via WebSocket
    sendWebSocketMessage({
      type: 'action_request',
      data: {
        action: 'replace',
        componentId: componentId,
        componentType: componentType,
        payload: {}
      }
    });
  };

  useEffect(() => {
    if (!isEditMode) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (isSelected && wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        const clickedElement = event.target as HTMLElement;
        // Don't deselect if clicking on another component wrapper
        if (!clickedElement.closest('[data-component-wrapper]')) {
          selectComponent(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSelected, selectComponent, isEditMode]);

  const handleClick = (e: React.MouseEvent) => {
    if (!isEditMode || isProcessing) return;

    e.stopPropagation();

    // Find the specific UI element that was clicked for granular selection
    const target = e.target as HTMLElement;
    const significantEl = findSignificantElement(target, wrapperRef.current);

    if (significantEl) {
      const elementText = significantEl.innerText?.trim().slice(0, 100) || '';
      const tag = significantEl.tagName.toLowerCase();
      const displayType = TAG_TO_DISPLAY[tag] || tag;

      selectComponent(componentId, {
        componentType: displayType,
        textPreview: elementText,
      }, significantEl);
    } else {
      const textContent = wrapperRef.current?.innerText?.trim().slice(0, 100) || '';
      selectComponent(componentId, {
        componentType: componentType.replace('Props', ''),
        textPreview: textContent,
      }, wrapperRef.current);
    }
  };

  // Always render the wrapper to prevent layout shifts, but conditionally apply styling.
  // Outside edit mode: use 'contents' to avoid breaking flex/grid layouts.
  // In edit mode: use a regular block wrapper so mouse events and CSS outline work.
  return (
    <div
      ref={wrapperRef}
      data-component-wrapper={isEditMode ? 'true' : undefined}
      data-component-id={isEditMode ? componentId : undefined}
      data-component-type={isEditMode ? componentType : undefined}
      className={cn(
        // Outside edit mode: invisible wrapper via 'contents'
        !isEditMode && 'contents',
        // In edit mode (not selected/processing): hoverable with CSS outline
        isEditMode && !isSelected && !isProcessing && [
          'relative cursor-pointer',
          'hover:outline hover:outline-1 hover:outline-gray-300 hover:outline-offset-2 hover:rounded-md',
        ],
        // In edit mode (selected or processing): positioned wrapper for overlays.
        // NOTE: the blue selection highlight is drawn by <SelectionOverlay> (a
        // portaled, position:fixed box) — not a ring here — because a ring is a
        // box-shadow that gets clipped by HybridPageTransition's overflow:hidden
        // wrapper and would only ever outline the whole code component, not the
        // clicked sub-element.
        isEditMode && (isSelected || isProcessing) && 'relative transition-all duration-200 group/component',
        isEditMode && isProcessing && 'ring-2 ring-gray-400 ring-offset-2 rounded-md shadow-lg',
        isProcessing && 'pointer-events-none' // Disable interactions when processing
      )}
      onClick={handleClick}
    >
      {/* Processing Indicator */}
      {isEditMode && isProcessing && (
        <>
          {/* Animated spinner badge with Apple-style gray */}
          <div className="absolute -top-8 left-2 flex items-center gap-2 px-3 py-1.5 rounded-full transition-opacity duration-200 z-20 bg-gradient-to-br from-gray-700 to-gray-800 text-white border border-gray-600 shadow-xl backdrop-blur-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-200" />
            <span className="text-xs font-medium tracking-wide text-gray-100">Working on...</span>
          </div>

          {/* Subtle animated overlay */}
          <div className="absolute inset-0 pointer-events-none rounded-md bg-gray-500/5 z-10 animate-pulse" />

          {/* Elegant animated border pulse effect */}
          <div className="absolute inset-0 rounded-md z-10">
            <div className="absolute inset-0 rounded-md border-2 border-gray-400/60 opacity-75 animate-pulse" />
          </div>
        </>
      )}

      {/* Action Buttons - Show when selected and not processing */}
      {isEditMode && isSelected && !isProcessing && (
        <div className="absolute -top-2 right-2 flex items-center gap-1 z-20">
          {isImageComponent && (
            <button
              onClick={handleReplace}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-gray-700 to-gray-800 text-white border border-gray-600 shadow-lg hover:shadow-xl hover:from-gray-600 hover:to-gray-700 transition-all duration-200 backdrop-blur-sm"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium tracking-wide">Replace</span>
            </button>
          )}
        </div>
      )}

      {/* Selection highlight is rendered by <SelectionOverlay> (portaled to body)
          so it can't be clipped by the page-transition wrapper and tracks the
          actual clicked sub-element. */}

      {/* Actual Component - Subtly dimmed when processing */}
      <div className={cn(
        // Always use 'contents' for inner wrapper to preserve flex/grid layouts
        'contents',
        isProcessing && 'opacity-70 select-none'
      )}>
        {children}
      </div>
    </div>
  );
}

export default ComponentWrapper;
