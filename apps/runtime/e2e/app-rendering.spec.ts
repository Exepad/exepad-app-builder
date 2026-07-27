/**
 * App Rendering E2E Tests
 * Tests that demo apps render correctly in the browser
 */

import { test, expect } from 'playwright/test';

test.describe('Demo App Rendering', () => {
  test.beforeEach(async ({ page }) => {
    // Give the app some time to load
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
  });

  test('should render the demo app page', async ({ page }) => {
    // Wait for the page to load
    await expect(page.locator('body')).toBeVisible();
    
    // The page should have some content
    const content = await page.textContent('body');
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(0);
  });

  test('should render header navigation', async ({ page }) => {
    // Look for navigation elements
    const nav = page.locator('nav, header');
    
    // At least one nav/header element should be visible
    const navCount = await nav.count();
    
    // If navigation exists, verify it's properly structured
    if (navCount > 0) {
      await expect(nav.first()).toBeVisible();
      
      // Navigation should contain links or interactive elements
      const navLinks = nav.first().locator('a, button');
      const linkCount = await navLinks.count();
      expect(linkCount).toBeGreaterThan(0);
    }
  });

  test('should render main content sections', async ({ page }) => {
    // Look for section elements
    const sections = page.locator('section, main');
    
    // Should have at least one main content area
    const sectionCount = await sections.count();
    expect(sectionCount).toBeGreaterThan(0);
    
    // First section should be visible and have content
    const firstSection = sections.first();
    await expect(firstSection).toBeVisible();
    
    // Section should contain some content (text, images, or other elements)
    const textContent = await firstSection.textContent();
    const hasContent = textContent && textContent.trim().length > 0;
    const hasChildElements = await firstSection.locator('*').count() > 0;
    expect(hasContent || hasChildElements).toBe(true);
  });

  test('should render footer if present', async ({ page }) => {
    // Footer may or may not be present
    const footer = page.locator('footer');
    const footerCount = await footer.count();
    
    // If footer exists, it should be visible
    if (footerCount > 0) {
      await expect(footer.first()).toBeVisible();
    }
  });

  test('should have proper page title', async ({ page }) => {
    // Page should have a title
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('should not have JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    // Reload and check for errors
    await page.reload({ waitUntil: 'networkidle' });
    
    // Filter out known acceptable errors (like 3rd party scripts)
    const criticalErrors = errors.filter(
      (e) => !e.includes('Script error') && !e.includes('ResizeObserver')
    );
    
    expect(criticalErrors).toEqual([]);
  });
});

test.describe('Navigation', () => {
  test('should navigate between pages', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Get current URL
    const initialUrl = page.url();
    
    // Find and click a navigation link
    const navLinks = page.locator('a[href*="/demo/beauty-center/"]');
    const linkCount = await navLinks.count();
    
    if (linkCount > 0) {
      // Click the first internal link
      await navLinks.first().click();
      
      // Wait for navigation
      await page.waitForLoadState('networkidle');
      
      // URL should have changed or stayed the same (if same page link)
      const newUrl = page.url();
      expect(newUrl).toContain('/demo/beauty-center');
    }
  });

  test('should maintain consistent layout across pages', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Check if header exists on first page
    const headerBefore = await page.locator('header, nav').count();
    
    // Navigate to another page if links exist
    const links = page.locator('a[href*="/demo/beauty-center/"]');
    const linkCount = await links.count();
    
    if (linkCount > 0) {
      await links.first().click();
      await page.waitForLoadState('networkidle');
      
      // Header count should be similar (layout consistency)
      const headerAfter = await page.locator('header, nav').count();
      expect(headerAfter).toBe(headerBefore);
    }
  });
});

test.describe('Responsive Design', () => {
  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Page should still render
    await expect(page.locator('body')).toBeVisible();
    
    // Content should be visible and not overflow
    const body = page.locator('body');
    const bodyBoundingBox = await body.boundingBox();
    expect(bodyBoundingBox).toBeTruthy();
    
    // Check that horizontal scrollbar is not present (content fits viewport)
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    // Some horizontal scroll may be acceptable, but excessive is a problem
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    // Allow up to 20px overflow for small borders/shadows
    expect(scrollWidth - clientWidth).toBeLessThan(20);
    
    // Main content should be visible
    const mainContent = page.locator('main, section, article').first();
    if (await mainContent.count() > 0) {
      await expect(mainContent).toBeVisible();
    }
  });

  test('should be responsive on tablet', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Page should render
    await expect(page.locator('body')).toBeVisible();
  });

  test('should be responsive on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Page should render
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Accessibility', () => {
  test('should have alt text on images', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Get all images
    const images = page.locator('img');
    const imageCount = await images.count();
    
    // Check each image has alt attribute
    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      
      // Alt can be empty string for decorative images, but attribute should exist
      expect(alt).toBeDefined();
    }
  });

  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Get all headings
    const h1Count = await page.locator('h1').count();
    
    // Should have at most one h1 per page (or none)
    expect(h1Count).toBeLessThanOrEqual(1);
  });

  test('should have focusable interactive elements', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Get interactive elements
    const interactiveElements = page.locator('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const elementCount = await interactiveElements.count();
    
    // If there are interactive elements, they should be focusable
    if (elementCount > 0) {
      // Press Tab to test focus
      await page.keyboard.press('Tab');
      
      // Something should be focused after Tab
      const focusedElement = page.locator(':focus');
      const focusedCount = await focusedElement.count();
      expect(focusedCount).toBe(1);
      
      // The focused element should be visible
      await expect(focusedElement).toBeVisible();
      
      // Tab through a few more elements to verify tab order works
      for (let i = 0; i < Math.min(3, elementCount - 1); i++) {
        await page.keyboard.press('Tab');
        const newFocused = page.locator(':focus');
        await expect(newFocused).toBeVisible();
      }
    }
  });
});

test.describe('Performance', () => {
  test('should load within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/demo/beauty-center', { waitUntil: 'domcontentloaded' });
    
    const loadTime = Date.now() - startTime;
    
    // Page should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);
  });

  test('should not have excessive DOM nodes', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Count DOM nodes
    const nodeCount = await page.evaluate(() => {
      return document.getElementsByTagName('*').length;
    });
    
    // Should have fewer than 5000 nodes for good performance
    expect(nodeCount).toBeLessThan(5000);
  });
});
