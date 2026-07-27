/**
 * Tests for automatic color contrast detection and correction
 */

import { describe, it, expect } from 'vitest';
import {
  getContrastRatio,
  meetsContrastRequirement,
  getContrastingTextColor,
  isDarkColor,
} from '@/lib/colors';
import {
  extractColorFromTailwindClass,
  extractColorsFromClasses,
  parseColorToRgb,
  blendOverlayOnBase,
  rgbToHex,
} from '@/lib/color-resolution';

describe('Color Extraction', () => {
  describe('extractColorFromTailwindClass', () => {
    it('should extract standard Tailwind background colors', () => {
      expect(extractColorFromTailwindClass('bg-blue-500', 'bg')).toBe('#3b82f6');
      expect(extractColorFromTailwindClass('bg-gray-900', 'bg')).toBe('#111827');
      expect(extractColorFromTailwindClass('bg-white', 'bg')).toBe('#ffffff');
    });

    it('should extract arbitrary Tailwind background colors', () => {
      expect(extractColorFromTailwindClass('bg-[#A8C6C3]', 'bg')).toBe('#A8C6C3');
      expect(extractColorFromTailwindClass('bg-[#fff]', 'bg')).toBe('#fff');
      expect(extractColorFromTailwindClass('bg-[#123456]', 'bg')).toBe('#123456');
    });

    it('should extract standard Tailwind text colors', () => {
      expect(extractColorFromTailwindClass('text-white', 'text')).toBe('#ffffff');
      expect(extractColorFromTailwindClass('text-gray-900', 'text')).toBe('#111827');
    });

    it('should extract arbitrary Tailwind text colors', () => {
      expect(extractColorFromTailwindClass('text-[#A8C6C3]', 'text')).toBe('#A8C6C3');
      expect(extractColorFromTailwindClass('text-[#000]', 'text')).toBe('#000');
    });

    it('should return null for non-color classes', () => {
      expect(extractColorFromTailwindClass('py-4', 'bg')).toBeNull();
      expect(extractColorFromTailwindClass('text-center', 'text')).toBeNull();
    });
  });

  describe('extractColorsFromClasses', () => {
    it('should extract both background and text colors', () => {
      const result = extractColorsFromClasses('py-16 bg-[#A8C6C3] text-white mb-8');
      expect(result.backgroundColor).toBe('#A8C6C3');
      expect(result.textColor).toBe('#ffffff');
    });

    it('should handle multiple color classes (last one wins)', () => {
      const result = extractColorsFromClasses('bg-blue-500 bg-[#A8C6C3] text-gray-900 text-white');
      expect(result.backgroundColor).toBe('#A8C6C3');
      expect(result.textColor).toBe('#ffffff');
    });

    it('should handle missing colors', () => {
      const result1 = extractColorsFromClasses('py-16 text-white');
      expect(result1.backgroundColor).toBeNull();
      expect(result1.textColor).toBe('#ffffff');

      const result2 = extractColorsFromClasses('bg-blue-500 py-16');
      expect(result2.backgroundColor).toBe('#3b82f6');
      expect(result2.textColor).toBeNull();
    });

    it('should handle empty or undefined classes', () => {
      const result1 = extractColorsFromClasses('');
      expect(result1.backgroundColor).toBeNull();
      expect(result1.textColor).toBeNull();

      const result2 = extractColorsFromClasses(undefined);
      expect(result2.backgroundColor).toBeNull();
      expect(result2.textColor).toBeNull();
    });
  });
});

describe('Color Contrast Calculations', () => {
  describe('isDarkColor', () => {
    it('should identify dark colors', () => {
      expect(isDarkColor('#000000')).toBe(true);
      expect(isDarkColor('#111827')).toBe(true); // gray-900
      expect(isDarkColor('#1e3a8a')).toBe(true); // blue-900
    });

    it('should identify light colors', () => {
      expect(isDarkColor('#ffffff')).toBe(false);
      expect(isDarkColor('#f9fafb')).toBe(false); // gray-50
      expect(isDarkColor('#A8C6C3')).toBe(false); // light teal
    });
  });

  describe('getContrastRatio', () => {
    it('should calculate contrast ratio correctly', () => {
      // White on black - maximum contrast
      const ratio1 = getContrastRatio('#ffffff', '#000000');
      expect(ratio1).toBeCloseTo(21, 0);

      // Same color - minimum contrast
      const ratio2 = getContrastRatio('#ffffff', '#ffffff');
      expect(ratio2).toBeCloseTo(1, 0);

      // The problematic example: white on #A8C6C3
      const ratio3 = getContrastRatio('#ffffff', '#A8C6C3');
      expect(ratio3).toBeLessThan(4.5); // Should fail WCAG AA
    });
  });

  describe('meetsContrastRequirement', () => {
    it('should check WCAG AA compliance (4.5:1 for normal text)', () => {
      expect(meetsContrastRequirement('#ffffff', '#000000', 'AA')).toBe(true);
      expect(meetsContrastRequirement('#ffffff', '#A8C6C3', 'AA')).toBe(false);
      expect(meetsContrastRequirement('#111827', '#A8C6C3', 'AA')).toBe(true);
    });

    it('should check WCAG AAA compliance (7:1 for normal text)', () => {
      expect(meetsContrastRequirement('#ffffff', '#000000', 'AAA')).toBe(true);
      expect(meetsContrastRequirement('#ffffff', '#A8C6C3', 'AAA')).toBe(false);
    });
  });

  describe('getContrastingTextColor', () => {
    it('should return white for dark backgrounds', () => {
      expect(getContrastingTextColor('#000000')).toBe('#FFFFFF');
      expect(getContrastingTextColor('#111827')).toBe('#FFFFFF');
      expect(getContrastingTextColor('#1e3a8a')).toBe('#FFFFFF');
    });

    it('should return dark color for light backgrounds', () => {
      // The implementation returns the color with highest contrast ratio
      // For white backgrounds, #000000 has better contrast (21:1) than #111827
      expect(getContrastingTextColor('#ffffff')).toBe('#000000');
      expect(getContrastingTextColor('#f9fafb')).toBe('#000000');
      expect(getContrastingTextColor('#A8C6C3')).toBe('#000000');
    });
  });
});

describe('Real-World Examples', () => {
  it('should fix the problematic section from the user example', () => {
    const classes = 'py-16 bg-[#A8C6C3]';
    const { backgroundColor } = extractColorsFromClasses(classes);
    
    // Verify we extracted the background correctly
    expect(backgroundColor).toBe('#A8C6C3');
    
    // Verify the original white text would have poor contrast
    const originalContrast = getContrastRatio('#ffffff', backgroundColor!);
    expect(originalContrast).toBeLessThan(4.5); // Fails WCAG AA
    
    // Verify our correction provides good contrast
    const correctedColor = getContrastingTextColor(backgroundColor!);
    // The function picks the color with highest contrast ratio
    expect(correctedColor).toBe('#000000'); // Black text has highest contrast
    
    const correctedContrast = getContrastRatio(correctedColor, backgroundColor!);
    expect(correctedContrast).toBeGreaterThanOrEqual(4.5); // Passes WCAG AA
  });

  it('should handle standard Tailwind colors correctly', () => {
    const lightClasses = 'bg-gray-100 text-gray-500';
    const { backgroundColor: lightBg, textColor: lightText } = extractColorsFromClasses(lightClasses);

    // On light backgrounds, gray-500 text might not have enough contrast
    const lightContrast = getContrastRatio(lightText!, lightBg!);
    if (lightContrast < 4.5) {
      const corrected = getContrastingTextColor(lightBg!);
      // The function picks the color with highest contrast ratio (#000000 for light backgrounds)
      expect(corrected).toBe('#000000');
    }

    const darkClasses = 'bg-gray-900 text-gray-400';
    const { backgroundColor: darkBg, textColor: darkText } = extractColorsFromClasses(darkClasses);

    // On dark backgrounds, gray-400 text might not have enough contrast
    const darkContrast = getContrastRatio(darkText!, darkBg!);
    if (darkContrast < 4.5) {
      const corrected = getContrastingTextColor(darkBg!);
      expect(corrected).toBe('#FFFFFF'); // Should suggest white text
    }
  });

  it('should detect near-white text on light background as problematic (testimonial scenario)', () => {
    // text-zinc-100 (#f4f4f5) on bg-muted-like (#EDEEF2) — the actual bug scenario
    const textColor = '#f4f4f5';
    const bgColor = '#EDEEF2';
    const ratio = getContrastRatio(textColor, bgColor);
    expect(ratio).toBeLessThan(4.5); // Must fail WCAG AA

    const corrected = getContrastingTextColor(bgColor);
    expect(getContrastRatio(corrected, bgColor)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Semi-transparent Background Compositing', () => {
  it('should parse rgba with comma-separated format', () => {
    const parsed = parseColorToRgb('rgba(237, 238, 242, 0.5)');
    expect(parsed).not.toBeNull();
    expect(parsed!.r).toBe(237);
    expect(parsed!.g).toBe(238);
    expect(parsed!.b).toBe(242);
    expect(parsed!.a).toBeCloseTo(0.5);
  });

  it('should parse rgb with space-separated format and alpha', () => {
    const parsed = parseColorToRgb('rgb(237 238 242 / 0.5)');
    expect(parsed).not.toBeNull();
    expect(parsed!.r).toBe(237);
    expect(parsed!.g).toBe(238);
    expect(parsed!.b).toBe(242);
    expect(parsed!.a).toBeCloseTo(0.5);
  });

  it('should composite semi-transparent muted over white correctly', () => {
    // Simulates bg-muted/50 over bg-card (white) — the testimonial bug scenario
    const muted = { r: 237, g: 238, b: 242, a: 0.5 };
    const white = { r: 255, g: 255, b: 255 };
    const blended = blendOverlayOnBase(muted, white);

    // Result should be lighter than muted at full opacity
    expect(blended.r).toBeGreaterThan(237);
    expect(blended.g).toBeGreaterThan(238);
    expect(blended.b).toBeGreaterThan(242);

    // And the composited bg should still have terrible contrast with zinc-100
    const compositedHex = rgbToHex(blended.r, blended.g, blended.b);
    const zincHex = '#f4f4f5';
    expect(getContrastRatio(compositedHex, zincHex)).toBeLessThan(4.5);
  });

  it('should composite multiple semi-transparent layers', () => {
    // Two 50% layers over white should not equal one 100% layer
    const overlay = { r: 0, g: 0, b: 0, a: 0.5 };
    const white = { r: 255, g: 255, b: 255 };

    const first = blendOverlayOnBase(overlay, white);
    // 50% black over white = ~128, 128, 128
    expect(first.r).toBeCloseTo(128, -1);

    const second = blendOverlayOnBase(overlay, first);
    // 50% black over gray = ~64, 64, 64
    expect(second.r).toBeCloseTo(64, -1);
  });
});
