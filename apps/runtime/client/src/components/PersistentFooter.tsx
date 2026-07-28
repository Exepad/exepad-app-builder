
import React from 'react';
import { ComponentProps } from '@/app_runtime/interfaces/components/common/core';
import { DynamicRendererList } from './DynamicRenderer';

interface PersistentFooterProps {
  components: ComponentProps[];
}

// Memoized footer component that only re-renders when props actually change
const PersistentFooter = React.memo(({ components }: PersistentFooterProps) => {
  return (
    <footer className="app-footer" data-navigation-area="true">
      <DynamicRendererList components={components} />
    </footer>
  );
});

PersistentFooter.displayName = 'PersistentFooter';

export default PersistentFooter;
