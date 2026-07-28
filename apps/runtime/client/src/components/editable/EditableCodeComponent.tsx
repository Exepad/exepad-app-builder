
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditMode } from '@/context/EditModeContext';
import { CodeComponentProps } from '@/app_runtime/interfaces/code_components/code_component';
import CodeComponent from '@/app_runtime/runtime/components/custom/code/CodeComponent';
import { cn } from '@/lib/utils';

interface EditableCodeComponentProps extends CodeComponentProps {
  placeholder?: string;
}

// Selectors for text elements that should be editable
const EDITABLE_SELECTORS = 'h1, h2, h3, h4, h5, h6, p, span, li, blockquote, figcaption';

// Selectors for significant UI elements that should be individually selectable
const SIGNIFICANT_SELECTORS = 'h1, h2, h3, h4, h5, h6, p, span, li, blockquote, figcaption, button, a, img, nav, section, article, header, footer, form, table, video, audio, figure';

// Map HTML tags to display-friendly names for the selection box
const TAG_TO_DISPLAY: Record<string, string> = {
  h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  p: 'Text', span: 'Text', blockquote: 'Quote', figcaption: 'Caption',
  li: 'List Item', button: 'Button', a: 'Link',
  img: 'Image', video: 'Video', audio: 'Audio',
  nav: 'Navigation', section: 'Section', article: 'Article',
  header: 'Header', footer: 'Footer',
  form: 'Form', table: 'Table', figure: 'Figure',
};

/**
 * Walk up from the click target to find the nearest significant UI element.
 * Stops at the container boundary.
 */
function findSignificantElement(target: HTMLElement, container: HTMLElement | null): HTMLElement | null {
  if (!container) return null;
  let el: HTMLElement | null = target;
  while (el && el !== container) {
    if (el.matches(SIGNIFICANT_SELECTORS)) return el;
    el = el.parentElement;
  }
  return null;
}

export function EditableCodeComponent({ uuid, ...props }: EditableCodeComponentProps) {
  const { isEditMode, updateContent, selectComponent } = useEditMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isComponentLoaded, setIsComponentLoaded] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Handle click on container — select the specific UI element that was clicked.
  // stopPropagation prevents ComponentWrapper from overriding with whole-component selection.
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (!isEditMode || !uuid) return;

    e.stopPropagation();

    const target = e.target as HTMLElement;
    const significantEl = findSignificantElement(target, containerRef.current);

    if (significantEl) {
      const elementText = significantEl.innerText?.trim().slice(0, 100) || '';
      const tag = significantEl.tagName.toLowerCase();
      const displayType = TAG_TO_DISPLAY[tag] || tag;

      selectComponent(uuid, {
        componentType: displayType,
        textPreview: elementText,
      }, significantEl);
    } else {
      const textContent = containerRef.current?.innerText?.trim().slice(0, 100) || '';
      selectComponent(uuid, {
        componentType: 'Section',
        textPreview: textContent,
      }, containerRef.current);
    }
  }, [isEditMode, uuid, selectComponent]);

  // Handle text change on blur
  const handleTextChange = useCallback((el: HTMLElement, idx: number, originalText: string) => {
    const newText = el.innerText.trim();

    if (newText !== originalText && uuid) {
      updateContent(
        `${uuid}:text_${idx}`,
        newText,
        'CodeComponentProps',
        `textEdits.${idx}`
      );
    }
  }, [uuid, updateContent]);

  // Make text elements editable
  const enableEditMode = useCallback(() => {
    if (!containerRef.current || !isEditMode) return;

    const textElements = containerRef.current.querySelectorAll(EDITABLE_SELECTORS);
    const handlers = new Map<HTMLElement, { blur: () => void; focus: () => void; keydown: (e: KeyboardEvent) => void }>();

    // First pass: identify all elements with text content
    const candidateElements = new Set<HTMLElement>();
    textElements.forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl.isContentEditable) return;
      const textContent = htmlEl.innerText.trim();
      if (!textContent) return;
      candidateElements.add(htmlEl);
    });

    // Second pass: keep only top-level elements (no ancestor in the candidate set)
    // This ensures that if h2 contains span, we make h2 editable (not span separately)
    const topLevelElements: HTMLElement[] = [];
    candidateElements.forEach((el) => {
      let hasEditableAncestor = false;
      let parent = el.parentElement;

      while (parent && parent !== containerRef.current) {
        if (candidateElements.has(parent)) {
          hasEditableAncestor = true;
          break;
        }
        parent = parent.parentElement;
      }

      if (!hasEditableAncestor) {
        topLevelElements.push(el);
      }
    });

    // Make top-level elements editable
    topLevelElements.forEach((htmlEl, idx) => {
      const originalText = htmlEl.innerText.trim();

      // Make editable
      htmlEl.contentEditable = 'true';
      htmlEl.dataset.editableIdx = String(idx);
      htmlEl.dataset.originalText = originalText;

      // Add visual cues for editability
      htmlEl.style.outline = 'none';
      htmlEl.style.cursor = 'text';
      // Ensure cursor is visible even with text-transparent (gradient text)
      htmlEl.style.caretColor = '#3b82f6'; // Blue cursor for visibility

      // Create handlers
      const blurHandler = () => {
        handleTextChange(htmlEl, idx, originalText);
        htmlEl.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-1');
      };

      const focusHandler = () => {
        htmlEl.classList.add('ring-2', 'ring-blue-400', 'ring-offset-1');
      };

      const keydownHandler = (e: KeyboardEvent) => {
        // Prevent Enter from creating new lines in single-line elements
        if (e.key === 'Enter' && !e.shiftKey) {
          const tagName = htmlEl.tagName.toLowerCase();
          if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span'].includes(tagName)) {
            e.preventDefault();
            htmlEl.blur();
          }
        }
        // Allow Escape to cancel editing
        if (e.key === 'Escape') {
          htmlEl.innerText = originalText;
          htmlEl.blur();
        }
      };

      // Add event listeners
      htmlEl.addEventListener('blur', blurHandler);
      htmlEl.addEventListener('focus', focusHandler);
      htmlEl.addEventListener('keydown', keydownHandler);

      handlers.set(htmlEl, { blur: blurHandler, focus: focusHandler, keydown: keydownHandler });
    });

    // Return cleanup function
    return () => {
      handlers.forEach((h, el) => {
        el.contentEditable = 'false';
        el.removeEventListener('blur', h.blur);
        el.removeEventListener('focus', h.focus);
        el.removeEventListener('keydown', h.keydown);
        el.style.cursor = '';
        el.style.caretColor = '';
        el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-1');
        delete el.dataset.editableIdx;
        delete el.dataset.originalText;
      });
    };
  }, [isEditMode, handleTextChange]);

  // Observer to detect when code component content is loaded and DOM has settled.
  // Uses MutationObserver with a settling window: after mutations stop for 150ms,
  // the component is considered loaded. This replaces the old fragile setTimeout(100).
  useEffect(() => {
    if (!containerRef.current || isComponentLoaded) return;

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleIdle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0);

    const markLoaded = () => {
      settleTimer = null;
      scheduleIdle(() => setIsComponentLoaded(true));
    };

    const observer = new MutationObserver(() => {
      // Reset the settle timer on every mutation — wait for DOM to stop changing
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(markLoaded, 150);
    });

    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
    });

    // Initial check — content may already be present
    if (containerRef.current.children.length > 0) {
      settleTimer = setTimeout(markLoaded, 150);
    }

    return () => {
      observer.disconnect();
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [isComponentLoaded]);

  // Enable/disable edit mode when state changes or component loads
  useEffect(() => {
    // Clean up previous edit mode
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // Enable edit mode if conditions are met
    if (isEditMode && isComponentLoaded && uuid) {
      // Use requestIdleCallback to wait for browser idle before enabling edit mode
      const scheduleIdle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0);
      const cancelIdle = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout;
      const idleId = scheduleIdle(() => {
        cleanupRef.current = enableEditMode() || null;
      });

      return () => {
        cancelIdle(idleId as any);
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
      };
    }
  }, [isEditMode, isComponentLoaded, uuid, enableEditMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className={cn(
        "relative h-full",
        isEditMode && "[&_[contenteditable='true']]:transition-shadow [&_[contenteditable='true']]:duration-200",
        isEditMode && "[&_[contenteditable='true']:hover]:ring-1 [&_[contenteditable='true']:hover]:ring-blue-300 [&_[contenteditable='true']:hover]:ring-offset-1",
        props.classes
      )}
    >
      <CodeComponent
        uuid={uuid}
        {...props}
      />

      {/* Edit mode indicator */}
      {isEditMode && isComponentLoaded && (
        <div className="absolute top-2 right-2 z-50 opacity-0 group-hover/component:opacity-100 transition-opacity">
          <span className="text-xs bg-blue-500/90 text-white px-2 py-1 rounded-full shadow-sm">
            Click text to edit
          </span>
        </div>
      )}
    </div>
  );
}

export default EditableCodeComponent;
