
import { useLayoutEffect } from 'react';

interface DefaultThemeApplierProps {
  defaultTheme?: 'light' | 'dark';
}

/**
 * Applies the `.dark` class to <html> when defaultTheme is "dark".
 * Uses useLayoutEffect to minimize flash of incorrect theme.
 * Cleans up on unmount so navigating between apps resets the class.
 */
export function DefaultThemeApplier({ defaultTheme }: DefaultThemeApplierProps) {
  useLayoutEffect(() => {
    if (defaultTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [defaultTheme]);

  return null;
}
