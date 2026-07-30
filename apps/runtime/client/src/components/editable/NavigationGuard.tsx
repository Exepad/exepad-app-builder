
import { useEffect } from 'react';
import { useEditMode } from '@/context/EditModeContext';

interface NavigationGuardProps {
  children: React.ReactNode;
}

export function NavigationGuard({ children }: NavigationGuardProps) {
  const { isEditMode } = useEditMode();

  useEffect(() => {
    if (!isEditMode) return;

    // Add CSS class to body for styling
    document.body.classList.add('edit-mode-active');

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if click is on a link
      const clickedLink = target.closest('a[href]') as HTMLAnchorElement;
      if (!clickedLink) return;

      const href = clickedLink.getAttribute('href');
      if (!href) return;

      // In edit mode, prevent all link navigation so component selection works.
      // Clicks on links select the element instead of navigating.
      e.preventDefault();
    };

    // Use capture phase to intercept before any component handlers
    document.addEventListener('click', handleClick, true);

    return () => {
      document.body.classList.remove('edit-mode-active');
      document.removeEventListener('click', handleClick, true);
    };
  }, [isEditMode]);

  return <>{children}</>;
}