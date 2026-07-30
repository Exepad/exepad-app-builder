/**
 * Font Variables Component
 * Injects CSS custom properties for fonts
 * Works for both server and client components
 */

import { ThemeProps } from '@/interfaces/apps/core';
import { generateFontVariables } from '@/utils/fontUtils';

/**
 * Generates and injects font CSS custom properties
 * Can be used in both server and client components
 */
export default function FontVariables({ fonts }: { fonts?: ThemeProps['fonts'] }) {
  const fontVariables = generateFontVariables(fonts);

  if (!fontVariables) {
    return null;
  }

  return <style dangerouslySetInnerHTML={{ __html: fontVariables }} />;
}
