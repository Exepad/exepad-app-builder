// src/components/DynamicRenderer.tsx

/**
 * Core Renderer Engine
 * Takes a Component configuration and renders it.
 * Code components handle their own state, data fetching, and logic via SDK hooks.
 */

import React from 'react';
import type { LayoutOption } from '@/app_runtime/interfaces/apps/core';
import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';
import { getComponent, getComponentSync } from '../registry';
import { areComponentsEqual } from '../utils/componentComparison';
import { cn } from '@/lib/utils';
import { ComponentErrorBoundary } from './ComponentErrorBoundary';
import { useEditMode } from '../context/EditModeContext';
import { useConfigUpdate } from '../context/ConfigUpdateContext';
import { getEditableComponent, isEditableComponent } from './editable/editableRegistry';
import { ComponentWrapper } from './editable/ComponentWrapper';

interface DynamicRendererProps {
  /** Component configuration to render */
  component: ComponentProps;
  pageLayout?: LayoutOption; // Layout inherited from page
  children?: React.ReactNode; // Allow children to be passed
  isInHeader?: boolean; // Whether this component is being rendered inside a header context
}

/**
 * Check if component should be rendered based on showWhen or visibilityCondition props.
 * Only supports boolean values — expression-based conditions are no longer supported.
 * Code components handle their own visibility in JSX.
 */
function shouldRenderComponent(
  props: Record<string, unknown>
): boolean {
  const condition = props.showWhen ?? props.visibilityCondition;
  if (condition === undefined) return true;
  return Boolean(condition);
}

/**
 * A fallback component displayed when a component type is not found or fails to load.
 */
export const ComponentFallback: React.FC<{ componentType: string; classes?: string }> = ({
  componentType,
  classes
}) => (
  <div className={`p-4 border border-red-300 bg-red-50 text-red-700 rounded ${classes || ''}`}>
    <p className="font-semibold">Component not found: {componentType}</p>
    <p className="text-sm">This component type is not registered or failed to load.</p>
  </div>
);

/**
 * The inner rendering logic, wrapped for memoization.
 */
const DynamicRendererInner: React.FC<DynamicRendererProps> = ({
  component, pageLayout, children, isInHeader
}) => {
  // ============================================
  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
  // (React Rules of Hooks - no early returns before hooks)
  // ============================================
  
  // Get edit mode state
  const { isEditMode, isPreview } = useEditMode();
  
  // Get config update context for hot reload
  const { subscribeToComponent } = useConfigUpdate();
  
  // Track render key for forcing updates
  const [renderKey, setRenderKey] = React.useState(0);
  
  // Track the current component data (may be updated via hot reload)
  const [currentComponent, setCurrentComponent] = React.useState(component);
  
  // Track if component is deleted
  const [isDeleted, setIsDeleted] = React.useState(false);

  // Extract componentType for determining editable components
  const { componentType, ...props } = currentComponent;
  
  // Determine if we have an editable version and whether we should always use it
  const EditableComp = componentType && isEditableComponent(componentType) ? getEditableComponent(componentType) : null;
  // Only route through the editable wrapper inside the editor (preview). On
  // published / read-only views, render CodeComponentProps via the plain
  // CodeComponent so the editor-only chunk (EditableCodeComponent + its
  // Suspense boundary, wrapper div, and MutationObserver) stays out of the
  // published critical path — which is exactly why editableRegistry lazy-splits
  // it. Gating on `isPreview` (not `isEditMode`) keeps the editor experience
  // byte-for-byte unchanged: the wrapper is mounted throughout preview and
  // `isEditMode` continues to toggle behavior inside it. Previously this was
  // unconditional, so every published visitor downloaded a serial editor chunk
  // that gated the first render.
  const useEditableAlways = !!EditableComp && componentType === 'CodeComponentProps' && isPreview;
  
  // Async-loaded runtime component state
  // Check cache synchronously first to avoid loading state flicker
  const cachedComponent = componentType ? getComponentSync(componentType) : null;
  const [ReactComponent, setReactComponent] = React.useState<React.ComponentType<any> | null>(() => cachedComponent);
  const [isLoading, setIsLoading] = React.useState(!cachedComponent && !useEditableAlways);
  const [error, setError] = React.useState<string | null>(null);

  // Subscribe to component updates for hot reload (only in edit mode)
  React.useEffect(() => {
    // Only subscribe if we're in edit mode and have a valid uuid
    // This prevents unnecessary subscriptions in read-only mode (new tab)
    if (!component.uuid || !isEditMode) return;
    
    if (import.meta.env.MODE === 'development') console.log(`[DynamicRenderer] Subscribing to updates for component ${component.uuid}`);
    
    const unsubscribe = subscribeToComponent(component.uuid, (updatedComponent) => {
      if (import.meta.env.MODE === 'development') console.log(`[DynamicRenderer] Component ${component.uuid} received update, applying new data`);
      // Update the component data with the new data from ConfigUpdateContext
      setCurrentComponent(updatedComponent);
      setRenderKey(k => k + 1);
    });
    
    return unsubscribe;
  }, [component.uuid, subscribeToComponent, isEditMode]);
  
  // Listen for direct component update events (for hot reload).
  // Editor-only machinery: gate on isEditMode (like the subscription effect
  // above) so published visitors don't install one window-level listener per
  // component — the 'component-updated' event is never dispatched on published
  // pages, so the listener is pure overhead there.
  React.useEffect(() => {
    if (!component.uuid || !isEditMode) return;

    const handleComponentUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.componentId === component.uuid) {
        if (import.meta.env.MODE === 'development') console.log(`[DynamicRenderer] Force re-render for component ${component.uuid}`);
        
        // Handle removal
        if (customEvent.detail?.changeType === 'remove') {
          if (import.meta.env.MODE === 'development') console.log(`[DynamicRenderer] Component ${component.uuid} removed, unmounting`);
          setIsDeleted(true);
          return;
        }
        
        // Update component data directly if provided in event
        if (customEvent.detail.newConfig) {
          setCurrentComponent(customEvent.detail.newConfig);
        }
        
        // Force re-render by incrementing key
        setRenderKey(k => k + 1);
      }
    };
    
    window.addEventListener('component-updated', handleComponentUpdate);
    return () => window.removeEventListener('component-updated', handleComponentUpdate);
  }, [component.uuid, isEditMode]);
  
  // Update currentComponent when component prop changes
  React.useEffect(() => {
    setCurrentComponent(component);
  }, [component]);

  // Load async component only when needed
  React.useEffect(() => {
    // Skip loading if no componentType, using editable version always,
    // or already have the component from cache
    if (!componentType || useEditableAlways || ReactComponent) {
      if (ReactComponent && isLoading) setIsLoading(false);
      return;
    }
    
    let isMounted = true;
    const loadComponent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const loadedComp = await getComponent(componentType);
        if (isMounted) {
          if (loadedComp) {
            setReactComponent(() => loadedComp);
          } else {
            setError(`Component type "${componentType}" not found in registry.`);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(`Failed to load component ${componentType}: ${err.message}`);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    loadComponent();
    return () => { isMounted = false; };
  }, [componentType, useEditableAlways, ReactComponent]);

  // ============================================
  // EARLY RETURNS (safe - all hooks called above)
  // ============================================

  // Handle cases where the component data is invalid.
  if (!componentType) {
    console.error(`[DynamicRenderer] Received component without componentType:`, currentComponent);
    return <ComponentFallback componentType="undefined" classes={(props as any).classes} />;
  }
  
  // If deleted, do not render anything
  if (isDeleted) {
    return null;
  }

  // While the CodeComponent module chunk loads, render nothing rather than a
  // fixed-size box: CodeComponent mounts its own (optionally height-reserved)
  // skeleton immediately after, so a stray sized placeholder here would itself
  // cause a layout shift on the published path (it was previously masked by the
  // editable wrapper's `Suspense fallback={null}`).
  if (!useEditableAlways && isLoading) {
    return null;
  }

  // If loading failed or the component is not found, show the fallback UI.
  if (!useEditableAlways && (error || !ReactComponent)) {
    return <ComponentFallback componentType={componentType} classes={(props as any).classes} />;
  }

  // ============================================
  // RENDER LOGIC (all hooks already called)
  // ============================================

  // Check showWhen condition - hide component if condition is false
  if (!shouldRenderComponent(props as Record<string, unknown>)) {
    return null;
  }

  // Extract uuid separately for ComponentWrapper reference
  const { uuid, componentType: _, ...cleanProps } = currentComponent;

  const FinalComponent = useEditableAlways ? (EditableComp as React.ComponentType<any>) : (ReactComponent as React.ComponentType<any>);

  // Pass props as-is — code components handle their own state via SDK hooks
  const finalProps = { ...cleanProps, uuid };

  // Determine if we should use React children or let the component use its own children prop from config
  // If the component config has a 'children' prop (e.g., ModalProps, SheetProps), don't override it with JSX children
  const hasConfigChildren = 'children' in cleanProps && cleanProps.children !== undefined;
  const useReactChildren = children && !hasConfigChildren;

  const rendered = (
    <ComponentErrorBoundary componentType={componentType} componentId={uuid}>
      {useReactChildren ? (
        <FinalComponent key={`${uuid}-${renderKey}`} {...finalProps}>
          {children}
        </FinalComponent>
      ) : (
        <FinalComponent key={`${uuid}-${renderKey}`} {...finalProps} />
      )}
    </ComponentErrorBoundary>
  );

  // Wrap in Suspense when using a lazy-loaded editable component
  const content = useEditableAlways ? (
    <React.Suspense fallback={null}>{rendered}</React.Suspense>
  ) : rendered;

  // Always render ComponentWrapper when we have a uuid to keep the tree shape stable
  if (uuid) {
    return (
      <ComponentWrapper 
        componentId={uuid} 
        componentType={componentType}
      >
        {content}
      </ComponentWrapper>
    );
  }

  // Regular rendering when no uuid (non-selectable)
  return content;
};

// Memoize the renderer to prevent unnecessary re-renders.
export const DynamicRenderer = React.memo(DynamicRendererInner);

/** Article spacing options for vertical rhythm between content blocks */
type ArticleSpacing = 'sm' | 'md' | 'lg' | 'xl';

/** Spacing classes map - mirrors Section.tsx pattern */
const articleSpacingClasses: Record<ArticleSpacing, string> = {
  sm: 'space-y-4 [&>*]:mt-0 [&>*]:mb-0',
  md: 'space-y-6 [&>*]:mt-0 [&>*]:mb-0',
  lg: 'space-y-8 [&>*]:mt-0 [&>*]:mb-0',
  xl: 'space-y-12 [&>*]:mt-0 [&>*]:mb-0',
};

/**
 * A helper component to render a list of components.
 */
const DynamicRendererListInner: React.FC<{
  components: ComponentProps[];
  className?: string;
  pageLayout?: LayoutOption;
  isInHeader?: boolean; // Whether these components are being rendered inside a header context
  articleSpacing?: ArticleSpacing; // Optional article spacing for vertical rhythm
}> = ({ components, className, pageLayout, isInHeader, articleSpacing }) => {
  if (!components || !Array.isArray(components) || components.length === 0) {
    return null;
  }

  const renderComponent = (component: ComponentProps, index: number) => (
    <DynamicRenderer
      key={component.uuid || `${component.componentType}-${index}`}
      component={component}
      pageLayout={pageLayout}
      isInHeader={isInHeader}
    />
  );

  // If there's only one component, render it directly without a wrapper div.
  // This is crucial for layout components like Sidebar to work correctly.
  if (components.length === 1 && !className && !articleSpacing) {
    return renderComponent(components[0], 0);
  }

  // Build combined classes with article spacing if provided
  const combinedClasses = cn(
    articleSpacing && articleSpacingClasses[articleSpacing],
    className
  );

  return (
    <div className={combinedClasses || undefined}>
      {components.map(renderComponent)}
    </div>
  );
};

// Memoized version of DynamicRendererList to prevent unnecessary re-renders
// Uses optimized epoch-based comparison instead of expensive JSON.stringify
export const DynamicRendererList = React.memo(DynamicRendererListInner, (prevProps, nextProps) => {
  // Fast comparison using epoch-based detection
  return (
    prevProps.className === nextProps.className &&
    prevProps.pageLayout === nextProps.pageLayout &&
    prevProps.isInHeader === nextProps.isInHeader &&
    prevProps.articleSpacing === nextProps.articleSpacing &&
    areComponentsEqual(prevProps.components, nextProps.components)
  );
});

export default DynamicRenderer;
