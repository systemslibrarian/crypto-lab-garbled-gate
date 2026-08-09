import { test } from '@playwright/test';
import { boot, driveAllStates, NARROW, reportCollected } from './gate';

/**
 * WCAG A/AA gate.
 *
 * Deploys are already gated on the Yao/OT known-answer tests; this gates them
 * on accessibility the same way — but honestly. Four configurations, {dark,
 * light} x {1280, 380}, each driven through all six exhibits and scanned after
 * every step, rather than driven once and scanned once at the end.
 *
 * Reduced motion is EMULATED before the navigation, never injected and never
 * applied after first paint: the page's own
 * `@media (prefers-reduced-motion: reduce)` block is exercised, so a rule that
 * leaves an element at `opacity: 0` when its animation is cancelled is caught
 * by `expectNotBlank` instead of being hidden by an injected `animation: none`.
 */

test.describe('WCAG A/AA gate', () => {
  test.beforeEach(({ page }) => {
    page.setDefaultTimeout(20_000);
  });

  test.afterAll(() => {
    reportCollected();
  });

  test('dark theme, desktop width', async ({ page }) => {
    test.slow();
    await boot(page, 'dark');
    await driveAllStates(page, 'dark @1280');
  });

  test('light theme, desktop width', async ({ page }) => {
    test.slow();
    await boot(page, 'light');
    await driveAllStates(page, 'light @1280');
  });

  test('dark theme, 380px reflow width', async ({ page }) => {
    test.slow();
    await page.setViewportSize(NARROW);
    await boot(page, 'dark');
    await driveAllStates(page, 'dark @380');
  });

  test('light theme, 380px reflow width', async ({ page }) => {
    test.slow();
    await page.setViewportSize(NARROW);
    await boot(page, 'light');
    await driveAllStates(page, 'light @380');
  });
});
