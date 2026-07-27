// src/components/DynamicTheme.tsx
import { hexToHsl } from '@/lib/colors';
import { ThemeProps, ColorPaletteProps, ChartPaletteProps, StyleVariableProps } from '@/app_runtime/interfaces/apps/core';

/**
 * Sanitize a CSS property name (variable name).
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
function sanitizeCssName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '');
}

/**
 * Convert camelCase property names to kebab-case for CSS custom properties.
 * Two-pass: lowercase→uppercase (shadowSm→shadow-sm) + letter→digit (shadow2xl→shadow-2xl).
 */
function camelToKebab(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
}

/**
 * Sanitize a CSS value to prevent injection.
 * Strips characters that could break out of the CSS value context:
 * - `<` / `>` — prevents `</style><script>` injection
 * - `{` / `}` — prevents breaking out of CSS rule blocks
 * - `\` — prevents unicode escapes that could bypass other checks
 * - `@` — prevents @import / @charset injection
 * - `;` — prevents injecting additional CSS properties
 * Also blocks `expression(`, `url(javascript:`, and `url(data:` patterns.
 */
function sanitizeCssValue(value: string): string {
  // Block HTML tag injection, CSS rule breakouts, and property injection via semicolons
  let safe = value.replace(/[<>{}\\;]/g, '');
  // Block @-rules injection
  safe = safe.replace(/@/g, '');
  // Block expression() (IE CSS expression), -moz-binding, and behavior
  safe = safe.replace(/expression\s*\(/gi, '');
  safe = safe.replace(/-moz-binding\s*:/gi, '');
  safe = safe.replace(/behavior\s*:/gi, '');
  // Block javascript: and data: inside url()
  safe = safe.replace(/url\s*\(\s*['"]?\s*javascript:/gi, 'url(blocked:');
  safe = safe.replace(/url\s*\(\s*['"]?\s*data:/gi, 'url(blocked:');
  return safe;
}

const DynamicTheme = ({ theme }: { theme?: ThemeProps }) => {
  if (!theme) {
    return null;
  }

  const generateColorVariables = (colors?: ColorPaletteProps): string => {
    if (!colors) return '';
    return Object.entries(colors)
      .map(([name, value]) => {
        if (!value) return '';
        const safeName = sanitizeCssName(name);
        // Check if value is already in HSL format (contains space and %)
        const isHsl = typeof value === 'string' && value.includes(' ') && value.includes('%');
        const hslValue = isHsl ? value : hexToHsl(value);
        return `--${safeName}: ${sanitizeCssValue(hslValue)};`;
      })
      .join('\n');
  };

  const generateChartVariables = (charts?: ChartPaletteProps): string => {
    if (!charts) return '';
    return Object.entries(charts)
      .map(([name, value]) => {
        if (!value) return '';
        const safeName = sanitizeCssName(name);
        // Check if value is already in HSL format (contains space and %)
        const isHsl = typeof value === 'string' && value.includes(' ') && value.includes('%');
        const hslValue = isHsl ? value : hexToHsl(value);
        return `--${safeName}: ${sanitizeCssValue(hslValue)};`;
      })
      .join('\n');
  };

  const generateStyleVariables = (styles?: StyleVariableProps): string => {
    if (!styles) return '';
    return Object.entries(styles)
      .map(([name, value]) => value ? `--${sanitizeCssName(camelToKebab(name))}: ${sanitizeCssValue(value)};` : '')
      .join('\n');
  };

  const generateLayoutVariables = (layout?: ThemeProps['layout']): string => {
    if (!layout) return '';
    return Object.entries(layout)
      .map(([name, value]) => value ? `--${sanitizeCssName(camelToKebab(name))}: ${sanitizeCssValue(value)};` : '')
      .join('\n');
  };

  // New function to generate font size variables
  const generateFontSizeVariables = (fontSizes?: ThemeProps['fontSizes']): string => {
    if (!fontSizes) return '';
    return Object.entries(fontSizes)
      .map(([key, value]) => value ? `--font-size-${sanitizeCssName(key)}: ${sanitizeCssValue(value)};` : '')
      .join('\n');
  };

  const lightThemeColors = generateColorVariables(theme.light);
  const darkThemeColors = generateColorVariables(theme.dark);
  const chartVariables = generateChartVariables(theme.charts);
  const styleVariables = generateStyleVariables(theme.styles);
  const layoutVariables = generateLayoutVariables(theme.layout);
  const fontSizeVariables = generateFontSizeVariables(theme.fontSizes);

  const otherStyles = `
    ${theme.radius ? `--radius: ${sanitizeCssValue(theme.radius)};` : ''}
    ${theme.spacing?.y ? `--spacing-section-y: ${sanitizeCssValue(theme.spacing.y)};` : ''}
    ${theme.spacing?.x ? `--spacing-section-x: ${sanitizeCssValue(theme.spacing.x)};` : ''}
  `;

  const themeStyles = `
    :root {
      ${lightThemeColors}
      ${chartVariables}
      ${otherStyles}
      ${styleVariables}
      ${layoutVariables}
      ${fontSizeVariables}
    }
    .dark {
      ${darkThemeColors}
    }
  `;

  // Dark mode class is managed solely by DefaultThemeApplier (useLayoutEffect).
  // No inline <script> needed in a pure SPA — DefaultThemeApplier runs before paint.
  return <style dangerouslySetInnerHTML={{ __html: themeStyles.trim() }} />;
};

export default DynamicTheme;
