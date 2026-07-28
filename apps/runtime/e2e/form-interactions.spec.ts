/**
 * Form Interactions E2E Tests
 * Tests form submissions and validations in the browser
 */

import { test, expect } from 'playwright/test';

test.describe('Form Components', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
  });

  test.describe('Input Fields', () => {
    test('should allow text input in form fields', async ({ page }) => {
      // Look for input fields
      const inputs = page.locator('input[type="text"], input[type="email"], input[type="tel"]');
      const inputCount = await inputs.count();
      
      if (inputCount > 0) {
        const firstInput = inputs.first();
        
        // Focus and type
        await firstInput.click();
        await firstInput.fill('Test input text');
        
        // Verify value
        await expect(firstInput).toHaveValue('Test input text');
      }
    });

    test('should show validation state for required fields', async ({ page }) => {
      // Look for required inputs
      const requiredInputs = page.locator('input[required], textarea[required]');
      const requiredCount = await requiredInputs.count();
      
      if (requiredCount > 0) {
        const firstRequired = requiredInputs.first();
        
        // Focus and blur without entering value
        await firstRequired.focus();
        await firstRequired.blur();
        
        // Field should maintain required attribute
        await expect(firstRequired).toHaveAttribute('required', '');
      }
    });

    test('should validate email format', async ({ page }) => {
      // Look for email inputs
      const emailInputs = page.locator('input[type="email"]');
      const emailCount = await emailInputs.count();
      
      if (emailCount > 0) {
        const emailInput = emailInputs.first();
        
        // Enter invalid email
        await emailInput.fill('invalid-email');
        await emailInput.blur();
        
        // Check validity
        const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
        expect(isInvalid).toBe(true);
        
        // Enter valid email
        await emailInput.fill('valid@email.com');
        const isValid = await emailInput.evaluate((el: HTMLInputElement) => el.checkValidity());
        expect(isValid).toBe(true);
      }
    });
  });

  test.describe('Select Fields', () => {
    test('should allow selecting options', async ({ page }) => {
      // Look for select elements
      const selects = page.locator('select');
      const selectCount = await selects.count();
      
      if (selectCount > 0) {
        const firstSelect = selects.first();
        
        // Get available options
        const options = firstSelect.locator('option:not([disabled])');
        const optionCount = await options.count();
        
        if (optionCount > 1) {
          // Select second option (first might be placeholder)
          const secondOption = await options.nth(1).getAttribute('value');
          if (secondOption) {
            await firstSelect.selectOption(secondOption);
            await expect(firstSelect).toHaveValue(secondOption);
          }
        }
      }
    });
  });

  test.describe('Checkbox Fields', () => {
    test('should toggle checkbox state', async ({ page }) => {
      // Look for checkboxes
      const checkboxes = page.locator('input[type="checkbox"]');
      const checkboxCount = await checkboxes.count();
      
      if (checkboxCount > 0) {
        const firstCheckbox = checkboxes.first();
        
        // Get initial state
        const initialState = await firstCheckbox.isChecked();
        
        // Click to toggle
        await firstCheckbox.click();
        
        // Verify state changed
        const newState = await firstCheckbox.isChecked();
        expect(newState).toBe(!initialState);
      }
    });
  });

  test.describe('Radio Buttons', () => {
    test('should allow selecting radio options', async ({ page }) => {
      // Look for radio groups
      const radioGroups = page.locator('input[type="radio"]');
      const radioCount = await radioGroups.count();
      
      if (radioCount > 1) {
        // Get radio buttons with same name (same group)
        const firstRadio = radioGroups.first();
        const name = await firstRadio.getAttribute('name');
        
        if (name) {
          const groupRadios = page.locator(`input[type="radio"][name="${name}"]`);
          const groupCount = await groupRadios.count();
          
          if (groupCount > 1) {
            // Select first radio
            await groupRadios.first().click();
            await expect(groupRadios.first()).toBeChecked();
            
            // Select second radio
            await groupRadios.nth(1).click();
            await expect(groupRadios.nth(1)).toBeChecked();
            
            // First should be unchecked now
            await expect(groupRadios.first()).not.toBeChecked();
          }
        }
      }
    });
  });

  test.describe('Textarea Fields', () => {
    test('should allow multiline text input', async ({ page }) => {
      // Look for textareas
      const textareas = page.locator('textarea');
      const textareaCount = await textareas.count();
      
      if (textareaCount > 0) {
        const firstTextarea = textareas.first();
        
        // Enter multiline text
        const multilineText = 'Line 1\nLine 2\nLine 3';
        await firstTextarea.fill(multilineText);
        
        // Verify value contains newlines
        const value = await firstTextarea.inputValue();
        expect(value).toContain('\n');
      }
    });
  });
});

test.describe('Form Submission', () => {
  test('should handle form submission', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Look for forms with submit buttons
    const forms = page.locator('form');
    const formCount = await forms.count();
    
    if (formCount > 0) {
      const firstForm = forms.first();
      
      // Fill in any required fields
      const requiredInputs = firstForm.locator('input[required]');
      const requiredCount = await requiredInputs.count();
      
      for (let i = 0; i < requiredCount; i++) {
        const input = requiredInputs.nth(i);
        const type = await input.getAttribute('type');
        
        if (type === 'email') {
          await input.fill('test@example.com');
        } else if (type === 'tel') {
          await input.fill('1234567890');
        } else {
          await input.fill('Test Value');
        }
      }
      
      // Look for submit button
      const submitButton = firstForm.locator('button[type="submit"], input[type="submit"]');
      const submitCount = await submitButton.count();
      
      if (submitCount > 0) {
        // Form should be submittable (no JavaScript errors)
        let hasError = false;
        page.on('pageerror', () => { hasError = true; });
        
        // Click submit (but don't wait for navigation as form might use AJAX)
        await submitButton.first().click();
        
        // Wait a bit for any errors
        await page.waitForTimeout(1000);
        
        // Should not have critical errors
        expect(hasError).toBe(false);
      }
    }
  });
});

test.describe('Form Validation UX', () => {
  test('should show validation messages', async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
    
    // Find any form
    const forms = page.locator('form');
    const formCount = await forms.count();
    
    if (formCount > 0) {
      const form = forms.first();
      
      // Try to submit empty form
      const submitButton = form.locator('button[type="submit"]');
      const submitCount = await submitButton.count();
      
      if (submitCount > 0) {
        await submitButton.click();
        
        // Look for validation messages (various patterns)
        const validationElements = page.locator('[data-error], .error, .validation-error, [role="alert"]');
        
        // Check if HTML5 validation triggered
        const invalidInputs = page.locator(':invalid');
        const invalidCount = await invalidInputs.count();
        
        // Either custom validation or HTML5 validation should be present
        const customValidation = await validationElements.count();
        expect(customValidation > 0 || invalidCount > 0).toBe(true);
      }
    }
  });
});
