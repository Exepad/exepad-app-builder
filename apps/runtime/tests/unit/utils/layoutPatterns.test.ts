/**
 * Layout Patterns Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LAYOUT_CONFIGS,
  resolveLayout,
  getLayoutClasses,
  getSuggestedLayout,
  getLayoutConfig,
} from '@/utils/layoutPatterns';
import type { LayoutOption } from '@/app_runtime/interfaces/apps/core';

describe('layoutPatterns', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('LAYOUT_CONFIGS', () => {
    it('should have all layout options defined', () => {
      expect(LAYOUT_CONFIGS).toHaveProperty('boxed');
      expect(LAYOUT_CONFIGS).toHaveProperty('full-width');
      expect(LAYOUT_CONFIGS).toHaveProperty('wide');
      expect(LAYOUT_CONFIGS).toHaveProperty('narrow');
    });

    it('should have required properties for each config', () => {
      for (const [key, config] of Object.entries(LAYOUT_CONFIGS)) {
        expect(config).toHaveProperty('containerClasses');
        expect(config).toHaveProperty('description');
        expect(config).toHaveProperty('useCase');
        expect(config).toHaveProperty('maxWidth');
      }
    });

    it('should have correct maxWidth values', () => {
      expect(LAYOUT_CONFIGS.boxed.maxWidth).toBe('1200px');
      expect(LAYOUT_CONFIGS['full-width'].maxWidth).toBe('none');
      expect(LAYOUT_CONFIGS.wide.maxWidth).toBe('1600px');
      expect(LAYOUT_CONFIGS.narrow.maxWidth).toBe('800px');
    });

    it('should have container classes with proper structure', () => {
      expect(LAYOUT_CONFIGS.boxed.containerClasses).toContain('container');
      expect(LAYOUT_CONFIGS.boxed.containerClasses).toContain('mx-auto');

      expect(LAYOUT_CONFIGS['full-width'].containerClasses).toContain('w-full');

      expect(LAYOUT_CONFIGS.narrow.containerClasses).toContain('max-w-narrow');
      expect(LAYOUT_CONFIGS.wide.containerClasses).toContain('max-w-wide');
    });
  });

  describe('resolveLayout', () => {
    it('should use page layout when provided', () => {
      const result = resolveLayout('wide', 'boxed');
      expect(result).toBe('wide');
    });

    it('should fallback to app layout when page layout is undefined', () => {
      const result = resolveLayout(undefined, 'narrow');
      expect(result).toBe('narrow');
    });

    it('should default to boxed when both are undefined', () => {
      const result = resolveLayout(undefined, undefined);
      expect(result).toBe('boxed');
    });

    it('should fallback to boxed for invalid layout value', () => {
      const result = resolveLayout('invalid-layout' as LayoutOption, undefined);
      
      expect(result).toBe('boxed');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid layout value')
      );
    });

    it('should handle all valid layout options', () => {
      expect(resolveLayout('boxed')).toBe('boxed');
      expect(resolveLayout('full-width')).toBe('full-width');
      expect(resolveLayout('wide')).toBe('wide');
      expect(resolveLayout('narrow')).toBe('narrow');
    });
  });

  describe('getLayoutClasses', () => {
    it('should return container classes for boxed layout', () => {
      const classes = getLayoutClasses('boxed');
      expect(classes).toBe(LAYOUT_CONFIGS.boxed.containerClasses);
    });

    it('should return container classes for full-width layout', () => {
      const classes = getLayoutClasses('full-width');
      expect(classes).toBe(LAYOUT_CONFIGS['full-width'].containerClasses);
    });

    it('should inherit from app layout when page layout undefined', () => {
      const classes = getLayoutClasses(undefined, 'wide');
      expect(classes).toBe(LAYOUT_CONFIGS.wide.containerClasses);
    });

    it('should default to boxed classes', () => {
      const classes = getLayoutClasses();
      expect(classes).toBe(LAYOUT_CONFIGS.boxed.containerClasses);
    });

    it('should fallback to boxed on invalid layout', () => {
      const classes = getLayoutClasses('not-a-layout' as LayoutOption);
      expect(classes).toBe(LAYOUT_CONFIGS.boxed.containerClasses);
    });
  });

  describe('getSuggestedLayout', () => {
    it('should suggest full-width for dashboard', () => {
      expect(getSuggestedLayout('dashboard')).toBe('full-width');
    });

    it('should suggest narrow for blog', () => {
      expect(getSuggestedLayout('blog')).toBe('narrow');
    });

    it('should suggest narrow for docs', () => {
      expect(getSuggestedLayout('docs')).toBe('narrow');
    });

    it('should suggest wide for portfolio', () => {
      expect(getSuggestedLayout('portfolio')).toBe('wide');
    });

    it('should suggest wide for catalog', () => {
      expect(getSuggestedLayout('catalog')).toBe('wide');
    });

    it('should suggest wide for ecommerce-catalog', () => {
      expect(getSuggestedLayout('ecommerce-catalog')).toBe('wide');
    });

    it('should suggest boxed for landing', () => {
      expect(getSuggestedLayout('landing')).toBe('boxed');
    });

    it('should default to boxed for unknown app types', () => {
      expect(getSuggestedLayout('unknown-type')).toBe('boxed');
      expect(getSuggestedLayout('')).toBe('boxed');
    });
  });

  describe('getLayoutConfig', () => {
    it('should return full config for boxed', () => {
      const config = getLayoutConfig('boxed');
      
      expect(config).toEqual(LAYOUT_CONFIGS.boxed);
      expect(config.containerClasses).toBeDefined();
      expect(config.description).toBeDefined();
      expect(config.useCase).toBeDefined();
      expect(config.maxWidth).toBeDefined();
    });

    it('should return full config for each layout option', () => {
      const layouts: LayoutOption[] = ['boxed', 'full-width', 'wide', 'narrow'];
      
      for (const layout of layouts) {
        const config = getLayoutConfig(layout);
        expect(config).toBe(LAYOUT_CONFIGS[layout]);
      }
    });
  });
});
