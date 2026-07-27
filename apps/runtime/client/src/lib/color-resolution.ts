import { hexToRgb, cssRgbToHex, cssHslToHex, parseArbitraryColorValue } from './colors';
import { TAILWIND_COLOR_MAP, TAILWIND_TEXT_COLOR_MAP } from './tailwind-colors';

/**
 * Parse any CSS color string to RGBA values.
 * Handles: #hex, rgb(), rgba(), hsl(), hsla()
 * This is the universal entry point for the contrast pipeline — unlike hexToRgb,
 * it handles rgba overlay colors (e.g. "rgba(0,0,0,0.6)") that are common on image backgrounds.
 */
export function parseColorToRgb(color: string): { r: number; g: number; b: number; a: number } | null {
  const trimmed = color.trim();

  // Try hex
  const hexRgb = hexToRgb(trimmed);
  if (hexRgb) return { ...hexRgb, a: 1 };

  // Try rgb/rgba — comma-separated or space-separated
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+))?\s*\)/i
  );
  if (rgbaMatch) {
    return {
      r: Math.min(255, parseInt(rgbaMatch[1])),
      g: Math.min(255, parseInt(rgbaMatch[2])),
      b: Math.min(255, parseInt(rgbaMatch[3])),
      a: rgbaMatch[4] !== undefined ? Math.min(1, parseFloat(rgbaMatch[4])) : 1,
    };
  }

  // Try hsl/hsla — convert to hex, then extract alpha separately
  const hex = cssHslToHex(trimmed);
  if (hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const alphaMatch = trimmed.match(/[,/]\s*([\d.]+)\s*\)$/);
    return { ...rgb, a: alphaMatch ? Math.min(1, parseFloat(alphaMatch[1])) : 1 };
  }

  return null;
}

/**
 * Alpha-blend an overlay color onto a base color.
 * Used to compute the effective visible color when a semi-transparent overlay
 * sits on top of a background image or another color.
 */
export function blendOverlayOnBase(
  overlay: { r: number; g: number; b: number; a: number },
  base: { r: number; g: number; b: number }
): { r: number; g: number; b: number } {
  const a = overlay.a;
  return {
    r: Math.round(overlay.r * a + base.r * (1 - a)),
    g: Math.round(overlay.g * a + base.g * (1 - a)),
    b: Math.round(overlay.b * a + base.b * (1 - a)),
  };
}

/**
 * Convert RGB values to a hex string
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Blend two hex colors together
 * @param color1 - First hex color
 * @param color2 - Second hex color
 * @param ratio - Blend ratio (0-1, default 0.5 for even blend)
 * @returns Blended hex color
 */
export function blendColors(color1: string, color2: string, ratio: number = 0.5): string {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) return color1;

  const r = Math.round(rgb1.r * ratio + rgb2.r * (1 - ratio));
  const g = Math.round(rgb1.g * ratio + rgb2.g * (1 - ratio));
  const b = Math.round(rgb1.b * ratio + rgb2.b * (1 - ratio));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Analyze background complexity (gradients, semi-transparency)
 * @param classes - Tailwind classes string
 * @returns Analysis result with complexity flags and average color
 */
export function analyzeBackgroundComplexity(classes?: string): {
  hasGradient: boolean;
  hasSemiTransparency: boolean;
  averageColor: string | null;
} {
  if (!classes) return { hasGradient: false, hasSemiTransparency: false, averageColor: null };

  const hasGradient = /bg-gradient-/.test(classes);
  const hasSemiTransparency = /bg-\w+\/\d+/.test(classes);

  if (hasGradient) {
    // Extract gradient colors and calculate average
    const fromMatch = classes.match(/from-\[#([0-9A-Fa-f]{6})\]/);
    const toMatch = classes.match(/to-\[#([0-9A-Fa-f]{6})\]/);

    if (fromMatch && toMatch) {
      const averageColor = blendColors(`#${fromMatch[1]}`, `#${toMatch[1]}`);
      return { hasGradient: true, hasSemiTransparency: false, averageColor };
    }

    // Try standard Tailwind gradient classes
    const fromStandard = classes.match(/from-(\w+-\d+)/);
    const toStandard = classes.match(/to-(\w+-\d+)/);

    if (fromStandard && toStandard) {
      const fromColor = TAILWIND_COLOR_MAP[`bg-${fromStandard[1]}`];
      const toColor = TAILWIND_COLOR_MAP[`bg-${toStandard[1]}`];

      if (fromColor && toColor) {
        const averageColor = blendColors(fromColor, toColor);
        return { hasGradient: true, hasSemiTransparency: false, averageColor };
      }
    }
  }

  return { hasGradient, hasSemiTransparency, averageColor: null };
}

/**
 * Get effective background color by traversing parent chain.
 * Composites semi-transparent layers (e.g. bg-muted/50) onto the first
 * opaque ancestor instead of stripping alpha, giving the true visual color.
 * @param element - Starting element
 * @returns Composited background color as hex, or null
 */
export function getEffectiveBackgroundColor(element: HTMLElement | null): string | null {
  if (!element) return null;

  let current = element.parentElement;
  let depth = 0;
  const maxDepth = 10;
  // Accumulate semi-transparent layers to composite them
  const layers: { r: number; g: number; b: number; a: number }[] = [];

  while (current && depth < maxDepth) {
    const bg = getComputedStyle(current).backgroundColor;
    const parsed = parseColorToRgb(bg);

    if (parsed && parsed.a > 0.01) {
      if (parsed.a >= 0.99) {
        // Fully opaque — composite any accumulated semi-transparent layers on top
        let base = { r: parsed.r, g: parsed.g, b: parsed.b };
        for (let i = layers.length - 1; i >= 0; i--) {
          base = blendOverlayOnBase(layers[i], base);
        }
        return rgbToHex(base.r, base.g, base.b);
      }
      // Semi-transparent — accumulate for compositing
      layers.push(parsed);
    }

    current = current.parentElement;
    depth++;
  }

  // Only found semi-transparent layers — composite over white (typical page background)
  if (layers.length > 0) {
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      base = blendOverlayOnBase(layers[i], base);
    }
    return rgbToHex(base.r, base.g, base.b);
  }

  return null;
}

/**
 * Resolve color from Tailwind class using temporary DOM element
 * Useful for CSS variables and theme colors
 * @param className - Single Tailwind class
 * @param type - Type of color class ('bg' or 'text')
 * @returns Hex color string or null
 */
export function resolveColorFromClass(className: string, type: 'bg' | 'text' = 'bg'): string | null {
  if (typeof document === 'undefined') return null;

  try {
    const testDiv = document.createElement('div');
    testDiv.className = className;
    testDiv.style.display = 'none';
    testDiv.style.position = 'absolute';
    testDiv.style.pointerEvents = 'none';

    document.body.appendChild(testDiv);

    const computed = getComputedStyle(testDiv);
    const colorValue = type === 'bg' ? computed.backgroundColor : computed.color;

    // Check alpha — bg-transparent resolves to rgba(0,0,0,0); returning "#000000"
    // would be disastrously wrong, so reject fully-transparent results.
    const parsed = parseColorToRgb(colorValue);
    if (!parsed || (type === 'bg' && parsed.a < 0.01)) {
      document.body.removeChild(testDiv);
      return null;
    }

    const hex = cssRgbToHex(colorValue);
    document.body.removeChild(testDiv);
    return hex;
  } catch (error) {
    return null;
  }
}

/**
 * Like resolveColorFromClass but returns the full rgba value as a CSS string.
 * Useful when the caller needs alpha information (e.g. for compositing semi-transparent layers).
 */
export function resolveColorFromClassRgba(className: string, type: 'bg' | 'text' = 'bg'): string | null {
  if (typeof document === 'undefined') return null;

  try {
    const testDiv = document.createElement('div');
    testDiv.className = className;
    testDiv.style.display = 'none';
    testDiv.style.position = 'absolute';
    testDiv.style.pointerEvents = 'none';

    document.body.appendChild(testDiv);

    const computed = getComputedStyle(testDiv);
    const colorValue = type === 'bg' ? computed.backgroundColor : computed.color;

    const parsed = parseColorToRgb(colorValue);
    document.body.removeChild(testDiv);

    if (!parsed || (type === 'bg' && parsed.a < 0.01)) return null;

    // Return as rgba CSS string so parseColorToRgb can recover the alpha later
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${parsed.a})`;
  } catch (error) {
    return null;
  }
}

/**
 * Inject hover styles dynamically for contrast corrections
 * @param elementId - Unique identifier for the element
 * @param hoverTextColor - Text color for hover state
 */
export function injectHoverStyles(elementId: string, hoverTextColor: string): void {
  if (typeof document === 'undefined') return;

  const styleId = `hover-contrast-${elementId}`;

  // Remove existing style if present
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
  }

  // Create new style element
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    [data-contrast-id="${elementId}"]:hover {
      color: ${hoverTextColor} !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Remove injected hover styles
 * @param elementId - Unique identifier for the element
 */
export function removeHoverStyles(elementId: string): void {
  if (typeof document === 'undefined') return;

  const styleId = `hover-contrast-${elementId}`;
  const style = document.getElementById(styleId);
  if (style) {
    style.remove();
  }
}

/**
 * Semantic color classes that require DOM resolution (CSS variables)
 */
const SEMANTIC_COLOR_CLASSES = new Set([
  'bg-primary', 'bg-secondary', 'bg-muted', 'bg-accent',
  'bg-card', 'bg-background', 'bg-foreground', 'bg-destructive',
  'bg-popover', 'bg-input', 'bg-ring', 'bg-border',
  'text-primary', 'text-secondary', 'text-muted', 'text-muted-foreground',
  'text-foreground', 'text-destructive', 'text-accent-foreground',
  'text-card-foreground', 'text-popover-foreground', 'text-primary-foreground',
  'text-secondary-foreground', 'text-destructive-foreground',
]);

/**
 * Check if a class is a semantic color that needs DOM resolution
 */
export function isSemanticColorClass(className: string): boolean {
  // Also check for variants like bg-primary/50
  const baseClass = className.replace(/\/\d+$/, '');
  return SEMANTIC_COLOR_CLASSES.has(baseClass);
}

/**
 * Extract color from a Tailwind class (supports both standard and arbitrary classes)
 * @param className - Single Tailwind class (e.g., "bg-blue-500" or "bg-[#A8C6C3]")
 * @param type - Type of color class ('bg' or 'text')
 * @returns Hex color string or null if not a color class
 */
export function extractColorFromTailwindClass(className: string, type: 'bg' | 'text' = 'bg'): string | null {
  const prefix = type === 'bg' ? 'bg-' : 'text-';

  if (!className.startsWith(prefix)) {
    return null;
  }

  // Check for arbitrary color values: bg-[#...], bg-[rgb(...)], bg-[hsl(...)]
  const arbitraryMatch = className.match(/^(?:bg|text)-\[(.+)\]$/);
  if (arbitraryMatch) {
    const value = arbitraryMatch[1];

    // Skip CSS variables - these need DOM resolution
    if (value.startsWith('var(')) {
      return null;
    }

    return parseArbitraryColorValue(value);
  }

  // Check for opacity modifiers: bg-blue-500/50
  const opacityMatch = className.match(/^((?:bg|text)-[\w-]+)\/\d+$/);
  if (opacityMatch) {
    const baseClass = opacityMatch[1];
    // Recursively extract the base color (ignoring opacity for contrast calculation)
    return extractColorFromTailwindClass(baseClass, type);
  }

  // Check standard Tailwind color from maps
  if (type === 'bg') {
    return TAILWIND_COLOR_MAP[className] || null;
  } else {
    return TAILWIND_TEXT_COLOR_MAP[className] || null;
  }
}

/**
 * Check if a class looks like a color class (not text-center, text-sm, etc.)
 */
function looksLikeColorClass(className: string, type: 'bg' | 'text'): boolean {
  if (type === 'bg') {
    // bg- classes are almost always color-related, except bg-clip, bg-repeat, etc.
    const nonColorBgPatterns = /^bg-(clip|repeat|origin|position|size|attachment|blend|gradient|none|fixed|local|scroll|transparent|inherit|current)/;
    return !nonColorBgPatterns.test(className);
  } else {
    // text- has many non-color utilities
    const nonColorTextPatterns = /^text-(center|left|right|justify|start|end|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|wrap|nowrap|balance|pretty|ellipsis|clip|truncate)/;
    return !nonColorTextPatterns.test(className);
  }
}

/**
 * Extract background and text colors from a Tailwind classes string
 * @param classes - Space-separated Tailwind classes
 * @param element - Optional element to resolve CSS variables (improves accuracy)
 * @returns Object with background and text color hex values (or null if not found)
 */
export function extractColorsFromClasses(classes?: string, element?: HTMLElement): {
  backgroundColor: string | null;
  textColor: string | null;
} {
  if (!classes) {
    return { backgroundColor: null, textColor: null };
  }

  const classList = classes.split(/\s+/);
  let backgroundColor: string | null = null;
  let textColor: string | null = null;

  for (const className of classList) {
    // Extract background color (only keep the last one if multiple)
    if (className.startsWith('bg-') && looksLikeColorClass(className, 'bg')) {
      const color = extractColorFromTailwindClass(className, 'bg');
      if (color) {
        backgroundColor = color;
      } else {
        // Always try DOM resolution for unrecognized color classes
        // This handles semantic colors (bg-primary, etc.) and CSS variables
        const resolved = resolveColorFromClass(className, 'bg');
        if (resolved) backgroundColor = resolved;
      }
    }

    // Extract text color (only keep the last one if multiple)
    if (className.startsWith('text-') && looksLikeColorClass(className, 'text')) {
      const color = extractColorFromTailwindClass(className, 'text');
      if (color) {
        textColor = color;
      } else {
        // Always try DOM resolution for unrecognized color classes
        // This handles semantic colors (text-foreground, etc.) and CSS variables
        const resolved = resolveColorFromClass(className, 'text');
        if (resolved) textColor = resolved;
      }
    }
  }

  return { backgroundColor, textColor };
}
