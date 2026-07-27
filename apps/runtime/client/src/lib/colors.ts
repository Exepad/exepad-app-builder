export function hexToHsl(hex: string): string {

// --- Example Usage ---
// const myHexColor = "#1a202c";
// const hslString = hexToHsl(myHexColor);
// console.log(hslString); // Outputs: "220 26% 14%"

  // Remove the '#' if it exists
  let sanitizedHex = hex.startsWith('#') ? hex.slice(1) : hex;

  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  if (sanitizedHex.length === 3) {
    sanitizedHex = sanitizedHex.split('').map(char => char + char).join('');
  }

  if (sanitizedHex.length !== 6) {
    // You can also return a default or throw an error
    console.error("Invalid HEX color provided.");
    return "0 0% 0%";
  }

  // Convert hex to RGB
  const r_num = parseInt(sanitizedHex.substring(0, 2), 16);
  const g_num = parseInt(sanitizedHex.substring(2, 4), 16);
  const b_num = parseInt(sanitizedHex.substring(4, 6), 16);

  // Normalize RGB values to be between 0 and 1
  const r = r_num / 255;
  const g = g_num / 255;
  const b = b_num / 255;

  // Find the minimum and maximum values to calculate H, S, and L
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  let h = 0;
  let s = 0;
  let l = (max + min) / 2;

  if (max === min) {
    // Achromatic (the color is a shade of grey)
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  // Round and format the HSL values
  const hue = Math.round(h * 360);
  const saturation = Math.round(s * 100);
  const lightness = Math.round(l * 100);

  return `${hue} ${saturation}% ${lightness}%`;
}

/**
 * Convert hex color to RGB values
 * Supports 3, 6, and 8 character hex values (ignores alpha in 8-char)
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let sanitizedHex = hex.startsWith('#') ? hex.slice(1) : hex;

  if (sanitizedHex.length === 3) {
    sanitizedHex = sanitizedHex.split('').map(char => char + char).join('');
  }

  // Handle 8-character hex (with alpha) - just extract RGB, ignore alpha
  if (sanitizedHex.length === 8) {
    sanitizedHex = sanitizedHex.substring(0, 6);
  }

  if (sanitizedHex.length !== 6) {
    return null;
  }

  const r = parseInt(sanitizedHex.substring(0, 2), 16);
  const g = parseInt(sanitizedHex.substring(2, 4), 16);
  const b = parseInt(sanitizedHex.substring(4, 6), 16);

  return { r, g, b };
}

/**
 * Convert a CSS rgb()/rgba() color string to hex (e.g., "rgb(199, 154, 154)" -> "#C79A9A")
 * Supports both comma-separated and space-separated formats
 */
export function cssRgbToHex(rgbString: string): string | null {
  // Try comma-separated format first: rgb(255, 100, 50) or rgba(255, 100, 50, 0.5)
  let match = rgbString.trim().match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);

  // Try space-separated format: rgb(255 100 50) or rgb(255 100 50 / 0.5)
  if (!match) {
    match = rgbString.trim().match(/^rgba?\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/i);
  }

  if (!match) return null;
  const r = Math.max(0, Math.min(255, parseInt(match[1], 10)));
  const g = Math.max(0, Math.min(255, parseInt(match[2], 10)));
  const b = Math.max(0, Math.min(255, parseInt(match[3], 10)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert a CSS hsl()/hsla() color string to hex
 * Supports: hsl(200, 100%, 50%), hsla(200, 100%, 50%, 0.5), hsl(200 100% 50%)
 */
export function cssHslToHex(hslString: string): string | null {
  // Try comma-separated format: hsl(200, 100%, 50%)
  let match = hslString.trim().match(/^hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?/i);

  // Try space-separated format: hsl(200 100% 50%)
  if (!match) {
    match = hslString.trim().match(/^hsla?\(\s*(\d{1,3})\s+(\d{1,3})%?\s+(\d{1,3})%?/i);
  }

  if (!match) return null;

  const h = parseInt(match[1], 10) / 360;
  const s = parseInt(match[2], 10) / 100;
  const l = parseInt(match[3], 10) / 100;

  // HSL to RGB conversion
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Parse an arbitrary CSS color value from Tailwind bracket notation
 * Handles: #hex, rgb(), rgba(), hsl(), hsla()
 * @param value - The value inside the brackets (e.g., "#fff", "rgb(255,0,0)")
 * @returns Hex color string or null
 */
export function parseArbitraryColorValue(value: string): string | null {
  const trimmed = value.trim();

  // Hex color
  if (trimmed.startsWith('#')) {
    const hexMatch = trimmed.match(/^#([0-9A-Fa-f]{3,8})$/);
    if (hexMatch) {
      return trimmed;
    }
  }

  // RGB/RGBA
  if (trimmed.toLowerCase().startsWith('rgb')) {
    return cssRgbToHex(trimmed);
  }

  // HSL/HSLA
  if (trimmed.toLowerCase().startsWith('hsl')) {
    return cssHslToHex(trimmed);
  }

  return null;
}

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.1 specification
 */
export function getLuminance(rgb: { r: number; g: number; b: number }): number {
  const { r, g, b } = rgb;

  // Normalize RGB values
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors
 * Returns a value between 1 and 21
 */
export function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) return 1;

  const lum1 = getLuminance(rgb1);
  const lum2 = getLuminance(rgb2);

  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);

  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Check if a color combination meets WCAG accessibility standards
 */
export function meetsContrastRequirement(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA'
): boolean {
  const ratio = getContrastRatio(foreground, background);
  return level === 'AA' ? ratio >= 4.5 : ratio >= 7;
}

/**
 * Determine if a color is dark based on luminance
 */
export function isDarkColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  const luminance = getLuminance(rgb);
  return luminance < 0.5;
}

/**
 * Get contrasting text color for a given background
 */
export function getContrastingTextColor(backgroundColor: string): string {
  // Fallback to black if background is invalid
  const baseBg = hexToRgb(backgroundColor) ? backgroundColor : '#000000';

  // Evaluate a small set of sensible text candidates and pick the highest contrast
  const candidateTextColors = ['#FFFFFF', '#111827', '#000000'];

  let bestColor = candidateTextColors[0];
  let bestRatio = 0;

  for (const candidate of candidateTextColors) {
    const ratio = getContrastRatio(baseBg, candidate);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestColor = candidate;
    }
  }

  return bestColor;
}
