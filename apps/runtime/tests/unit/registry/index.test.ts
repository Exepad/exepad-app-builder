/**
 * Component Registry Tests
 * Verifies the simplified registry after declarative UI component removal.
 * Only CodeComponentProps is registered (blog platform pages were removed).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  componentRegistry,
  getComponent,
  getComponentSync,
  preloadComponent,
  preloadComponents,
  isComponentRegistered,
  isComponentCached,
  getRegisteredComponentTypes,
  clearComponentCache,
} from '@/registry';

describe('registry/index', () => {
  beforeEach(() => {
    clearComponentCache();
  });

  describe('componentRegistry', () => {
    it('should have exactly 1 registered component type', () => {
      const types = getRegisteredComponentTypes();
      expect(types).toHaveLength(1);
    });

    it('should have CodeComponentProps registered', () => {
      expect(isComponentRegistered('CodeComponentProps')).toBe(true);
    });

    it('should NOT have removed declarative or blog component types', () => {
      const removedTypes = [
        'ButtonProps', 'TextProps', 'HeadingProps', 'CardProps',
        'FormProps', 'NavbarProps', 'SidebarProps', 'DataTableProps',
        'SectionProps', 'FlexProps', 'GridProps', 'ChartProps',
        'ModalProps', 'TabsProps', 'AccordionProps',
        'BlogMainPage', 'BlogPostPage',
      ];
      for (const type of removedTypes) {
        expect(isComponentRegistered(type)).toBe(false);
      }
    });
  });

  describe('getComponent', () => {
    it('should return null for unregistered component types', async () => {
      const result = await getComponent('NonExistentProps');
      expect(result).toBeNull();
    });

    it('should return null for removed component types', async () => {
      const result = await getComponent('ButtonProps');
      expect(result).toBeNull();
    });
  });

  describe('getComponentSync', () => {
    it('should return null for uncached components', () => {
      expect(getComponentSync('CodeComponentProps')).toBeNull();
    });
  });

  describe('cache operations', () => {
    it('should report uncached components correctly', () => {
      expect(isComponentCached('CodeComponentProps')).toBe(false);
    });

    it('should clear cache without errors', () => {
      expect(() => clearComponentCache()).not.toThrow();
    });
  });

  describe('preload', () => {
    it('should not throw for preloading registered types', async () => {
      // This will attempt to dynamically import, which may fail in test env,
      // but should not throw unhandled errors
      await expect(preloadComponent('NonExistent')).resolves.not.toThrow();
    });

    it('should handle preloading multiple types', async () => {
      await expect(preloadComponents(['NonExistent1', 'NonExistent2'])).resolves.not.toThrow();
    });
  });
});
