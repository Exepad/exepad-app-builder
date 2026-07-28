
import React from 'react';
import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';
import { DynamicRendererList } from './DynamicRenderer';
import { areComponentsEqual } from '../utils/componentComparison';

interface PersistentHeaderProps {
  components: ComponentProps[];
}

/**
 * Memoized header that persists across page navigations.
 * Renders a semantic <header> element — the code component inside
 * owns all positioning, scroll behavior, and visual styling.
 */
const PersistentHeader = React.memo(({ components }: PersistentHeaderProps) => {
  return (
    <header className="app-header" data-navigation-area="true">
      <DynamicRendererList
        components={components}
        isInHeader={true}
      />
    </header>
  );
}, (prevProps, nextProps) => {
  return areComponentsEqual(prevProps.components, nextProps.components);
});

PersistentHeader.displayName = 'PersistentHeader';

export default PersistentHeader;
