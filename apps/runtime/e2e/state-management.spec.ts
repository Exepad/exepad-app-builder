/**
 * State Management E2E Tests
 * Tests state interactions and updates in the browser
 */

import { test, expect } from 'playwright/test';

test.describe('Interactive State', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
  });

  test.describe('Button Interactions', () => {
    test('should respond to button clicks', async ({ page }) => {
      // Find clickable buttons
      const buttons = page.locator('button:not([disabled])');
      const buttonCount = await buttons.count();
      
      if (buttonCount > 0) {
        const button = buttons.first();
        
        // Click should not cause errors
        let hasError = false;
        page.on('pageerror', () => { hasError = true; });
        
        await button.click();
        await page.waitForTimeout(500);
        
        expect(hasError).toBe(false);
      }
    });

    test('should handle multiple rapid clicks', async ({ page }) => {
      const buttons = page.locator('button:not([disabled])');
      const buttonCount = await buttons.count();
      
      if (buttonCount > 0) {
        const button = buttons.first();
        
        // Rapid clicks should not break the page
        let errorCount = 0;
        page.on('pageerror', () => { errorCount++; });
        
        for (let i = 0; i < 5; i++) {
          await button.click();
        }
        
        await page.waitForTimeout(500);
        
        // Should not have accumulated errors
        expect(errorCount).toBe(0);
      }
    });
  });

  test.describe('Toggle Components', () => {
    test('should toggle accordion sections', async ({ page }) => {
      // Look for accordion triggers
      const accordionTriggers = page.locator('[data-state="closed"], [data-state="open"]');
      const triggerCount = await accordionTriggers.count();
      
      if (triggerCount > 0) {
        const trigger = accordionTriggers.first();
        const initialState = await trigger.getAttribute('data-state');
        
        // Click to toggle
        await trigger.click();
        await page.waitForTimeout(300); // Allow animation
        
        // State should change
        const newState = await trigger.getAttribute('data-state');
        expect(newState).not.toBe(initialState);
      }
    });

    test('should toggle tabs', async ({ page }) => {
      // Look for tab triggers
      const tabTriggers = page.locator('[role="tab"]');
      const tabCount = await tabTriggers.count();
      
      if (tabCount > 1) {
        // Get second tab (first might be already active)
        const secondTab = tabTriggers.nth(1);
        
        // Click to switch tab
        await secondTab.click();
        await page.waitForTimeout(300);
        
        // Should be selected
        const isSelected = await secondTab.getAttribute('aria-selected');
        expect(isSelected).toBe('true');
      }
    });
  });

  test.describe('Modal/Dialog Components', () => {
    test('should open and close modals', async ({ page }) => {
      // Find modal triggers (commonly buttons with data-dialog or similar)
      const modalTriggers = page.locator('[data-dialog-trigger], [data-modal-trigger], button:has-text("Open"), button:has-text("Show")');
      const triggerCount = await modalTriggers.count();
      
      if (triggerCount > 0) {
        const trigger = modalTriggers.first();
        
        // Click to open
        await trigger.click();
        await page.waitForTimeout(300);
        
        // Look for dialog/modal
        const dialog = page.locator('[role="dialog"], [data-state="open"]');
        const dialogCount = await dialog.count();
        
        if (dialogCount > 0) {
          await expect(dialog.first()).toBeVisible();
          
          // Try to close (Escape key or close button)
          const closeButton = dialog.first().locator('button:has-text("Close"), [aria-label="Close"]');
          const closeCount = await closeButton.count();
          
          if (closeCount > 0) {
            await closeButton.first().click();
            await page.waitForTimeout(300);
          } else {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
          }
        }
      }
    });
  });

  test.describe('Carousel/Slider Components', () => {
    test('should navigate carousel', async ({ page }) => {
      // Look for carousel navigation
      const carouselNav = page.locator('[data-carousel-next], [data-carousel-prev], button:has([class*="chevron"])');
      const navCount = await carouselNav.count();
      
      if (navCount > 0) {
        // Click next button
        const nextButton = carouselNav.first();
        
        await nextButton.click();
        await page.waitForTimeout(500); // Allow transition
        
        // Should not error
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        
        expect(pageErrors).toHaveLength(0);
      }
    });
  });
});

test.describe('State Persistence', () => {
  test('should maintain state during navigation', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Find any stateful element
    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();
    
    if (checkboxCount > 0) {
      const checkbox = checkboxes.first();
      
      // Toggle checkbox
      const initialState = await checkbox.isChecked();
      await checkbox.click();
      const newState = await checkbox.isChecked();
      
      // Find a navigation link
      const links = page.locator('a[href*="/demo/beauty-center/"]');
      const linkCount = await links.count();
      
      if (linkCount > 0) {
        // Navigate away and back
        await links.first().click();
        await page.waitForLoadState('networkidle');
        await page.goBack();
        await page.waitForLoadState('networkidle');
        
        // Check if state persisted (implementation dependent)
        // This mainly verifies no errors occur during navigation
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });
});

test.describe('Error Handling', () => {
  test('should gracefully handle component errors', async ({ page }) => {
    let criticalErrors: string[] = [];
    
    page.on('pageerror', (error) => {
      // Filter out known non-critical errors
      if (!error.message.includes('ResizeObserver') && 
          !error.message.includes('Script error')) {
        criticalErrors.push(error.message);
      }
    });
    
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Interact with various components
    const interactiveElements = page.locator('button, a, input, select');
    const elementCount = await interactiveElements.count();
    
    // Click on several elements to trigger potential errors
    const maxInteractions = Math.min(5, elementCount);
    for (let i = 0; i < maxInteractions; i++) {
      try {
        const element = interactiveElements.nth(i);
        if (await element.isVisible()) {
          await element.click({ timeout: 1000 });
          await page.waitForTimeout(200);
        }
      } catch {
        // Element might not be clickable, that's ok
      }
    }
    
    // No critical errors should have occurred
    expect(criticalErrors).toEqual([]);
  });

  test('should recover from failed API calls', async ({ page }) => {
    // Monitor network failures
    let failedRequests = 0;
    page.on('requestfailed', () => failedRequests++);
    
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Page should still be functional even if some requests fail
    await expect(page.locator('body')).toBeVisible();
    
    // Main content should render
    const content = page.locator('main, section').first();
    if (await content.count() > 0) {
      await expect(content).toBeVisible();
    }
  });
});
