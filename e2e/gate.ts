import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The spec this file
 *     replaces called `revealHidden()` immediately before its single scan,
 *     stripping `[hidden]` and every inline `display: none`. On this lab that
 *     fabricates a page no visitor can reach: `#proto-gate` is `[hidden]` until
 *     a circuit run reaches a gate, so un-hiding it scans an empty narration
 *     panel dressed as a populated one. The replaced spec also applied
 *     `emulateMedia({ reducedMotion })` AFTER `goto`, so first paint — the only
 *     moment the entrance styling is on screen — ran without the preference in
 *     effect at all.
 *
 *  2. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. The replaced spec DID drive the exhibits — further than
 *     most in this fleet — but it scanned ONCE, at the end, after clobbering the
 *     page. Every state it built (the garbled lock table, the OT boxes, the
 *     stepped circuit, the quiz feedback) was thrown away unmeasured, and its
 *     `clickIfPresent` helper made a control that had silently vanished
 *     indistinguishable from one that worked.
 *
 *  3. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The old spec's own
 *     contrast helper measured ONE selector against `document.body`'s
 *     background-color — not against the surface that element actually sits on,
 *     and not for any other element on the page.
 */

/**
 * Soft-gate collection mode.
 *
 * With `A11Y_COLLECT=1` an assertion records its failure and returns instead of
 * throwing, so one run reports EVERY defect across all four configurations
 * rather than stopping at the first. `reportCollected()` then fails the test —
 * a collecting run can never be mistaken for a passing gate.
 */
const COLLECTING = process.env.A11Y_COLLECT === '1';
const collected: string[] = [];

function softExpect(actual: unknown, message: string): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual([]);
    return;
  }
  const list = actual as unknown[];
  if (Array.isArray(list) && list.length === 0) return;
  collected.push(`${message}\n    ${JSON.stringify(actual)}`);
}

export function reportCollected(): void {
  if (!COLLECTING) return;
  console.log(`\n===== collected ${collected.length} finding(s) =====`);
  for (const line of collected) console.log(`  - ${line}`);
  expect(
    collected,
    'A11Y_COLLECT=1 was set: this is a collection run, not a passing gate'
  ).toEqual([]);
}

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This page's
 * reduced-motion block zeroes `animation-duration` and `transition-duration`
 * but says nothing about `opacity`, so any rule that starts an element at zero
 * and relies on a keyframe to raise it would land exactly here.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  softExpect(invisible, `no visible text may render at opacity 0 in state: ${label}`);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content — and the DEFAULTS — every later step relies on.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page.
 *
 * The default assertions are not decoration. This lab has two `<select>`s whose
 * value decides which row of a garbled truth table opens, a God-view switch that
 * decides whether secret wire bits are on screen at all, and four buttons that
 * ship disabled until a circuit exists. A gate that assumed any of those would
 * be scanning one half of the lab and reporting on the whole.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  // index.html's anti-flash script stamps `data-theme` unconditionally, falling
  // back to 'dark', so the attribute is present in both themes.
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  await expect(page.locator('h1.cl-hero-title')).toHaveText('Garbled Gate');
  await expect(page.locator('section.section')).toHaveCount(7);

  // Shipped defaults, asserted rather than assumed.
  await expect(page.locator('#alice-wealth')).toHaveValue('40');
  await expect(page.locator('#bob-wealth')).toHaveValue('35');
  await expect(page.locator('#and-a')).toHaveValue('0');
  await expect(page.locator('#and-b')).toHaveValue('0');
  await expect(page.locator('#ot-choice')).toHaveValue('0');
  await expect(page.locator('#full-alice')).toHaveValue('5');
  await expect(page.locator('#full-bob')).toHaveValue('3');
  await expect(page.locator('#god-view')).not.toBeChecked();
  await expect(page.locator('#proto-step')).toBeDisabled();
  await expect(page.locator('#proto-back')).toBeDisabled();
  await expect(page.locator('#proto-auto')).toBeDisabled();
  await expect(page.locator('#proto-reset')).toBeDisabled();
  await expect(page.locator('#proto-gate')).toBeHidden();
  // The AND stage and the circuit stage both render at first paint, empty.
  await expect(page.locator('#and-stage')).toBeAttached();
  await expect(page.locator('#circuit-stage')).toBeVisible();

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: it prints 128-bit labels as unbroken hex, lays a
 * comparator circuit out as a wide SVG, and carries a five-column comparison
 * table.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    // `body { overflow-x: hidden }` propagates to the viewport when `html`
    // leaves `overflow` at `visible`, so `scrollWidth` stays equal to
    // `clientWidth` even when content is CUT OFF — a worse 1.4.10 outcome than
    // a scrollbar, and invisible to the standard check. Detect the clipping
    // directly instead of trusting the scroll geometry.
    const clippedByViewport = ['hidden', 'clip'].includes(
      getComputedStyle(document.body).overflowX
    );
    if (!clippedByViewport && doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. The
    // circuit SVG has a huge bounding rect but is clipped by `.circuit-wrap`
    // and contributes nothing to the document's scroll width — naming it sends
    // you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      // Stop BEFORE <body>. When `body { overflow-x: hidden }` propagates to the
      // viewport, body itself answers "hidden" to this walk — so every element
      // on the page reads as clipped, `escaping` is always empty, and the oracle
      // reports nothing at all. That is the failure this whole check exists to
      // avoid: a viewport-level clip is the DEFECT, not a legitimate scroller.
      // Only a genuine scrolling container INSIDE the page excuses an overflow.
      while (n && n !== doc && n !== document.body) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    // Anything inside a real scroller is reachable and is not a finding; only
    // what escapes the viewport with no way back is.
    const escaping = over.filter((x) => !clipped(x.el));
    if (!escaping.length) return null;
    const widest = escaping[0]!;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest:
        `${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
        `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
        ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`,
    };
  });
  softExpect(
    overflow === null ? [] : [overflow],
    `page must not scroll horizontally in state: ${label}`
  );
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  softExpect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  );
}

/**
 * Scan the page as it currently stands.
 *
 * Five assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less div hides, a defect that never
 *    reaches the violations array at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`);

  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}

/**
 * Drive the lab through every state that renders content, scanning each.
 *
 * Six exhibits, each with its own machine. The order below walks them in the
 * order a visitor meets them, and takes every branch: the millionaire verdict
 * for A>B, A<B and A=B; the garbled AND gate for all FOUR input combinations
 * plus its reveal and trial-decrypt views; the OT for both choice bits; the
 * comparator stepped gate by gate, walked back, auto-played, reset, and shown
 * with and without God view; the label-reuse attack; and every quiz in both a
 * right and a wrong answer.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const s = (label: string): Promise<void> => scan(page, `${theme} / ${label}`);

  await s('first paint');

  // ── Exhibit 1: the millionaire verdict, all three outcomes ───────────────
  const millionaire = page.locator('#millionaire-result');
  const cases: [string, string, string][] = [
    // Wealth is quantised to 3 bits, so the two sliders are set to values that
    // land on distinct quantised bits rather than to arbitrary numbers.
    ['100', '1', 'A > B (sliders at their extremes)'],
    ['1', '100', 'A < B (sliders at their extremes)'],
    ['50', '50', 'A = B'],
  ];
  for (const [a, b, label] of cases) {
    await page.locator('#alice-wealth').fill(a);
    await page.locator('#bob-wealth').fill(b);
    await page.locator('#solve-millionaire').click();
    await expect(millionaire.locator('.verdict')).toBeVisible({ timeout: 20_000 });
    await s(`millionaire verdict: ${label}`);
  }

  // ── Exhibit 2: one garbled AND gate ──────────────────────────────────────
  await page.locator('#garble-and').click();
  await expect(page.locator('#and-stage .lock-row')).toHaveCount(4, { timeout: 20_000 });
  await s('AND gate garbled — the four locked rows');

  // All four input combinations: each opens a different row, and only the
  // (1,1) case produces a logical 1 on the output wire.
  for (const [a, b] of [
    ['0', '0'],
    ['0', '1'],
    ['1', '0'],
    ['1', '1'],
  ]) {
    await page.locator('#and-a').selectOption(a!);
    await page.locator('#and-b').selectOption(b!);
    await page.locator('#eval-and').click();
    await expect(page.locator('#and-stage .lock-row.lock-open')).toHaveCount(1, { timeout: 20_000 });
    await s(`AND gate evaluated with A=${a}, B=${b}`);
  }

  await page.locator('#reveal-and').click();
  await expect(page.locator('#and-stage .stage-narrate')).toContainText('output bit');
  await s('AND gate output bit revealed');

  await page.locator('#trial-and').click();
  await expect(page.locator('#and-stage .trial-cell')).toHaveCount(4, { timeout: 20_000 });
  await expect(page.locator('#and-stage .lock-row.lock-dead')).toHaveCount(3);
  await s('AND gate trial-decrypt — three rows measured shut, one open');

  // ── Exhibit 3: one OT, both choice bits ──────────────────────────────────
  for (const choice of ['0', '1']) {
    await page.locator('#ot-choice').selectOption(choice);
    await page.locator('#run-ot').click();
    await expect(page.locator('.ot-box-open')).toHaveCount(1, { timeout: 20_000 });
    await s(`oblivious transfer with choice bit ${choice}`);
  }

  // ── Exhibit 4: the full comparator, stepped ──────────────────────────────
  // Drive the sliders to their extremes, not their defaults: 7 vs 1 is the
  // widest comparison the 3-bit circuit can hold and the longest verdict text.
  await page.locator('#full-alice').fill('7');
  await page.locator('#full-bob').fill('1');
  await page.locator('#run-full').click();
  await expect(page.locator('#proto-step')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#circuit-stage svg')).toBeVisible();
  await s('comparator garbled, step 0 of the walkthrough');

  // Step forward through the whole circuit, scanning each gate. The narration
  // panel is `[hidden]` until the first step, so this is the only route to it.
  let steps = 0;
  // `refreshProtocol` disables Step the moment the last gate is reached, so the
  // loop tests for that rather than clicking into a 20s timeout.
  while (steps < 60 && (await page.locator('#proto-step').isEnabled())) {
    await page.locator('#proto-step').click();
    steps += 1;
    // The narration panel is `[hidden]` until the first gate is evaluated, so
    // that first step is the only route to it and is scanned on its own.
    if (steps === 1) {
      await expect(page.locator('#proto-gate')).toBeVisible();
      await s('comparator: first gate evaluated, narration panel revealed');
    }
  }
  expect(steps, 'stepping must actually advance the circuit').toBeGreaterThan(1);
  await expect(page.locator('#proto-step')).toBeDisabled();
  await expect(page.locator('#full-result')).not.toBeEmpty();
  await s('comparator fully evaluated — verdict on the output wires');

  // God view is a whole second rendering of the same circuit.
  await page.locator('#god-view').check();
  await expect(page.locator('#god-view')).toBeChecked();
  await s('comparator fully evaluated, God view on');

  await page.locator('#proto-back').click();
  await s('comparator stepped back one gate, God view on');

  await page.locator('#god-view').uncheck();
  await page.locator('#proto-reset').click();
  await expect(page.locator('#proto-back')).toBeDisabled();
  await expect(page.locator('#proto-step')).toBeEnabled();
  await s('comparator run reset to step 0');

  // Auto-play. The page sets its own tick to 0ms under reduced motion, so this
  // completes rather than animating — but it is still a distinct code path, and
  // the button relabels itself to "Pause" while it runs.
  await page.locator('#proto-auto').click();
  await expect(page.locator('#proto-auto')).toHaveText('Auto-play', { timeout: 20_000 });
  await s('comparator after auto-play ran to the end');

  // The circuit region is keyboard-operable: arrow keys step it.
  await page.locator('#proto-reset').click();
  await page.locator('#circuit-stage').focus();
  await expect(page.locator('#circuit-stage')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#proto-gate')).toBeVisible();
  await s('comparator stepped with the keyboard, circuit region focused');

  // ── Exhibit 5: the label-reuse attack ────────────────────────────────────
  await page.locator('#run-reuse').click();
  await expect(page.locator('#reuse-stage')).toContainText(/bit/i, { timeout: 20_000 });
  await s('label-reuse attack: the secret bit recovered');
  await expect(page.locator('#efficiency-live')).not.toBeEmpty();

  // ── Every quiz, both a wrong answer and a right one ──────────────────────
  // Which option is correct lives only in JS state — there is no attribute to
  // read up front. Answering once reveals it: the handler marks EVERY correct
  // option `.quiz-correct` regardless of what was picked. So click one option
  // to expose the answer key, then drive each quiz deliberately into its wrong
  // state and then into its right one.
  const quizzes = page.locator('.quiz');
  const quizCount = await quizzes.count();
  expect(quizCount, 'the lab must still carry its quizzes').toBeGreaterThanOrEqual(4);

  const correctIndexes: number[] = [];
  for (let i = 0; i < quizCount; i++) {
    const opts = quizzes.nth(i).locator('.quiz-opt');
    await opts.first().click();
    await expect(quizzes.nth(i).locator('.quiz-feedback')).not.toBeEmpty();
    const idx = await opts.evaluateAll((els) =>
      els.findIndex((e) => e.classList.contains('quiz-correct'))
    );
    expect(idx, 'each quiz must mark exactly one option correct').toBeGreaterThanOrEqual(0);
    correctIndexes.push(idx);
  }

  for (let i = 0; i < quizCount; i++) {
    const opts = quizzes.nth(i).locator('.quiz-opt');
    const wrong = correctIndexes[i] === 0 ? 1 : 0;
    await opts.nth(wrong).click();
    await expect(quizzes.nth(i).locator('.quiz-wrong')).toHaveCount(1);
  }
  await s('every quiz answered wrongly — the incorrect feedback state');

  for (let i = 0; i < quizCount; i++) {
    await quizzes.nth(i).locator('.quiz-opt').nth(correctIndexes[i]!).click();
    await expect(quizzes.nth(i).locator('.quiz-wrong')).toHaveCount(0);
  }
  await s('every quiz answered correctly — the correct feedback state');

  // ── Focus-revealed skip link. It parks off-screen until focused, so the
  // visible rendering only exists in this state.
  await page.locator('.cl-skip-link').focus();
  await expect(page.locator('.cl-skip-link')).toBeFocused();
  await s('shared header skip link focused');
}
