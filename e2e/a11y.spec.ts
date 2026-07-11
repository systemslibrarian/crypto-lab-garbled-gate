import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are already gated on the Yao/OT KATs; this
 * gates them on accessibility the same way. Scans the full page in both themes
 * with every collapsible / dynamically-revealed region shown.
 *
 * This lab has no <details>. Its four exhibits inject panels on button click
 * (the garbled AND lock-table, the OT boxes, the comparator circuit, the reuse
 * attack). We drive each exhibit's primary buttons so those panels render and
 * get scanned, reveal any [hidden]/inline-display:none regions, and neutralize
 * animations/transitions so nothing is scanned mid-flight.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function neutralizeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation: none !important; transition: none !important; }\n' +
      'body { animation: none !important; }',
  });
}

// Drive each exhibit so its dynamically-injected panels exist in the DOM.
async function driveExhibits(page: Page): Promise<void> {
  const clickIfPresent = async (selector: string) => {
    const loc = page.locator(selector);
    if (await loc.count()) {
      await loc.first().click();
    }
  };

  // Exhibit 2 — garbled AND: garble, evaluate, reveal, trial-decrypt.
  await clickIfPresent('#garble-and');
  await clickIfPresent('#eval-and');
  await clickIfPresent('#reveal-and');
  await clickIfPresent('#trial-and');

  // Exhibit 3 — one OT run.
  await clickIfPresent('#run-ot');

  // Exhibit 4 — set up & step the comparator (renders circuit + gate narration).
  await clickIfPresent('#run-full');
  await clickIfPresent('#proto-step');
  await clickIfPresent('#proto-step');
  const god = page.locator('#god-view');
  if (await god.count()) await god.check();

  // Answer a quiz so quiz-correct / quiz-wrong states are exercised.
  await clickIfPresent('.quiz-opts .quiz-opt');
}

async function revealHidden(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) {
      (d as HTMLDetailsElement).open = true;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[hidden]')) {
      el.hidden = false;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[style*="display"]')) {
      if (el.style && el.style.display === 'none') el.style.display = '';
    }
  });
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

async function runSuite(page: Page): Promise<void> {
  await driveExhibits(page);
  await revealHidden(page);
  await neutralizeMotion(page);
  await scan(page);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await page.goto('.');
  await runSuite(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await page.goto('.');
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await runSuite(page);
});
