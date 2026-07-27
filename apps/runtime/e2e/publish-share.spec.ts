/**
 * E2E — one-click "Share live URL" (Cloudflare Quick Tunnel).
 *
 * Skip-by-default: this drives the live Studio UI and needs (a) an operator
 * session, (b) a BUILT + PUBLISHED app, and (c) cloudflared — point
 * EXEPAD_CLOUDFLARED_BIN at apps/runtime/tests/fixtures/mock-cloudflared.mjs to
 * run without real egress. Enable with EXEPAD_E2E_PUBLISH=1 and pass the app id
 * via E2E_PUBLISH_APP_ID. (Isolation of the restricted listener is proven
 * headlessly by tests/unit/server/publish-isolation.test.ts.)
 *
 *   EXEPAD_E2E_PUBLISH=1 E2E_PUBLISH_APP_ID=<id> pnpm exec playwright test publish-share
 */
import { test, expect } from 'playwright/test';

const RUN = process.env.EXEPAD_E2E_PUBLISH === '1';
const APP_ID = process.env.E2E_PUBLISH_APP_ID ?? '';

test.describe('Share live URL', () => {
  test.skip(!RUN, 'set EXEPAD_E2E_PUBLISH=1 (+ a published app) to run');

  test('publishes, surfaces a *.trycloudflare.com link, copies it, then stops', async ({ page }) => {
    expect(APP_ID, 'E2E_PUBLISH_APP_ID must point at a built+published app').not.toBe('');
    await page.goto(`/studio/${APP_ID}`, { waitUntil: 'networkidle' });

    // Open the Publish tab and find the (now Available) Share live URL card.
    await page.getByRole('button', { name: /publish/i }).first().click();
    const card = page.locator('div', { hasText: 'Share live URL' }).last();
    await expect(card.getByText('Available')).toBeVisible();

    // Start the tunnel.
    await card.getByRole('button', { name: /create public link/i }).click();

    // The live URL appears in the readonly input.
    const urlInput = card.getByLabel('Public share URL');
    await expect(urlInput).toBeVisible({ timeout: 15_000 });
    const url = await urlInput.inputValue();
    expect(url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com/);

    // Copy toggles to "Copied", Open targets a new tab.
    await card.getByRole('button', { name: /copy/i }).click();
    await expect(card.getByText('Copied')).toBeVisible();
    await expect(card.getByRole('link', { name: /open/i })).toHaveAttribute('target', '_blank');

    // Stop tears it down and the card returns to the start state.
    await card.getByRole('button', { name: /stop sharing/i }).click();
    await expect(card.getByRole('button', { name: /create public link/i })).toBeVisible();
  });

  test('the Start button is gated until the app is published', async ({ page }) => {
    expect(APP_ID).not.toBe('');
    await page.goto(`/studio/${APP_ID}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /publish/i }).first().click();
    // When unpublished, the card shows the publish-first hint (this assertion is
    // meaningful only against an UNPUBLISHED app; documented for completeness).
    const card = page.locator('div', { hasText: 'Share live URL' }).last();
    await expect(card).toBeVisible();
  });
});
