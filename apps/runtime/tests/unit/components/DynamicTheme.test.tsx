/**
 * DynamicTheme CSS Sanitization Tests
 *
 * Tests for sanitizeCssName and sanitizeCssValue to prevent CSS injection.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import DynamicTheme from '@/components/DynamicTheme';
import type { ThemeProps } from '@/app_runtime/interfaces/apps/core';

// We test the sanitization through the component's output since the
// sanitize functions are module-private. We inspect the rendered <style> tag.

function getRenderedCss(theme: ThemeProps): string {
  const { container } = render(<DynamicTheme theme={theme} />);
  const styleTag = container.querySelector('style');
  return styleTag?.innerHTML || '';
}

describe('DynamicTheme', () => {
  it('should render null when no theme is provided', () => {
    const { container } = render(<DynamicTheme theme={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('should render theme CSS variables', () => {
    const css = getRenderedCss({
      light: { primary: '#ff0000' },
    });
    expect(css).toContain('--primary:');
  });

  describe('CSS name sanitization', () => {
    it('should strip special characters from variable names', () => {
      const css = getRenderedCss({
        light: { 'primary<script>': '#ff0000' } as any,
      });
      // Should not contain <script> in the output
      expect(css).not.toContain('<script>');
      expect(css).toContain('--primaryscript');
    });

    it('should allow alphanumeric names with hyphens and underscores', () => {
      const css = getRenderedCss({
        light: { 'chart-1': '#ff0000', 'my_color': '#00ff00' } as any,
      });
      expect(css).toContain('--chart-1');
      expect(css).toContain('--my_color');
    });
  });

  describe('CSS value sanitization', () => {
    it('should strip HTML tags from values', () => {
      const css = getRenderedCss({
        styles: { 'custom': '</style><script>alert(1)</script>' } as any,
      });
      expect(css).not.toContain('<script>');
      expect(css).not.toContain('</style>');
    });

    it('should strip curly braces from injected values', () => {
      const css = getRenderedCss({
        styles: { 'custom': 'red} .evil{color:blue' } as any,
      });
      // The injected value should not contain braces (CSS template braces are OK)
      expect(css).toContain('--custom: red .evilcolor:blue');
      expect(css).not.toContain('red}');
      expect(css).not.toContain('{color');
    });

    it('should strip semicolons from values to prevent property injection', () => {
      const css = getRenderedCss({
        styles: { 'custom': 'red; color: evil' } as any,
      });
      // Semicolon should be stripped from the VALUE
      // The only semicolons should be the CSS property terminators added by the code
      expect(css).toContain('--custom: red color');
    });

    it('should strip backslashes from values', () => {
      const css = getRenderedCss({
        styles: { 'custom': 'red\\0acolor:blue' } as any,
      });
      expect(css).not.toContain('\\');
    });

    it('should strip @ signs to prevent @import injection', () => {
      const css = getRenderedCss({
        styles: { 'custom': '@import url(evil.css)' } as any,
      });
      expect(css).not.toContain('@import');
    });

    it('should strip expression() calls', () => {
      const css = getRenderedCss({
        styles: { 'custom': 'expression(alert(1))' } as any,
      });
      expect(css).not.toContain('expression(');
    });

    it('should strip -moz-binding', () => {
      const css = getRenderedCss({
        styles: { 'custom': '-moz-binding: url(evil)' } as any,
      });
      expect(css).not.toContain('-moz-binding');
    });

    it('should strip behavior: directive', () => {
      const css = getRenderedCss({
        styles: { 'custom': 'behavior: url(evil.htc)' } as any,
      });
      expect(css).not.toContain('behavior');
    });

    it('should block javascript: inside url()', () => {
      const css = getRenderedCss({
        styles: { 'custom': 'url(javascript:alert(1))' } as any,
      });
      expect(css).not.toContain('url(javascript:');
    });

    it('should block data: inside url()', () => {
      const css = getRenderedCss({
        styles: { 'custom': 'url(data:text/css,body{color:red})' } as any,
      });
      expect(css).not.toContain('url(data:');
    });

    it('should sanitize theme.radius', () => {
      const css = getRenderedCss({
        radius: '0.5rem; color: red',
      });
      // Semicolons in value should be stripped
      expect(css).toContain('--radius:');
      expect(css).not.toMatch(/--radius:[^}]*;[^}]*color: red/);
    });

    it('should sanitize theme.spacing values', () => {
      const css = getRenderedCss({
        spacing: {
          y: '2rem; background: red',
          x: '1rem',
        },
      });
      expect(css).toContain('--spacing-section-y:');
      // The semicolon should have been stripped from the value
      expect(css).not.toMatch(/--spacing-section-y:[^}]*;[^}]*background/);
    });
  });

  describe('safe values pass through', () => {
    it('should allow valid hex colors', () => {
      const css = getRenderedCss({
        light: { primary: '#3b82f6' },
      });
      expect(css).toContain('--primary:');
    });

    it('should allow valid HSL values', () => {
      const css = getRenderedCss({
        light: { primary: '217 91% 60%' } as any,
      });
      expect(css).toContain('--primary:');
      expect(css).toContain('217 91% 60%');
    });

    it('should allow valid spacing values', () => {
      const css = getRenderedCss({
        radius: '0.5rem',
        spacing: { y: '2rem', x: '1rem' },
      });
      expect(css).toContain('--radius: 0.5rem');
    });

    it('should handle dark theme colors', () => {
      const css = getRenderedCss({
        dark: { background: '#1e1e1e' },
      });
      expect(css).toContain('.dark');
      expect(css).toContain('--background:');
    });
  });
});
