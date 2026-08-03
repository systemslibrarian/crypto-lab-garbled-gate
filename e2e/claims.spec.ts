import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Functional gate for the claims this page makes on screen.
 *
 * The a11y spec proves the page is reachable; this one proves it is *right*.
 * Every assertion below is checked against a number or verdict the page itself
 * computed and rendered — the slot point-and-permute picked, the wire bits the
 * God view exposes, the byte counts in the meter — rather than against a string
 * copied out of the source. Where the page offers a failure path (a row whose
 * GCM tag rejects, an OT box that stays sealed, a wrong quiz answer, a reused
 * gate that leaks a bit) the path is driven and its explanation asserted too.
 */

// ── Helpers ──────────────────────────────────────────────────────────────

/** Set a range input the way a drag would, so the app's `input` listener fires. */
async function setRange(page: Page, selector: string, value: number): Promise<void> {
  await page.evaluate(
    ([sel, v]) => {
      const el = document.querySelector<HTMLInputElement>(sel as string)!;
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [selector, value] as [string, number],
  );
}

/** Click a button that runs crypto and wait for its busy state to clear. */
async function runButton(page: Page, selector: string): Promise<void> {
  const btn = page.locator(selector);
  await btn.click();
  await expect(btn).not.toHaveAttribute('aria-busy', 'true');
  await expect(btn).toBeEnabled();
}

function squash(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

async function textOf(loc: Locator): Promise<string> {
  return squash(await loc.textContent());
}

/** The Exhibit 4 meter, as { label: rendered value }. */
async function readMeter(page: Page): Promise<Record<string, string>> {
  const cells = await page.$$eval('#proto-meter .meter', (nodes) =>
    nodes.map((n) => [
      n.querySelector('.meter-k')!.textContent!.trim(),
      n.querySelector('.meter-v')!.textContent!.trim(),
    ]),
  );
  return Object.fromEntries(cells);
}

function intFrom(value: string): number {
  const m = value.match(/-?\d[\d,]*/);
  expect(m, `no number in "${value}"`).not.toBeNull();
  return Number.parseInt(m![0].replace(/,/g, ''), 10);
}

/** Garble Exhibit 4's comparator for the given pair and wait for it to be ready. */
async function setUpComparator(page: Page, alice: number, bob: number): Promise<void> {
  await setRange(page, '#full-alice', alice);
  await setRange(page, '#full-bob', bob);
  await page.locator('#run-full').click();
  // The handler parks the old protocol and disables the stepper first, so the
  // stepper coming back enabled is the signal that the NEW run is loaded.
  await expect(page.locator('#proto-step')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#proto-checklist')).toContainText('Evaluating: 0 /');
}

/** Click Step until it disables; returns the narration seen at each step. */
async function stepToEnd(page: Page, gateCount: number): Promise<string[]> {
  const narrations: string[] = [];
  for (let i = 1; i <= gateCount; i += 1) {
    await page.locator('#proto-step').click();
    await expect(page.locator('#proto-gate')).toContainText(`Gate ${i}/${gateCount}`);
    narrations.push(await textOf(page.locator('#proto-gate')));
  }
  return narrations;
}

/** Wire name → logical bit, read off the God-view badges in the circuit SVG. */
async function readGodViewBits(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(() => {
    const out: Record<string, string | null> = {};
    for (const g of document.querySelectorAll('#circuit-stage .cnode')) {
      const sub = g.querySelector('.cnode-sub');
      const label = g.querySelector('.cnode-label');
      const bit = g.querySelector('.cnode-bit');
      const name = (sub ?? label)!.textContent!.trim();
      out[name] = bit ? bit.textContent!.trim() : null;
    }
    return out;
  });
}

function expectedVerdict(a: number, b: number): string {
  if (a > b) return 'Alice is richer';
  if (a < b) return 'Bob is richer';
  return 'Equal';
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await page.goto('.');
  await expect(page.locator('#ex1')).toBeVisible();
  // Surface any uncaught error from the render pass rather than letting a
  // half-rendered page quietly fail a later, more specific assertion.
  expect(failures).toEqual([]);
});

// ── The page README promises ─────────────────────────────────────────────

test('all six exhibits plus the honest-implementation notes render', async ({ page }) => {
  for (const id of ['ex1', 'ex2', 'ex3', 'ex4', 'ex5', 'ex6']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await expect(page.locator('#notes-heading')).toBeVisible();
  await expect(page.locator('#refs-heading')).toBeVisible();
  // One nav link per exhibit, each pointing at a section that exists.
  const hrefs = await page.$$eval('.toc a', (as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['#ex1', '#ex2', '#ex3', '#ex4', '#ex5', '#ex6']);
  // The notes must name the simplifications the README says are documented.
  const notes = page.locator('section', { has: page.locator('#notes-heading') });
  await expect(notes).toContainText('Cofactor 8');
  await expect(notes).toContainText('semi-honest');
  await expect(notes).toContainText('Free XOR');
});

// ── Exhibit 1 — the millionaire verdict ──────────────────────────────────

test("Exhibit 1: the verdict matches the quantised inputs the page reports", async ({ page }) => {
  test.setTimeout(90000);
  // Distinct Alice values so each run's own report line is unambiguous.
  for (const [alice, bob] of [
    [40, 35],
    [12, 90],
    [50, 50],
    [100, 1],
  ] as Array<[number, number]>) {
    await setRange(page, '#alice-wealth', alice);
    await setRange(page, '#bob-wealth', bob);
    await expect(page.locator('#alice-wealth-val')).toHaveText(`$${alice}M`);
    await expect(page.locator('#bob-wealth-val')).toHaveText(`$${bob}M`);

    await runButton(page, '#solve-millionaire');
    const result = page.locator('#millionaire-result');
    await expect(result).toContainText(`Alice ${alice} →`);
    await expect(result).toContainText(`Bob ${bob} →`);

    const text = await textOf(result);
    // The page prints the 3-bit values it actually fed the circuit; the verdict
    // has to agree with THOSE, not with the raw slider numbers.
    const quantised = text.match(/Alice \d+ → (\d), Bob \d+ → (\d)/);
    expect(quantised, `no quantisation line in "${text}"`).not.toBeNull();
    const a3 = Number.parseInt(quantised![1], 10);
    const b3 = Number.parseInt(quantised![2], 10);
    expect(a3).toBeGreaterThanOrEqual(1);
    expect(a3).toBeLessThanOrEqual(7);
    expect(b3).toBeGreaterThanOrEqual(1);
    expect(b3).toBeLessThanOrEqual(7);
    await expect(result.locator('.verdict')).toHaveText(expectedVerdict(a3, b3));
  }
});

// ── Exhibit 2 — one garbled gate ─────────────────────────────────────────

test('Exhibit 2: point-and-permute opens exactly the slot the colour bits name, for all four inputs', async ({
  page,
}) => {
  test.setTimeout(60000);
  await runButton(page, '#garble-and');
  const rows = page.locator('#and-stage .lock-row');
  await expect(rows).toHaveCount(4);
  // Rows are stored at their permute slot, so slots 0..3 appear exactly once.
  const slots = await rows.evaluateAll((els) => els.map((e) => e.querySelector('.lock-slot')!.textContent!.trim()));
  expect(slots).toEqual(['slot 0', 'slot 1', 'slot 2', 'slot 3']);

  for (const [a, b] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ] as Array<[0 | 1, 0 | 1]>) {
    await page.selectOption('#and-a', String(a));
    await page.selectOption('#and-b', String(b));
    await runButton(page, '#reveal-and');

    const narrate = page.locator('#and-stage .stage-narrate');
    await expect(narrate).toContainText(`A${a}`);
    await expect(narrate).toContainText(`B${b}`);
    const text = await textOf(narrate);

    const parsed = text.match(/colour bits (\d)(\d) → row slot (\d)/);
    expect(parsed, `no routing sentence in "${text}"`).not.toBeNull();
    const [c0, c1, slot] = [1, 2, 3].map((i) => Number.parseInt(parsed![i], 10));
    // The slot must BE the two colour bits, big-endian — that is the whole claim.
    expect(slot).toBe((c0 << 1) | c1);

    // The revealed bit is the AND of the two inputs Bob selected.
    const bit = text.match(/output bit (\d)/);
    expect(bit, `no revealed output bit in "${text}"`).not.toBeNull();
    expect(Number.parseInt(bit![1], 10)).toBe(a & b);

    // Exactly one padlock is open, and it is the row the narration named.
    const open = page.locator('#and-stage .lock-row.lock-open');
    await expect(open).toHaveCount(1);
    await expect(open.locator('.lock-slot')).toHaveText(`slot ${slot}`);
    await expect(open.locator('.lock-colours')).toHaveText(`${c0}${c1}`);
    await expect(open).toContainText('colour bits match → Bob opens this one');
    await expect(page.locator('#and-stage .lock-row.lock-dim')).toHaveCount(3);
  }
});

test('Exhibit 2: before the mapping is revealed the output label stays opaque', async ({ page }) => {
  await runButton(page, '#garble-and');
  await page.selectOption('#and-a', '1');
  await page.selectOption('#and-b', '1');
  await runButton(page, '#eval-and');

  const narrate = page.locator('#and-stage .stage-narrate');
  await expect(narrate).toContainText('opaque');
  await expect(narrate).toContainText("Bob can't read the bit yet");
  expect(await textOf(narrate)).not.toMatch(/output bit \d/);
  // C's chips carry no "=bit" tag until the mapping is revealed.
  await expect(page.locator('.wire-panel .wire-col').nth(2).locator('.chip-bit')).toHaveCount(0);

  // Revealing is what turns the same label into a bit.
  await runButton(page, '#reveal-and');
  await expect(narrate).toContainText('output bit 1');
  await expect(page.locator('.wire-panel .wire-col').nth(2).locator('.chip-bit')).toHaveCount(1);
});

test('Exhibit 2 failure path: trial-decrypting all four rows rejects three of them, and says why', async ({
  page,
}) => {
  test.setTimeout(60000);
  await runButton(page, '#garble-and');
  await page.selectOption('#and-a', '1');
  await page.selectOption('#and-b', '0');
  await runButton(page, '#reveal-and');
  const openSlot = await textOf(page.locator('#and-stage .lock-row.lock-open .lock-slot'));

  await runButton(page, '#trial-and');
  await expect(page.locator('.trial-strip')).toBeVisible();
  const cells = page.locator('.trial-cell');
  await expect(cells).toHaveCount(4);
  await expect(page.locator('.trial-cell.trial-ok')).toHaveCount(1);
  await expect(page.locator('.trial-cell.trial-fail')).toHaveCount(3);
  await expect(page.locator('.trial-cell.trial-ok')).toContainText('opens ✓');
  for (const cell of await page.locator('.trial-cell.trial-fail').all()) {
    await expect(cell).toContainText('GCM rejects ✗');
  }
  // The row that authenticates is the row point-and-permute jumped to.
  const okText = await textOf(page.locator('.trial-cell.trial-ok'));
  expect(okText.startsWith(openSlot)).toBe(true);

  // The padlocks now show MEASURED GCM results: three dead rows, each explained.
  await expect(page.locator('#and-stage .lock-row.lock-dead')).toHaveCount(3);
  for (const row of await page.locator('#and-stage .lock-row.lock-dead').all()) {
    await expect(row).toContainText('wrong key — GCM rejects');
  }
  await expect(page.locator('#and-stage .lock-row.lock-open')).toHaveCount(1);
  await expect(page.locator('#and-stage .lock-row.lock-open')).toContainText('GCM tag verified → opens');
  await expect(page.locator('.trial-caption')).toContainText('exactly one authenticates');
});

test('Exhibit 2: re-garbling mints fresh labels and re-locks every row', async ({ page }) => {
  await runButton(page, '#garble-and');
  const firstLabels = await page.$$eval('.wire-panel .chip-hex', (n) => n.map((x) => x.textContent!.trim()));
  await page.selectOption('#and-a', '1');
  await page.selectOption('#and-b', '1');
  await runButton(page, '#reveal-and');
  await expect(page.locator('#and-stage .lock-row.lock-open')).toHaveCount(1);

  await runButton(page, '#garble-and');
  await expect(page.locator('#and-stage .lock-row.lock-open')).toHaveCount(0);
  await expect(page.locator('#and-stage .lock-row')).toHaveCount(4);
  await expect(page.locator('#and-stage .stage-narrate')).toContainText('Garbled.');
  const secondLabels = await page.$$eval('.wire-panel .chip-hex', (n) => n.map((x) => x.textContent!.trim()));
  expect(secondLabels).toHaveLength(6);
  expect(secondLabels).not.toEqual(firstLabels);
});

// ── Exhibit 3 — oblivious transfer ───────────────────────────────────────

test('Exhibit 3: exactly one OT box opens; the other says why it stays sealed', async ({ page }) => {
  test.setTimeout(60000);
  for (const choice of [0, 1] as const) {
    await page.selectOption('#ot-choice', String(choice));
    await runButton(page, '#run-ot');

    const openBox = page.locator(`#box${choice}`);
    const shutBox = page.locator(`#box${1 - choice}`);
    await expect(openBox).toHaveClass(/ot-box-open/);
    await expect(shutBox).not.toHaveClass(/ot-box-open/);
    await expect(openBox.locator('.lock-open')).toHaveCount(1);
    await expect(shutBox).toContainText("stays sealed — Bob can't derive this key");

    // The label shown in the opened box is the one the transcript says Bob
    // recovered — the box is not just decorative.
    await expect(page.locator('#ot-steps')).toContainText(`folds in his choice ${choice}`);
    const steps = await textOf(page.locator('#ot-steps'));
    const recovered = steps.match(/label for bit (\d) = ([0-9a-f…]+)\./);
    expect(recovered, `no recovery line in "${steps}"`).not.toBeNull();
    expect(Number.parseInt(recovered![1], 10)).toBe(choice);
    await expect(openBox).toContainText(recovered![2]);
    expect(steps).toContain(`folds in his choice ${choice}`);
    expect(steps).toContain('Alice never learns');
  }
});

// ── Exhibit 4 — the full protocol ────────────────────────────────────────

test('Exhibit 4: the meter, the checklist and the efficiency line agree with each other', async ({ page }) => {
  test.setTimeout(60000);
  await setUpComparator(page, 5, 3);

  const meter = await readMeter(page);
  const gates = intFrom(meter['Gates']);
  const andOr = intFrom(meter['AND/OR (garbled)']);
  const xor = intFrom(meter['XOR (free)']);
  const ots = intFrom(meter['Oblivious transfers']);
  const bytes = intFrom(meter['Garbled payload']);
  const saved = intFrom(meter['Estimated Free XOR saving']);

  // Parts sum to the whole.
  expect(andOr + xor).toBe(gates);
  expect(andOr).toBeGreaterThan(0);
  expect(xor).toBeGreaterThan(0);

  // Only AND/OR gates carry ciphertext, four equal rows each.
  expect(bytes).toBeGreaterThan(0);
  expect(bytes % (andOr * 4)).toBe(0);
  const avgRow = bytes / (andOr * 4);
  // The saving is the counterfactual 4-row cost of the free XOR gates.
  expect(saved).toBe(Math.round(xor * 4 * avgRow));

  // One OT per Bob input bit, and the checklist's bit strings are the sliders.
  const checklist = await textOf(page.locator('#proto-checklist'));
  const aliceBits = checklist.match(/Alice's input labels sent for bits ([01]+)/);
  const bobBits = checklist.match(/OTs delivered Bob's labels for bits ([01]+)/);
  expect(aliceBits, checklist).not.toBeNull();
  expect(bobBits, checklist).not.toBeNull();
  expect(Number.parseInt(aliceBits![1], 2)).toBe(5);
  expect(Number.parseInt(bobBits![1], 2)).toBe(3);
  expect(bobBits![1].length).toBe(ots);
  expect(checklist).toContain(`${andOr} AND/OR tables encrypted, ${xor} XOR gates free`);
  expect(checklist).toContain(`Evaluating: 0 / ${gates} gates`);

  // Exhibit 5's live efficiency line quotes the SAME measured run.
  const efficiency = await textOf(page.locator('#efficiency-live'));
  expect(efficiency).toContain(`${bytes} bytes of garbled tables for ${andOr} AND/OR gates`);
  expect(efficiency).toContain(`${xor} XOR gates contributing 0 measured bytes`);
  expect(efficiency).toContain(`add ≈ ${saved} bytes`);
});

test('Exhibit 4: the verdict matches the output bits the circuit itself computed', async ({ page }) => {
  test.setTimeout(120000);
  for (const [alice, bob] of [
    [5, 3],
    [2, 6],
    [4, 4],
  ] as Array<[number, number]>) {
    await setUpComparator(page, alice, bob);
    await page.locator('#god-view').check();
    const gates = intFrom((await readMeter(page))['Gates']);
    await stepToEnd(page, gates);

    // gt / eq are the circuit's own output wires, read off the God-view badges.
    const bits = await readGodViewBits(page);
    expect(bits.gt, 'gt has no God-view bit').not.toBeNull();
    expect(bits.eq, 'eq has no God-view bit').not.toBeNull();
    expect(bits.gt).toBe(alice > bob ? '1' : '0');
    expect(bits.eq).toBe(alice === bob ? '1' : '0');

    const verdictFromWires = bits.eq === '1' ? 'Equal' : bits.gt === '1' ? 'Alice is richer' : 'Bob is richer';
    const result = page.locator('#full-result');
    await expect(result.locator('.verdict')).toHaveText(verdictFromWires);
    await expect(result.locator('.verdict')).toHaveText(expectedVerdict(alice, bob));
    // The result line also has to name the two private inputs it ran on.
    await expect(result).toContainText(`Alice never saw Bob's ${bob}`);
    await expect(result).toContainText(`Bob never saw Alice's ${alice}`);
    await expect(page.locator('#proto-checklist')).toContainText(`Evaluated all ${gates} gates`);
    await page.locator('#god-view').uncheck();
  }
});

test('Exhibit 4: the verdict stays hidden until the final gate', async ({ page }) => {
  test.setTimeout(90000);
  await setUpComparator(page, 7, 1);
  const gates = intFrom((await readMeter(page))['Gates']);
  const result = page.locator('#full-result');

  await expect(result).toContainText('Evaluation in progress');
  await expect(result.locator('.verdict')).toHaveCount(0);
  await expect(page.locator('#proto-back')).toBeDisabled();

  for (let i = 1; i < gates; i += 1) {
    await page.locator('#proto-step').click();
    await expect(page.locator('#proto-gate')).toContainText(`Gate ${i}/${gates}`);
    await expect(result.locator('.verdict'), `verdict leaked at gate ${i}`).toHaveCount(0);
    // The diagram's accessible name tracks progress with the stepper.
    await expect(page.locator('#circuit-stage .circuit-svg')).toHaveAttribute(
      'aria-label',
      `3-bit comparator circuit, ${i} of ${gates} gates evaluated`,
    );
  }
  await expect(page.locator('#proto-step')).toBeEnabled();
  await page.locator('#proto-step').click();
  await expect(result.locator('.verdict')).toHaveText('Alice is richer');
  await expect(page.locator('#proto-step')).toBeDisabled();
});

test('Exhibit 4: every gate narrates its own logic, and the free/garbled split matches the meter', async ({
  page,
}) => {
  test.setTimeout(90000);
  await setUpComparator(page, 6, 2);
  await page.locator('#god-view').check();
  const meter = await readMeter(page);
  const gates = intFrom(meter['Gates']);
  const andOr = intFrom(meter['AND/OR (garbled)']);
  const xor = intFrom(meter['XOR (free)']);

  const narrations = await stepToEnd(page, gates);
  expect(narrations).toHaveLength(gates);

  let free = 0;
  let garbled = 0;
  const claimedBits: Record<string, string> = {};
  for (const line of narrations) {
    const head = line.match(/Gate (\d+)\/(\d+) — (XOR|AND|OR)\((\w+), (\w+)\) → (\w+)/);
    expect(head, `unparsable narration "${line}"`).not.toBeNull();
    expect(Number.parseInt(head![2], 10)).toBe(gates);
    const [type, inA, inB, out] = [head![3], head![4], head![5], head![6]];

    const god = line.match(/God view: secretly (\d) (XOR|AND|OR) (\d) = (\d)/);
    expect(god, `no God-view line in "${line}"`).not.toBeNull();
    const [aBit, bBit, outBit] = [god![1], god![3], god![4]].map((v) => Number.parseInt(v, 10));
    expect(god![2]).toBe(type);
    // The page's own claim about this gate must be true of its own operator.
    const expectedOut = type === 'XOR' ? aBit ^ bBit : type === 'AND' ? aBit & bBit : aBit | bBit;
    expect(outBit, `${type}(${aBit}, ${bBit}) narrated as ${outBit}`).toBe(expectedOut);

    if (type === 'XOR') {
      free += 1;
      expect(line).toContain('Free XOR');
      expect(line).toContain('zero cost');
      expect(line).not.toContain('slot');
    } else {
      garbled += 1;
      const slot = line.match(/slot (\d)/);
      expect(slot, `no decrypted slot in "${line}"`).not.toBeNull();
      const slotNum = Number.parseInt(slot![1], 10);
      expect(slotNum).toBeGreaterThanOrEqual(0);
      expect(slotNum).toBeLessThanOrEqual(3);
      expect(line).toContain('point-and-permute');
    }

    // Fan-out consistency: a wire's bit must be the same everywhere it appears.
    for (const [wire, bit] of [
      [inA, String(aBit)],
      [inB, String(bBit)],
      [out, String(outBit)],
    ] as Array<[string, string]>) {
      if (claimedBits[wire] !== undefined) {
        expect(claimedBits[wire], `wire ${wire} narrated as both ${claimedBits[wire]} and ${bit}`).toBe(bit);
      }
      claimedBits[wire] = bit;
    }
  }

  expect(free).toBe(xor);
  expect(garbled).toBe(andOr);
  expect(free + garbled).toBe(gates);

  // And the diagram agrees with the narration, wire for wire.
  const svgBits = await readGodViewBits(page);
  for (const [wire, bit] of Object.entries(claimedBits)) {
    expect(svgBits[wire], `wire ${wire} missing from the diagram`).toBe(bit);
  }
});

test('Exhibit 4: auto-play runs to the end and hands the live region back', async ({ page }) => {
  test.setTimeout(120000);
  await setUpComparator(page, 3, 5);
  const gates = intFrom((await readMeter(page))['Gates']);

  await page.locator('#proto-auto').click();
  await expect(page.locator('#proto-auto')).toHaveText('Pause');
  // The narration is silenced while it flies past, then restored.
  await expect(page.locator('#proto-gate')).toHaveAttribute('aria-live', 'off');

  await expect(page.locator('#full-result').locator('.verdict')).toHaveText('Bob is richer', { timeout: 60000 });
  await expect(page.locator('#proto-gate')).toContainText(`Gate ${gates}/${gates}`);
  await expect(page.locator('#proto-auto')).toHaveText('Auto-play', { timeout: 10000 });
  await expect(page.locator('#proto-gate')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#proto-step')).toBeDisabled();
});

test('Exhibit 4: Back, arrow keys and Reset walk the evaluation backwards', async ({ page }) => {
  test.setTimeout(90000);
  await setUpComparator(page, 5, 3);
  const gates = intFrom((await readMeter(page))['Gates']);

  await page.locator('#proto-step').click();
  await page.locator('#proto-step').click();
  await expect(page.locator('#proto-gate')).toContainText(`Gate 2/${gates}`);
  await page.locator('#proto-back').click();
  await expect(page.locator('#proto-gate')).toContainText(`Gate 1/${gates}`);

  // Arrow keys on the focused diagram do the same job as the buttons.
  await page.locator('#circuit-stage').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#proto-gate')).toContainText(`Gate 2/${gates}`);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#proto-gate')).toContainText('No gates evaluated yet');
  await expect(page.locator('#proto-back')).toBeDisabled();
  await expect(page.locator('#circuit-stage .cnode-current')).toHaveCount(0);

  // Step forward again, then Reset must return to gate 0 and re-hide the verdict.
  await page.locator('#proto-step').click();
  await expect(page.locator('#circuit-stage .cnode-current')).toHaveCount(1);
  await page.locator('#proto-reset').click();
  await expect(page.locator('#proto-gate')).toContainText('No gates evaluated yet');
  await expect(page.locator('#proto-checklist')).toContainText(`Evaluating: 0 / ${gates} gates`);
  await expect(page.locator('#full-result')).toContainText('Evaluation in progress');
  await expect(page.locator('#full-result').locator('.verdict')).toHaveCount(0);
});

// ── Exhibit 5 — the label-reuse attack ───────────────────────────────────

test('Exhibit 5: reusing one gate leaks Alice’s bit, and the reasoning matches the labels', async ({ page }) => {
  test.setTimeout(90000);
  const stage = page.locator('#reuse-stage');
  for (let run = 0; run < 6; run += 1) {
    // Clear the transcript so we can never read the previous run's text.
    await page.evaluate(() => {
      document.querySelector('#reuse-stage')!.innerHTML = '';
    });
    await runButton(page, '#run-reuse');
    await expect(stage.locator('.verdict')).toHaveCount(1);

    const text = await textOf(stage);
    const actual = text.match(/Alice's actual bit was (\d)/);
    expect(actual, `no reveal check in "${text}"`).not.toBeNull();
    const aliceBit = Number.parseInt(actual![1], 10);

    // The two honest decryptions must open DIFFERENT rows — B⁰ and B¹ carry
    // opposite colour bits — and the leak conclusion follows from whether the
    // recovered output labels matched.
    const slots = [...text.matchAll(/opens slot (\d) → output label ([0-9a-f…]+)\./g)].map((m) => [
      Number.parseInt(m[1], 10),
      m[2],
    ]);
    expect(slots, `expected two decryptions in "${text}"`).toHaveLength(2);
    expect(slots[0][0]).not.toBe(slots[1][0]);

    const identical = text.includes('The two output labels are identical');
    const differ = text.includes('The two output labels differ');
    expect(identical || differ, `no reuse conclusion in "${text}"`).toBe(true);
    expect(identical).toBe(slots[0][1] === slots[1][1]);
    // identical outputs ⇒ a∧0 = a∧1 ⇒ a = 0; different ⇒ a = 1.
    await expect(stage.locator('.verdict')).toHaveText(`a = ${identical ? 0 : 1}`);
    expect(identical ? 0 : 1).toBe(aliceBit);
    await expect(stage).toContainText('correct ✓');
    expect(text).not.toContain('wrong ✗');
    expect(text).toContain('One reuse leaked one full input bit');
  }
});

// ── Self-check quizzes ───────────────────────────────────────────────────

test('the self-check quizzes explain wrong answers and mark the right one', async ({ page }) => {
  test.setTimeout(60000);
  for (const id of ['m1', 'g1', 'o1', 's1']) {
    const quiz = page.locator(`#quiz-${id}`);
    const opts = quiz.locator('.quiz-opt');
    await expect(opts).toHaveCount(3);
    const feedback = quiz.locator('.quiz-feedback');
    await expect(feedback).toBeEmpty();

    // Every option must land somewhere and explain itself.
    for (let i = 0; i < 3; i += 1) {
      await opts.nth(i).click();
      const chosenWrong = await opts.nth(i).evaluate((el) => el.classList.contains('quiz-wrong'));
      await expect(feedback).toContainText(chosenWrong ? 'Not quite.' : 'Correct.');
      // Exactly one option is the right one, and it is always highlighted.
      await expect(quiz.locator('.quiz-opt.quiz-correct')).toHaveCount(1);
      await expect(quiz.locator('.quiz-opt.quiz-wrong')).toHaveCount(chosenWrong ? 1 : 0);
      // The explanation is real prose, not a bare verdict.
      expect((await textOf(feedback)).length).toBeGreaterThan(30);
    }
  }
});
