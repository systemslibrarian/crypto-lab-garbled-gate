import { test } from '@playwright/test';
import { boot, driveAllStates, expectBaselineNotStale, NARROW, reportCollected } from './gate';

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
    // The third rule of the non-text baseline: an entry that no longer appears
    // fails, so a fixed finding has to be deleted rather than lingering as a
    // permanent exemption. `expectBaselineNotStale` was exported from `gate.ts`
    // and never imported, so that rule had never once run.
    //
    // It belongs here, beside `reportCollected`, for the same reason that one
    // is here: `nonTextSeen` is module state, so the check reads whatever the
    // configurations in THIS worker drove, and `afterAll` is the point at which
    // that set is complete. Both baselined entries are top-bar controls present
    // in every state of every configuration, so no split of tests across
    // workers can make the set incomplete.
    expectBaselineNotStale();
    reportCollected();
  });

  test('dark theme, desktop width', async ({ page }) => {
    test.slow();
    await boot(page, 'dark');
    await driveAllStates(page, 'dark @1280');
  });


  test('dark theme, 380px reflow width', async ({ page }) => {
    test.slow();
    await page.setViewportSize(NARROW);
    await boot(page, 'dark');
    await driveAllStates(page, 'dark @380');
  });

});
