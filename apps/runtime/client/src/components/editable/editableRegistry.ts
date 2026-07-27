import React from 'react';

// Lazy-load EditableCodeComponent so it's excluded from published app bundles.
// It's only needed in preview/edit mode.
const LazyEditableCodeComponent = React.lazy(
  () => import('./EditableCodeComponent')
);

// Registry mapping component types to their editable versions
const editableComponents: Record<string, React.LazyExoticComponent<any>> = {
  'CodeComponentProps': LazyEditableCodeComponent,
};

// Type helper to check if a component type has an editable version
export type EditableComponentType = keyof typeof editableComponents;

export function isEditableComponent(componentType: string): boolean {
  return componentType in editableComponents;
}

export function getEditableComponent(componentType: string): React.LazyExoticComponent<any> | null {
  return editableComponents[componentType] ?? null;
}
