import './style.css';
import {
  bytesToHex,
  evaluateAndGateDemo,
  garbleAndGateDemo,
  labelPermuteBit,
  randomBit,
  runInputLabelOT,
  runLabelReuseAttack,
  runMillionaireProtocol3Bit,
  trialDecryptAll,
  type AndGateDemo,
  type AndGateEvaluation,
  type CircuitLayout,
  type MillionaireProtocolResult,
  type ReuseAttackResult,
} from './yao';

// ── State ────────────────────────────────────────────────────────────────

interface AppState {
  andDemo: AndGateDemo | null;
  andEval: AndGateEvaluation | null;
  andTrial: Array<{ slot: number; ok: boolean }> | null;
  protocol: MillionaireProtocolResult | null;
  protoStep: number; // how many gates have been evaluated in the walkthrough
  godView: boolean;
  autoTimer: number | null;
  reuse: ReuseAttackResult | null;
}

const state: AppState = {
  andDemo: null,
  andEval: null,
  andTrial: null,
  protocol: null,
  protoStep: 0,
  godView: false,
  autoTimer: null,
  reuse: null,
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── DOM helpers ──────────────────────────────────────────────────────────

function q<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el as T;
}

function maybe<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector(selector) as T | null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function shortHex(hex: string, head = 8, tail = 4): string {
  if (hex.length <= (head + tail) * 2) return hex;
  return `${hex.slice(0, head * 2)}…${hex.slice(-tail * 2)}`;
}

// ── Visual primitives ────────────────────────────────────────────────────

/** A wire-label chip: 16 random bytes that secretly encode a bit. */
function labelChip(
  name: string,
  hex: string,
  opts: { bit?: 0 | 1 | null; active?: boolean; dim?: boolean; reveal?: boolean } = {},
): string {
  const colour = labelPermuteBit(hexBytesLast(hex));
  const cls = ['chip'];
  if (opts.active) cls.push('chip-active');
  if (opts.dim) cls.push('chip-dim');
  if (opts.reveal && (opts.bit === 0 || opts.bit === 1)) cls.push(`chip-bit${opts.bit}`);
  const bitTag =
    opts.reveal && (opts.bit === 0 || opts.bit === 1)
      ? `<span class="chip-bit" title="secret logical value">=${opts.bit}</span>`
      : '';
  return `<span class="${cls.join(' ')}">
    <span class="chip-name">${esc(name)}</span>${bitTag}
    <span class="chip-colour colour-${colour}" title="public colour (point-and-permute) bit">${colour}</span>
    <span class="chip-hex">${shortHex(hex)}</span>
  </span>`;
}

function hexBytesLast(hex: string): Uint8Array {
  // tiny helper: we only need the final byte's parity for the colour bit
  const last = hex.slice(-2);
  return new Uint8Array([Number.parseInt(last || '0', 16)]);
}

function andGateSvg(opts: { aBit?: 0 | 1 | null; bBit?: 0 | 1 | null; lit?: boolean }): string {
  const a = opts.aBit ?? null;
  const b = opts.bBit ?? null;
  const lit = opts.lit ?? false;
  const wire = (on: boolean) => (on ? 'var(--accent)' : 'var(--border)');
  const aOn = a !== null;
  const bOn = b !== null;
  return `
  <svg viewBox="0 0 320 160" class="gate-svg" role="img" aria-label="AND gate schematic with inputs A and B and output C">
    <line x1="10" y1="50" x2="120" y2="50" stroke="${wire(aOn)}" stroke-width="3"/>
    <line x1="10" y1="110" x2="120" y2="110" stroke="${wire(bOn)}" stroke-width="3"/>
    <path d="M120 30 H170 A50 50 0 0 1 170 130 H120 Z" fill="var(--surface-alt)" stroke="${lit ? 'var(--success)' : 'var(--accent)'}" stroke-width="3"/>
    <text x="155" y="86" text-anchor="middle" class="gate-glyph">AND</text>
    <line x1="220" y1="80" x2="310" y2="80" stroke="${lit ? 'var(--success)' : 'var(--border)'}" stroke-width="3"/>
    <text x="6" y="42" class="gate-pin">A</text>
    <text x="6" y="102" class="gate-pin">B</text>
    <text x="300" y="72" class="gate-pin" text-anchor="end">C</text>
    <circle cx="65" cy="50" r="11" class="gate-bit ${aOn ? 'gate-bit-on' : ''}"/>
    <text x="65" y="54" text-anchor="middle" class="gate-bit-txt">${a ?? '?'}</text>
    <circle cx="65" cy="110" r="11" class="gate-bit ${bOn ? 'gate-bit-on' : ''}"/>
    <text x="65" y="114" text-anchor="middle" class="gate-bit-txt">${b ?? '?'}</text>
  </svg>`;
}

// ── Section scaffold ─────────────────────────────────────────────────────

function sectionTemplate(id: string, title: string, body: string): string {
  const headingId = `${id}-heading`;
  return `
    <section class="section" id="${id}" aria-labelledby="${headingId}">
      <div class="section-head"><h2 id="${headingId}">${title}</h2></div>
      <div class="section-body">${body}</div>
    </section>`;
}

function formatMoney(value: number): string {
  return `$${value}M`;
}

// ── Quiz component ───────────────────────────────────────────────────────

interface QuizOption {
  label: string;
  correct: boolean;
  explain: string;
}

const quizzes: Record<string, QuizOption[]> = {};

function quiz(id: string, prompt: string, options: QuizOption[]): string {
  quizzes[id] = options;
  const opts = options
    .map(
      (o, i) =>
        `<button class="quiz-opt" type="button" data-quiz="${id}" data-idx="${i}">${esc(o.label)}</button>`,
    )
    .join('');
  return `
    <div class="quiz" id="quiz-${id}">
      <p class="quiz-q"><span class="quiz-tag">Check yourself</span> ${prompt}</p>
      <div class="quiz-opts">${opts}</div>
      <div class="quiz-feedback" aria-live="polite"></div>
    </div>`;
}

function handleQuizClick(target: HTMLElement): void {
  const btn = target.closest<HTMLElement>('.quiz-opt');
  if (!btn) return;
  const id = btn.dataset.quiz!;
  const idx = Number.parseInt(btn.dataset.idx!, 10);
  const options = quizzes[id];
  const chosen = options[idx];
  const wrap = q(`#quiz-${id}`);
  wrap.querySelectorAll<HTMLButtonElement>('.quiz-opt').forEach((b, i) => {
    b.classList.remove('quiz-correct', 'quiz-wrong');
    if (options[i].correct) b.classList.add('quiz-correct');
    if (i === idx && !chosen.correct) b.classList.add('quiz-wrong');
    b.disabled = false;
  });
  const fb = wrap.querySelector<HTMLElement>('.quiz-feedback')!;
  fb.innerHTML = `<strong class="${chosen.correct ? 'ok' : 'bad'}">${chosen.correct ? 'Correct.' : 'Not quite.'}</strong> ${esc(chosen.explain)}`;
}

// ── Render ───────────────────────────────────────────────────────────────

function render(): void {
  const app = q('#app');
  app.innerHTML = `
    <main role="main" id="main-content">
      <div class="container">
        <header class="cl-hero">
          <div class="cl-hero-main">
            <h1 class="cl-hero-title">Garbled Gate</h1>
            <p class="cl-hero-sub">Yao's Garbled Circuits · secure two-party computation</p>
            <p class="cl-hero-desc">Watch one AND gate get garbled, one padlock row unlock via oblivious transfer, and a whole comparator decide who's richer — without either party revealing a bit.</p>
          </div>
          <aside class="cl-hero-why" aria-label="Why it matters">
            <span class="cl-hero-why-label">WHY IT MATTERS</span>
            <p class="cl-hero-why-text">Garbled circuits let mutually distrustful parties compute on private data — auctions, medical stats, key management — with no trusted referee. The evaluator learns only the answer, never the other side's inputs.</p>
          </aside>
        </header>
        <button id="theme-toggle" class="theme-toggle" type="button" hidden aria-hidden="true"></button>
        ${navStrip()}
        ${exhibit1()}
        ${exhibit2()}
        ${exhibit3()}
        ${exhibit4()}
        ${exhibit5()}
        ${exhibit6()}
        ${notesAndRefs()}
      </div>
    </main>`;

  wireEvents();
  setupThemeToggle();
  renderAndStage();
  renderCircuitStage();
}

function navStrip(): string {
  const items = [
    ['ex1', "1 · Millionaire's Problem"],
    ['ex2', '2 · One garbled gate'],
    ['ex3', '3 · Oblivious Transfer'],
    ['ex4', '4 · Full circuit'],
    ['ex5', '5 · Security & cost'],
    ['ex6', '6 · In production'],
  ];
  return `<nav class="toc" aria-label="Exhibits">
    ${items.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}
  </nav>`;
}

function exhibit1(): string {
  return sectionTemplate(
    'ex1',
    "Exhibit 1 — The Millionaire's Problem",
    `
    <p>Alice has private wealth <em>A</em>, Bob has private wealth <em>B</em>. They want to learn whether <strong>A &gt; B</strong> — and nothing else. No trusted third party, no revealing the numbers. This is Yao's Millionaire's Problem (1982), the spark for all of secure two-party computation.</p>
    <div class="card-grid">
      <div class="card">
        <h3>Why it's hard</h3>
        <ul>
          <li>A trusted referee would settle it instantly — but there isn't one.</li>
          <li>If Alice sends <em>A</em>, Bob learns it. Same in reverse.</li>
          <li>Ordinary encryption hides data <em>in transit</em>; it can't <em>compute</em> on hidden inputs.</li>
        </ul>
      </div>
      <div class="card">
        <h3>The garbled-circuit answer</h3>
        <ul>
          <li>Alice turns "is A &gt; B?" into a boolean circuit and <em>garbles</em> it.</li>
          <li>Bob gets his input as scrambled labels via Oblivious Transfer.</li>
          <li>Bob runs the circuit blind and learns only the verdict.</li>
          <li>Alice learns nothing about <em>B</em>.</li>
        </ul>
      </div>
    </div>
    <div class="row" style="margin-top:0.8rem;">
      <div style="flex:1; min-width:210px;">
        <label for="alice-wealth">Alice's wealth: <output id="alice-wealth-val" for="alice-wealth">${formatMoney(40)}</output></label>
        <input id="alice-wealth" type="range" min="1" max="100" value="40" aria-describedby="alice-wealth-val" />
      </div>
      <div style="flex:1; min-width:210px;">
        <label for="bob-wealth">Bob's wealth: <output id="bob-wealth-val" for="bob-wealth">${formatMoney(35)}</output></label>
        <input id="bob-wealth" type="range" min="1" max="100" value="35" aria-describedby="bob-wealth-val" />
      </div>
      <div style="flex:1; min-width:220px; align-self:flex-end;">
        <button id="solve-millionaire" class="btn btn-primary" type="button">Solve privately →</button>
      </div>
    </div>
    <div id="millionaire-result" class="status" aria-live="polite">Set two amounts and run the protocol. Only the verdict comes out the other side.</div>
    <div class="callout">
      <strong>The big idea:</strong> compute a function's <em>output</em> without exposing its <em>inputs</em>. The same trick powers private set intersection, sealed-bid auctions, private contact discovery, and privacy-preserving ML.
    </div>
    ${quiz('m1', 'After the protocol runs, what does Bob learn about Alice\'s exact wealth?', [
      { label: 'Her exact dollar amount', correct: false, explain: 'No — the whole point is that the inputs never leave each party. Bob only sees scrambled labels.' },
      { label: 'Only whether A > B (or =)', correct: true, explain: 'Right. The output wire reveals just the comparison verdict; the inputs stay hidden inside random labels.' },
      { label: 'Nothing at all', correct: false, explain: 'He does learn the agreed output — the verdict — just not the inputs behind it.' },
    ])}`,
  );
}

function exhibit2(): string {
  return sectionTemplate(
    'ex2',
    'Exhibit 2 — Anatomy of one garbled gate',
    `
    <p>Strip the protocol down to a single <strong>AND</strong> gate. The garbler (Alice) replaces every wire value with a random 128-bit <em>label</em>, then encrypts the gate's truth table so each row can only be opened with the right pair of input labels. The evaluator (Bob) ends up holding one output <em>label</em> — and still doesn't know the bit it stands for.</p>

    <div class="legend">
      <span class="legend-item"><span class="chip chip-mini"><span class="chip-colour colour-1">1</span></span> public <strong>colour</strong> bit — random, leaks nothing</span>
      <span class="legend-item"><span class="chip chip-mini chip-bit1"><span class="chip-bit">=1</span></span> secret <strong>logical</strong> bit (hidden from Bob)</span>
      <span class="legend-item"><span class="lock lock-open lock-mini">🔓</span> row Bob can open</span>
      <span class="legend-item"><span class="lock lock-mini">🔒</span> row that stays shut</span>
    </div>

    <div class="stepper" role="group" aria-label="Garbled gate controls">
      <button id="garble-and" class="btn btn-primary" type="button">1 · Garble the gate</button>
      <div class="step-inputs">
        <label for="and-a">Bob's A</label>
        <select id="and-a"><option value="0">0</option><option value="1">1</option></select>
      </div>
      <div class="step-inputs">
        <label for="and-b">Bob's B</label>
        <select id="and-b"><option value="0">0</option><option value="1">1</option></select>
      </div>
      <button id="eval-and" class="btn" type="button">2 · Evaluate</button>
      <button id="reveal-and" class="btn" type="button">3 · Reveal output bit</button>
      <button id="trial-and" class="btn btn-ghost" type="button">Why only one row?</button>
    </div>

    <div id="and-stage"></div>

    <div class="callout callout-info">
      <strong>Point-and-permute:</strong> each label carries a public "colour" bit that is decoupled from its secret logical value. Bob reads the two colour bits off his active labels, jumps straight to that one row, and decrypts it. No trial-and-error, no leak — the colour bits are random.
    </div>
    ${quiz('g1', 'Bob holds the output label after evaluating. Can he tell whether it means 0 or 1?', [
      { label: 'Yes, labels are readable', correct: false, explain: 'A label is 16 random bytes. Without the mapping it is indistinguishable from noise.' },
      { label: 'No — not until Alice reveals the output mapping', correct: true, explain: 'Exactly. Bob carries an opaque label; only the final output-wire mapping turns it into a bit.' },
      { label: 'Only if the bit is 1', correct: false, explain: 'Both labels look equally random; neither value is distinguishable on its own.' },
    ])}`,
  );
}

function exhibit3(): string {
  return sectionTemplate(
    'ex3',
    'Exhibit 3 — Oblivious Transfer for Bob\'s inputs',
    `
    <p>Bob needs the label for <em>his</em> bit on each input wire — but Alice must not learn which one he took, and Bob must not see the other. 1-of-2 <strong>Oblivious Transfer</strong> delivers exactly that, here via Chou–Orlandi (LATINCRYPT 2015) on Curve25519. Same machinery as <a href="https://systemslibrarian.github.io/crypto-lab-ot-gate/" target="_blank" rel="noopener">OT Gate</a>.</p>
    <div class="row">
      <div style="flex:1; min-width:200px;">
        <label for="ot-choice">Bob's choice bit</label>
        <select id="ot-choice"><option value="0">0</option><option value="1">1</option></select>
      </div>
      <div style="flex:1; min-width:220px; align-self:flex-end;"><button id="run-ot" class="btn btn-primary" type="button">Run one OT</button></div>
    </div>
    <div class="ot-boxes">
      <div class="ot-box" id="box0"><div class="ot-box-top">Wire-label for bit&nbsp;0</div><div class="ot-box-body lock">🔒 locked</div></div>
      <div class="ot-box" id="box1"><div class="ot-box-top">Wire-label for bit&nbsp;1</div><div class="ot-box-body lock">🔒 locked</div></div>
    </div>
    <div id="ot-steps" class="status" aria-live="polite">Pick a choice bit and run. Exactly one box opens; Alice can't tell which.</div>
    <div class="callout">
      <strong>One OT per Bob input bit.</strong> A 3-bit value needs 3 OTs; OT count grows linearly with Bob's input length, independent of circuit size. (Real systems amortise this with OT extension.)
    </div>
    ${quiz('o1', 'After the OT, what does Alice know about Bob\'s choice bit?', [
      { label: 'She learns it exactly', correct: false, explain: 'No — Bob\'s message B looks the same to Alice for choice 0 or 1. That hiding is the point of OT.' },
      { label: 'Nothing', correct: true, explain: 'Correct. Alice sends both ciphertexts; Bob can only derive the key for the one he chose, and Alice can\'t tell which.' },
      { label: 'A 50/50 guess that improves over time', correct: false, explain: 'Each OT is independently hiding; repetition doesn\'t leak the choice.' },
    ])}`,
  );
}

function exhibit4(): string {
  return sectionTemplate(
    'ex4',
    'Exhibit 4 — The full protocol, gate by gate',
    `
    <p>Now the real thing: a public 3-bit comparator wired from XOR / AND / OR gates. Set both values, run the setup, then <strong>step through evaluation</strong> and watch labels propagate. Toggle <strong>God view</strong> to see the secret bit on every wire — the view Bob never has.</p>
    <div class="row">
      <div style="flex:1; min-width:180px;">
        <label for="full-alice">Alice (1–7): <output id="full-alice-val" for="full-alice">5</output></label>
        <input id="full-alice" type="range" min="1" max="7" value="5" aria-describedby="full-alice-val" />
      </div>
      <div style="flex:1; min-width:180px;">
        <label for="full-bob">Bob (1–7): <output id="full-bob-val" for="full-bob">3</output></label>
        <input id="full-bob" type="range" min="1" max="7" value="3" aria-describedby="full-bob-val" />
      </div>
      <div style="flex:1; min-width:160px; align-self:flex-end;"><button id="run-full" class="btn btn-primary" type="button">Set up & garble</button></div>
    </div>
    <div class="stepper" role="group" aria-label="Circuit walkthrough controls">
      <button id="proto-back" class="btn" type="button" disabled>◀ Back</button>
      <button id="proto-step" class="btn" type="button" disabled>Step ▶</button>
      <button id="proto-auto" class="btn" type="button" disabled>Auto-play</button>
      <button id="proto-reset" class="btn btn-ghost" type="button" disabled>Reset run</button>
      <label class="switch"><input type="checkbox" id="god-view" /> <span>God view (reveal wire bits)</span></label>
    </div>
    <div id="proto-checklist" class="status" aria-live="polite">Press “Set up &amp; garble” to begin.</div>
    <div id="circuit-stage" class="circuit-wrap" tabindex="0" role="region" aria-label="Comparator circuit diagram. Focus this region and use the Left and Right arrow keys to step through gates."></div>
    <div id="proto-gate" class="status stage-narrate" aria-live="polite" hidden></div>
    <div id="proto-meter" class="meter-grid"></div>
    <div id="full-result" class="status" aria-live="polite">Verdict hidden until evaluation reaches the output wires.</div>
    <div class="callout">
      <strong>Constant rounds:</strong> garbling and OT happen up front, then Bob evaluates the whole circuit locally. Communication is one big batch — depth doesn't add round-trips. That's the signature property of garbled circuits.
    </div>`,
  );
}

function exhibit5(): string {
  return sectionTemplate(
    'ex5',
    'Exhibit 5 — Security model & the cost of privacy',
    `
    <div class="card-grid">
      <div class="card">
        <h3>What's guaranteed</h3>
        <ul>
          <li><strong>Semi-honest</strong> security: safe if both follow the protocol.</li>
          <li>Bob sees only labels + one output mapping → learns just the result.</li>
          <li>Point-and-permute hides which row corresponds to which inputs.</li>
        </ul>
      </div>
      <div class="card">
        <h3>What it doesn't cover (by default)</h3>
        <ul>
          <li><strong>Malicious</strong> parties need cut-and-choose or authenticated garbling — real overhead.</li>
          <li>A garbled circuit is <strong>single-use</strong>: reusing labels breaks privacy.</li>
          <li>&gt;2 parties → GMW / BGW / SPDZ territory.</li>
        </ul>
      </div>
    </div>
    <h3 style="margin-top:1rem;">Optimisations that made it practical</h3>
    <div class="card-grid">
      <div class="card"><strong>Free XOR</strong><p>Pick labels so every wire's pair differs by a global Δ. XOR gates become a local XOR of labels — zero ciphertext, zero crypto. This demo uses it.</p></div>
      <div class="card"><strong>Row reduction</strong><p>Fix one row to a known value and omit it: 4 → 3 ciphertexts per AND/OR.</p></div>
      <div class="card"><strong>Half Gates</strong><p>Zahur–Rosulek–Evans (2015): every AND gate costs just <strong>2</strong> ciphertexts — long the standard.</p></div>
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="MPC approach comparison">
    <table class="table" style="margin-top:0.8rem;">
      <caption class="sr-only">Comparison of MPC approaches</caption>
      <thead><tr><th scope="col">Property</th><th scope="col">Garbled Circuits</th><th scope="col">Secret-sharing MPC</th><th scope="col">FHE</th></tr></thead>
      <tbody>
        <tr><td>Best for</td><td>Boolean, 2-party</td><td>Arithmetic, multi-party</td><td>Outsourced compute</td></tr>
        <tr><td>Rounds</td><td>Constant (≈2)</td><td>O(circuit depth)</td><td>Constant</td></tr>
        <tr><td>Communication</td><td>O(circuit size)</td><td>O(parties × depth)</td><td>O(1) messages, big ciphertexts</td></tr>
        <tr><td>Compute cost</td><td>Moderate</td><td>Low per gate</td><td>Very high</td></tr>
        <tr><td>Maturity</td><td>Deployed</td><td>Deployed</td><td>Emerging</td></tr>
      </tbody>
    </table>
    </div>
    <div id="efficiency-live" class="status" aria-live="polite">Run Exhibit 4 to measure this circuit's real garbled-payload size and how many bytes Free XOR saved.</div>
    <h3 style="margin-top:1rem;">Watch the single-use rule break: a live label-reuse attack</h3>
    <p>Everything above says a garbled circuit must be <strong>single-use</strong>. Here's why, run for real. Alice garbles one AND gate with a secret input bit <em>a</em>. Then she (wrongly) reuses it, so Bob ends up holding <em>both</em> of his labels B⁰ <em>and</em> B¹. Two honest decryptions later, her "hidden" bit falls out — no cryptography is broken, only the protocol rule.</p>
    <div class="stepper" role="group" aria-label="Reuse attack controls">
      <button id="run-reuse" class="btn btn-primary" type="button">Garble a gate &amp; run the attack</button>
    </div>
    <div id="reuse-stage" class="status" aria-live="polite">Alice's bit is chosen at random and never sent. Run the attack and watch Bob compute it anyway.</div>
    ${quiz('s1', 'Why must a garbled circuit never be evaluated twice with the same labels?', [
      { label: 'It would be too slow', correct: false, explain: 'Speed isn\'t the issue — reuse is a security failure, not a performance one.' },
      { label: 'Reusing labels can leak input bits', correct: true, explain: 'Right. Seeing which rows decrypt across two runs lets the evaluator correlate labels to logical values. Each circuit is single-use.' },
      { label: 'The AES key expires', correct: false, explain: 'There\'s no expiry; the problem is correlation across reuse of the same wire labels.' },
    ])}`,
  );
}

function exhibit6(): string {
  return sectionTemplate(
    'ex6',
    'Exhibit 6 — Garbled circuits in production',
    `
    <div class="card-grid">
      <div class="card"><h3>Private Set Intersection</h3><p>Find shared contacts/measurements without revealing the rest. OT-extension-based PSI underlies private contact discovery at scale.</p></div>
      <div class="card"><h3>Secure ML inference</h3><p>Evaluate a model on private inputs for modest circuits; combined with secret sharing in mixed protocols for larger nets.</p></div>
      <div class="card"><h3>Sealed-bid auctions</h3><p>Reveal only the winner and clearing price; losing bids stay sealed.</p></div>
      <div class="card"><h3>Threshold signatures</h3><p>OT techniques from the GC line appear in threshold-ECDSA families such as GG20.</p></div>
    </div>
    <div class="family-tree" role="img" aria-label="MPC protocol family tree from Yao 1986 to ABY 2015" style="margin-top:0.8rem;">Yao's Garbled Circuits (1986) — general 2-party
├─ GMW (1987) — multi-party from OT
├─ BGW (1988) — information-theoretic MPC
├─ SPDZ (2012) — malicious-secure, dishonest majority
└─ ABY (2015) — mix Arithmetic / Boolean / Yao</div>
    <nav aria-label="Related demos" class="status" style="margin-top:0.8rem;">
      Continue across the Crypto-Lab suite:
      <ul>
        <li><a href="https://systemslibrarian.github.io/crypto-lab-ot-gate/" target="_blank" rel="noopener">OT Gate</a> — the 1-of-2 OT used here, in depth.</li>
        <li><a href="https://systemslibrarian.github.io/crypto-lab-silent-tally/" target="_blank" rel="noopener">Silent Tally</a> — additive secret-sharing MPC.</li>
        <li><a href="https://systemslibrarian.github.io/crypto-lab-oblivious-shelf/" target="_blank" rel="noopener">Oblivious Shelf</a> — private information retrieval.</li>
        <li><a href="https://systemslibrarian.github.io/crypto-compare/" target="_blank" rel="noopener">Crypto Compare</a> — the reference index.</li>
      </ul>
    </nav>`,
  );
}

function notesAndRefs(): string {
  return `
    <section class="section" aria-labelledby="notes-heading">
      <div class="section-head"><h2 id="notes-heading">Honest implementation notes</h2></div>
      <div class="section-body">
        <p>This demo runs <strong>real cryptography</strong> in your browser — but it is a teaching model. Where it simplifies, it says so:</p>
        <ul>
          <li><strong>Gate encryption.</strong> Each row is encrypted under a single key <code>H(A‖B‖gateId)</code> with AES-128-GCM, rather than the textbook double-encryption <code>Enc<sub>A</sub>(Enc<sub>B</sub>(out))</code>. Both bind a row to a pair of input labels; the hash form is closer to modern hash-based garbling and keeps the visual to one padlock per row.</li>
          <li><strong>GCM as the “did it open?” signal.</strong> The authentication tag is what makes a wrong-key decryption fail cleanly — handy for the “why only one row opens” view. Production garbling uses point-and-permute so it never trial-decrypts at all.</li>
          <li><strong>Free XOR</strong> is implemented for real (global Δ with forced-1 lsb); XOR gates cost zero ciphertext. Half Gates and row reduction are described, not implemented.</li>
          <li><strong>OT</strong> is genuine Chou–Orlandi on Curve25519 via <code>@noble/curves</code>. One standalone OT per input bit — no OT extension.</li>
          <li><strong>Security model is semi-honest.</strong> No cut-and-choose; don't guard real secrets with this code.</li>
          <li>The "God view" exists only because we control both parties here. In a real run, Bob has labels, never bits.</li>
        </ul>
        <h2 id="refs-heading" style="margin-top:1rem;">References</h2>
        <ul>
          <li>A. C. Yao, <em>How to Generate and Exchange Secrets</em>, FOCS 1986.</li>
          <li>M. Bellare, V. T. Hoang, P. Rogaway, <em>Foundations of Garbled Circuits</em>, CCS 2012.</li>
          <li>V. Kolesnikov, T. Schneider, <em>Improved Garbled Circuit: Free XOR Gates and Applications</em>, ICALP 2008.</li>
          <li>S. Zahur, M. Rosulek, D. Evans, <em>Two Halves Make a Whole (Half Gates)</em>, EUROCRYPT 2015.</li>
          <li>T. Chou, C. Orlandi, <em>The Simplest Protocol for Oblivious Transfer</em>, LATINCRYPT 2015.</li>
        </ul>
      </div>
    </section>`;
}

// ── AND gate stage rendering ─────────────────────────────────────────────

function renderAndStage(): void {
  const stage = maybe('#and-stage');
  if (!stage) return;
  const d = state.andDemo;
  if (!d) {
    stage.innerHTML = `<div class="empty-stage">Press <strong>Garble the gate</strong> to mint random wire labels and lock the truth table.</div>`;
    return;
  }

  const ev = state.andEval;
  const aBit = ev ? ev.aBit : null;
  const bBit = ev ? ev.bBit : null;
  const lit = !!(ev && ev.decryptOk);

  // Wire-label panel: the six labels Alice generated.
  const wires = `
    <div class="wire-panel">
      <div class="wire-col">
        <div class="wire-col-h">Wire A</div>
        ${labelChip('A⁰', bytesToHex(d.wireA.zero), { bit: 0, reveal: true, active: aBit === 0, dim: aBit === 1 })}
        ${labelChip('A¹', bytesToHex(d.wireA.one), { bit: 1, reveal: true, active: aBit === 1, dim: aBit === 0 })}
      </div>
      <div class="wire-col">
        <div class="wire-col-h">Wire B</div>
        ${labelChip('B⁰', bytesToHex(d.wireB.zero), { bit: 0, reveal: true, active: bBit === 0, dim: bBit === 1 })}
        ${labelChip('B¹', bytesToHex(d.wireB.one), { bit: 1, reveal: true, active: bBit === 1, dim: bBit === 0 })}
      </div>
      <div class="wire-col">
        <div class="wire-col-h">Wire C (output)</div>
        ${labelChip('C⁰', bytesToHex(d.wireOut.zero), { bit: 0, reveal: ev?.outputBit === 0 })}
        ${labelChip('C¹', bytesToHex(d.wireOut.one), { bit: 1, reveal: ev?.outputBit === 1 })}
      </div>
    </div>`;

  // Garbled table: four padlocked rows.
  const rows = d.rows
    .map((r) => {
      let lockState = 'locked';
      let icon = '🔒';
      let note = '';
      if (ev) {
        if (r.slot === ev.slot) {
          lockState = 'open';
          icon = '🔓';
          note = 'colour bits match → Bob opens this one';
        } else {
          lockState = state.andTrial ? 'dead' : 'dim';
          icon = '🔒';
          note = state.andTrial ? 'wrong key — GCM rejects' : '';
        }
      }
      const colourDots = `<span class="chip-colour colour-${r.selectBits[0]}">${r.selectBits[0]}</span><span class="chip-colour colour-${r.selectBits[1]}">${r.selectBits[1]}</span>`;
      return `<div class="lock-row lock-${lockState}" role="listitem">
        <span class="lock">${icon}</span>
        <span class="lock-slot">slot ${r.slot}</span>
        <span class="lock-colours" title="point-and-permute colour bits">${colourDots}</span>
        <span class="lock-ct">ct ${shortHex(r.cipherHex, 6, 4)}</span>
        ${lockState === 'open' && ev?.outputLabelHex ? `<span class="lock-out">→ ${shortHex(ev.outputLabelHex)}</span>` : ''}
        ${note ? `<span class="lock-note">${note}</span>` : ''}
      </div>`;
    })
    .join('');

  // Narration line that tracks the current step.
  let narrate = '<strong>Garbled.</strong> Four encrypted rows, shuffled by their colour bits. Pick A and B, then evaluate.';
  if (ev) {
    const out =
      ev.outputBit === null
        ? `an <em>opaque</em> output label <code>${shortHex(ev.outputLabelHex)}</code> — Bob can't read the bit yet`
        : `output bit <strong>${ev.outputBit}</strong> (after Alice reveals the C mapping)`;
    narrate = `Bob's labels are <strong>A${ev.aBit}</strong> and <strong>B${ev.bBit}</strong> with colour bits <strong>${ev.selectBits[0]}${ev.selectBits[1]}</strong> → row <strong>slot ${ev.slot}</strong>. He decrypts it and gets ${out}.`;
  }

  const trial = state.andTrial
    ? `<div class="trial-strip">${state.andTrial
        .map(
          (t) =>
            `<span class="trial-cell ${t.ok ? 'trial-ok' : 'trial-fail'}">slot ${t.slot}: ${t.ok ? 'opens ✓' : 'GCM rejects ✗'}</span>`,
        )
        .join('')}<span class="trial-caption">Trial-decrypting all four rows: exactly one authenticates. Point-and-permute lets Bob skip straight to it.</span></div>`
    : '';

  stage.innerHTML = `
    <div class="and-grid">
      <div class="and-diagram">${andGateSvg({ aBit, bBit, lit })}</div>
      ${wires}
    </div>
    <div class="lock-table" role="list" aria-label="Garbled AND table">${rows}</div>
    <div class="status stage-narrate" aria-live="polite">${narrate}</div>
    ${trial}`;
}

// ── Circuit stage rendering (Exhibit 4) ──────────────────────────────────

interface NodePos {
  wire: string;
  x: number;
  y: number;
  kind: string;
  gate?: boolean;
  type?: string;
}

function layoutPositions(layout: CircuitLayout): { nodes: Record<string, NodePos>; width: number; height: number } {
  const colW = 140;
  const rowH = 50;
  const padX = 60;
  const padY = 34;

  // group wire names by level
  const byLevel: Record<number, string[]> = {};
  for (const w of Object.values(layout.wires)) {
    (byLevel[w.level] ||= []).push(w.name);
  }
  // stable order within a level
  const order = (n: string) => {
    const pref = n[0];
    return `${'aboe'.indexOf(pref)}${n}`;
  };
  const nodes: Record<string, NodePos> = {};
  let maxRows = 0;
  const gateByOut: Record<string, { type: string }> = {};
  for (const g of layout.gates) gateByOut[g.out] = { type: g.type };

  for (const [lvlStr, names] of Object.entries(byLevel)) {
    const lvl = Number(lvlStr);
    names.sort((a, b) => order(a).localeCompare(order(b)));
    maxRows = Math.max(maxRows, names.length);
    names.forEach((name, i) => {
      nodes[name] = {
        wire: name,
        x: padX + lvl * colW,
        y: padY + i * rowH + (lvl % 2) * (rowH / 2),
        kind: layout.wires[name].kind,
        gate: !!gateByOut[name],
        type: gateByOut[name]?.type,
      };
    });
  }
  const width = padX * 2 + layout.depth * colW + 40;
  const height = padY * 2 + maxRows * rowH;
  return { nodes, width, height };
}

function renderCircuitStage(): void {
  const stage = maybe('#circuit-stage');
  if (!stage) return;
  const p = state.protocol;
  if (!p) {
    stage.innerHTML = `<div class="empty-stage">Garble the circuit to render it. Then step through evaluation gate by gate.</div>`;
    return;
  }
  const { nodes, width, height } = layoutPositions(p.layout);
  const evaluated = new Set(p.gateTrace.slice(0, state.protoStep).map((g) => g.out));
  const currentOut = state.protoStep > 0 ? p.gateTrace[state.protoStep - 1].out : null;
  const god = state.godView;

  const wireBitOf = (wire: string): 0 | 1 | undefined => {
    const isInput = ['aliceIn', 'bobIn', 'const'].includes(p.layout.wires[wire]?.kind);
    if (isInput || evaluated.has(wire)) return p.wireBits[wire];
    return undefined;
  };

  // edges
  const edges = p.layout.gates
    .map((g) => {
      const dst = nodes[g.out];
      return [g.inA, g.inB]
        .map((src) => {
          const s = nodes[src];
          if (!s || !dst) return '';
          const known = evaluated.has(g.out);
          const bit = wireBitOf(src);
          let stroke = 'var(--border)';
          let w = 2;
          if (known) {
            w = 3;
            stroke = god && bit !== undefined ? (bit === 1 ? 'var(--bit1)' : 'var(--bit0)') : 'var(--success)';
          }
          const midX = (s.x + 46 + dst.x) / 2;
          return `<path d="M ${s.x + 46} ${s.y} C ${midX} ${s.y}, ${midX} ${dst.y}, ${dst.x} ${dst.y}" fill="none" stroke="${stroke}" stroke-width="${w}" opacity="${known ? 1 : 0.5}"/>`;
        })
        .join('');
    })
    .join('');

  // nodes
  const nodeSvg = Object.values(nodes)
    .map((n) => {
      const bit = wireBitOf(n.wire);
      const isInput = !n.gate;
      const evaluatedNode = n.gate ? evaluated.has(n.wire) : true;
      const isOutput = p.layout.outputs.includes(n.wire);
      const cls = ['cnode'];
      if (isInput) cls.push(n.kind === 'aliceIn' ? 'cnode-alice' : n.kind === 'bobIn' ? 'cnode-bob' : 'cnode-const');
      else cls.push(n.type === 'XOR' ? 'cnode-xor' : 'cnode-gate');
      if (evaluatedNode) cls.push('cnode-on');
      if (isOutput) cls.push('cnode-out');
      if (n.wire === currentOut) cls.push('cnode-current');
      const label = isInput ? n.wire : n.type;
      const bitBadge =
        god && bit !== undefined
          ? `<text x="${n.x + 46}" y="${n.y - 11}" text-anchor="middle" class="cnode-bit bit-${bit}">${bit}</text>`
          : '';
      const sub = n.gate && !isInput ? `<text x="${n.x + 46}" y="${n.y + 14}" text-anchor="middle" class="cnode-sub">${n.wire}</text>` : '';
      return `<g class="${cls.join(' ')}">
        <rect x="${n.x}" y="${n.y - 13}" width="92" height="${sub ? 30 : 26}" rx="7"/>
        <text x="${n.x + 46}" y="${n.y + (sub ? -1 : 4)}" text-anchor="middle" class="cnode-label">${label}</text>
        ${sub}${bitBadge}
      </g>`;
    })
    .join('');

  stage.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="circuit-svg" role="img" aria-label="3-bit comparator circuit, ${state.protoStep} of ${p.gateCount} gates evaluated">
      ${edges}${nodeSvg}
    </svg>
    <div class="circuit-legend">
      <span class="legend-item"><span class="swatch cnode-alice"></span>Alice input</span>
      <span class="legend-item"><span class="swatch cnode-bob"></span>Bob input (via OT)</span>
      <span class="legend-item"><span class="swatch cnode-xor"></span>XOR — free</span>
      <span class="legend-item"><span class="swatch cnode-gate"></span>AND/OR — garbled</span>
      <span class="legend-item"><span class="swatch cnode-out"></span>output</span>
    </div>`;
}

function renderGateNarration(): void {
  const el = maybe('#proto-gate');
  if (!el) return;
  const p = state.protocol;
  el.hidden = !p;
  if (!p) {
    el.innerHTML = '';
    return;
  }
  if (state.protoStep === 0) {
    el.innerHTML = 'No gates evaluated yet. Press <strong>Step ▶</strong> — or focus the diagram and use the ← / → arrow keys.';
    return;
  }
  const g = p.gateTrace[state.protoStep - 1];
  const how = g.free
    ? 'Free XOR — Bob simply XORs the two input labels locally. No ciphertext, no decryption, zero cost.'
    : `point-and-permute — the two labels' colour bits name <strong>slot ${g.slot}</strong>; Bob decrypts that one row and now holds a new opaque label for <code>${esc(g.out)}</code>.`;
  const god = state.godView
    ? ` <span class="muted">(God view: secretly ${g.aBit} ${g.type} ${g.bBit} = ${g.outBit})</span>`
    : '';
  el.innerHTML = `Gate <strong>${state.protoStep}/${p.gateCount}</strong> — <strong>${g.type}(${esc(g.inA)}, ${esc(g.inB)}) → ${esc(g.out)}</strong> · ${how}${god}`;
}

function renderReuseStage(): void {
  const el = maybe('#reuse-stage');
  if (!el) return;
  const r = state.reuse;
  if (!r) return;
  const verdictLine = r.outputsEqual
    ? `The two output labels are <strong>identical</strong>. Since the rows encrypt C<sub>a∧0</sub> and C<sub>a∧1</sub>, equal outputs force a∧0 = a∧1 — only possible if <strong class="verdict">a = 0</strong>.`
    : `The two output labels <strong>differ</strong>. Since a∧0 = 0 always, a different label for a∧1 means it evaluated to 1 — so <strong class="verdict">a = 1</strong>.`;
  const correct = r.deducedAliceBit === r.aliceBit;
  const decryptLines = r.decrypts
    .map(
      (d) =>
        `<li>Reuse gave Bob label B${d.bobBit === 0 ? '⁰' : '¹'} — decrypting with (A, B${d.bobBit === 0 ? '⁰' : '¹'}) opens slot ${d.slot} → output label <code>${shortHex(d.outputLabelHex)}</code>.</li>`,
    )
    .join('');
  el.innerHTML = `
    <strong>Bob's attack transcript (same gate, reused labels)</strong>
    <ol class="tight">
      <li>Alice garbled a fresh AND gate; her secret bit rides inside label <code>${shortHex(r.aliceLabelHex)}</code> — unreadable on its own.</li>
      ${decryptLines}
      <li>${verdictLine}</li>
    </ol>
    <p style="margin:0.4rem 0 0;">Reveal check — Alice's actual bit was <strong>${r.aliceBit}</strong>; Bob's deduction is <strong class="${correct ? 'ok' : 'bad'}">${correct ? 'correct ✓' : 'wrong ✗'}</strong>. One reuse leaked one full input bit. This is why every evaluation needs fresh labels.</p>`;
}

function renderProtoMeter(): void {
  const meter = maybe('#proto-meter');
  const p = state.protocol;
  if (!meter || !p) {
    if (meter) meter.innerHTML = '';
    return;
  }
  const cells: Array<[string, string]> = [
    ['Gates', `${p.gateCount}`],
    ['AND/OR (garbled)', `${p.andOrCount}`],
    ['XOR (free)', `${p.xorCount}`],
    ['Oblivious transfers', `${p.otCount}`],
    ['Garbled payload', `${p.garbledBytes} B`],
    ['Saved by Free XOR', `≈ ${p.freeXorBytesSaved} B`],
  ];
  meter.innerHTML = cells
    .map(([k, v]) => `<div class="meter"><div class="meter-v">${v}</div><div class="meter-k">${k}</div></div>`)
    .join('');
}

function renderProtoChecklist(): void {
  const el = maybe('#proto-checklist');
  const p = state.protocol;
  if (!el || !p) return;
  const total = p.gateCount;
  const done = state.protoStep;
  const finished = done >= total;
  const items = [
    `✓ Circuit garbled — ${p.andOrCount} AND/OR tables encrypted, ${p.xorCount} XOR gates free`,
    `✓ Alice's input labels sent for bits ${p.aliceBits.join('')}`,
    `✓ ${p.otCount} OTs delivered Bob's labels for bits ${p.bobBits.join('')} (Alice learns nothing)`,
    finished
      ? `✓ Evaluated all ${total} gates → output labels for <code>gt</code>, <code>eq</code>`
      : `▷ Evaluating: ${done} / ${total} gates`,
  ];
  el.innerHTML = `<ol class="checklist">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
}

function renderProtoResult(): void {
  const el = maybe('#full-result');
  const p = state.protocol;
  if (!el || !p) return;
  if (state.protoStep >= p.gateCount) {
    el.innerHTML = `Output mapping revealed → <strong class="verdict">${p.output}</strong>. Both parties learn only this; Alice never saw Bob's ${p.bobValue}, Bob never saw Alice's ${p.aliceValue}.`;
  } else {
    el.innerHTML = `Evaluation in progress — output wires <code>gt</code>/<code>eq</code> still hold opaque labels.`;
  }
}

function renderEfficiency(): void {
  const el = maybe('#efficiency-live');
  const p = state.protocol;
  if (!el || !p) return;
  el.innerHTML = `Measured on the last run: <strong>${p.garbledBytes} bytes</strong> of garbled tables for ${p.andOrCount} AND/OR gates, with ${p.xorCount} XOR gates contributing <strong>0 bytes</strong> (Free XOR saved ≈ ${p.freeXorBytesSaved} bytes vs. classic 4-row garbling).`;
}

function refreshProtocol(): void {
  renderCircuitStage();
  renderGateNarration();
  renderProtoChecklist();
  renderProtoMeter();
  renderProtoResult();
  renderEfficiency();
  const stepBtn = maybe<HTMLButtonElement>('#proto-step');
  const backBtn = maybe<HTMLButtonElement>('#proto-back');
  if (stepBtn && backBtn && state.protocol) {
    const atEnd = state.protoStep >= state.protocol.gateCount;
    const atStart = state.protoStep <= 0;
    // Hand focus to the sibling before disabling, or the browser drops it to <body>.
    if (atEnd && document.activeElement === stepBtn) backBtn.focus();
    if (atStart && document.activeElement === backBtn) stepBtn.focus();
    stepBtn.disabled = atEnd;
    backBtn.disabled = atStart;
  }
}

// ── Theme ────────────────────────────────────────────────────────────────

function setThemeButton(theme: 'dark' | 'light'): void {
  const btn = q<HTMLButtonElement>('#theme-toggle');
  btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

function persistTheme(theme: 'dark' | 'light'): void {
  // localStorage can throw in sandboxed iframes / private mode — degrade gracefully.
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* no-op: theme just won't persist across reloads */
  }
}

function setupThemeToggle(): void {
  const btn = q<HTMLButtonElement>('#theme-toggle');
  const initial = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setThemeButton(initial);
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next: 'dark' | 'light' = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    persistTheme(next);
    setThemeButton(next);
  });
}

// ── Events ───────────────────────────────────────────────────────────────

async function withBusy(btn: HTMLButtonElement, label: string, fn: () => Promise<void>): Promise<void> {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = label;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = orig;
  }
}

function wireEvents(): void {
  document.addEventListener('click', (e) => handleQuizClick(e.target as HTMLElement));

  // Exhibit 1
  const alice = q<HTMLInputElement>('#alice-wealth');
  const bob = q<HTMLInputElement>('#bob-wealth');
  alice.addEventListener('input', () => (q('#alice-wealth-val').textContent = formatMoney(Number.parseInt(alice.value, 10))));
  bob.addEventListener('input', () => (q('#bob-wealth-val').textContent = formatMoney(Number.parseInt(bob.value, 10))));

  q<HTMLButtonElement>('#solve-millionaire').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Running…', async () => {
      const a = Number.parseInt(alice.value, 10);
      const b = Number.parseInt(bob.value, 10);
      const a3 = Math.max(1, Math.min(7, Math.round((a / 100) * 7)));
      const b3 = Math.max(1, Math.min(7, Math.round((b / 100) * 7)));
      const run = await runMillionaireProtocol3Bit(a3, b3);
      q('#millionaire-result').innerHTML = `Verdict from the garbled circuit: <strong class="verdict">${run.output}</strong>.<br>
        <span class="muted">Inputs quantised to 3 bits for the live circuit: Alice ${a} → ${a3}, Bob ${b} → ${b3}. Explore the gate-by-gate run in Exhibit 4.</span>`;
    }),
  );

  // Exhibit 2
  q<HTMLButtonElement>('#garble-and').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Garbling…', async () => {
      state.andDemo = await garbleAndGateDemo();
      state.andEval = null;
      state.andTrial = null;
      renderAndStage();
    }),
  );

  const doEval = async (reveal: boolean) => {
    if (!state.andDemo) {
      renderAndStage();
      return;
    }
    const aBit = Number.parseInt(q<HTMLSelectElement>('#and-a').value, 10) as 0 | 1;
    const bBit = Number.parseInt(q<HTMLSelectElement>('#and-b').value, 10) as 0 | 1;
    state.andEval = await evaluateAndGateDemo(state.andDemo, aBit, bBit, reveal);
    state.andTrial = null;
    renderAndStage();
  };
  q<HTMLButtonElement>('#eval-and').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Evaluating…', () => doEval(false)),
  );
  q<HTMLButtonElement>('#reveal-and').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Revealing…', () => doEval(true)),
  );
  q<HTMLButtonElement>('#trial-and').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Trying all rows…', async () => {
      if (!state.andDemo) return;
      const aBit = Number.parseInt(q<HTMLSelectElement>('#and-a').value, 10) as 0 | 1;
      const bBit = Number.parseInt(q<HTMLSelectElement>('#and-b').value, 10) as 0 | 1;
      if (!state.andEval) state.andEval = await evaluateAndGateDemo(state.andDemo, aBit, bBit, false);
      state.andTrial = await trialDecryptAll(state.andDemo, aBit, bBit);
      renderAndStage();
    }),
  );

  // Exhibit 3
  q<HTMLButtonElement>('#run-ot').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Running…', async () => {
      const choice = Number.parseInt(q<HTMLSelectElement>('#ot-choice').value, 10) as 0 | 1;
      const m0 = crypto.getRandomValues(new Uint8Array(16));
      const m1 = crypto.getRandomValues(new Uint8Array(16));
      const trace = await runInputLabelOT(m0, m1, choice);
      const openBody = (hex: string) => `<div class="ot-box-body lock-open">🔓 ${shortHex(hex)}</div>`;
      const shutBody = `<div class="ot-box-body lock">🔒 stays sealed — Bob can't derive this key</div>`;
      q('#box0').innerHTML = `<div class="ot-box-top">Wire-label for bit&nbsp;0</div>${choice === 0 ? openBody(trace.receivedHex) : shutBody}`;
      q('#box0').className = `ot-box ${choice === 0 ? 'ot-box-open' : ''}`;
      q('#box1').innerHTML = `<div class="ot-box-top">Wire-label for bit&nbsp;1</div>${choice === 1 ? openBody(trace.receivedHex) : shutBody}`;
      q('#box1').className = `ot-box ${choice === 1 ? 'ot-box-open' : ''}`;
      q('#ot-steps').innerHTML = `
        <strong>What happened</strong>
        <ol class="tight">
          <li>Bob sent <code>B = ${shortHex(trace.BHex)}</code> — folds in his choice ${choice}, but looks identical to Alice either way.</li>
          <li>Alice replied with two ciphertexts keyed to <code>A = ${shortHex(trace.AHex)}</code>.</li>
          <li>Bob derived one key and recovered <strong>label for bit ${choice}</strong> = <code>${shortHex(trace.receivedHex)}</code>.</li>
          <li>Alice never learns <em>which</em> box opened.</li>
        </ol>`;
    }),
  );

  // Exhibit 4
  const fa = q<HTMLInputElement>('#full-alice');
  const fb = q<HTMLInputElement>('#full-bob');
  fa.addEventListener('input', () => (q('#full-alice-val').textContent = fa.value));
  fb.addEventListener('input', () => (q('#full-bob-val').textContent = fb.value));

  const setStepperEnabled = (on: boolean) => {
    (['#proto-back', '#proto-step', '#proto-auto', '#proto-reset'] as const).forEach((id) => {
      const b = maybe<HTMLButtonElement>(id);
      if (b) b.disabled = !on;
    });
  };

  q<HTMLButtonElement>('#run-full').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Garbling…', async () => {
      stopAuto();
      // Park the old run while re-garbling so Step/arrow keys can't mutate a
      // protocol that is about to be replaced.
      state.protocol = null;
      setStepperEnabled(false);
      state.protocol = await runMillionaireProtocol3Bit(Number.parseInt(fa.value, 10), Number.parseInt(fb.value, 10));
      state.protoStep = 0;
      setStepperEnabled(true);
      refreshProtocol();
    }),
  );

  const stepBy = (dir: 1 | -1): boolean => {
    if (!state.protocol) return false;
    const next = Math.max(0, Math.min(state.protocol.gateCount, state.protoStep + dir));
    if (next === state.protoStep) return false;
    stopAuto();
    state.protoStep = next;
    refreshProtocol();
    return true;
  };

  q<HTMLButtonElement>('#proto-step').addEventListener('click', () => stepBy(1));
  q<HTMLButtonElement>('#proto-back').addEventListener('click', () => stepBy(-1));

  q<HTMLElement>('#circuit-stage').addEventListener('keydown', (e) => {
    // Leave modified keys (Alt+← is browser Back) and non-arrows alone.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    // Only claim the key when it actually steps; otherwise (no circuit yet,
    // or at either end) the region keeps its native horizontal scrolling.
    if (stepBy(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault();
  });

  q<HTMLButtonElement>('#proto-auto').addEventListener('click', () => {
    if (!state.protocol) return;
    if (state.autoTimer !== null) {
      stopAuto();
      return;
    }
    if (state.protoStep >= state.protocol.gateCount) state.protoStep = 0;
    // Auto-play rewrites the narration every ~half second; silence the live
    // region while it runs so screen readers aren't flooded. stopAuto restores it.
    maybe('#proto-gate')?.setAttribute('aria-live', 'off');
    const tick = () => {
      if (!state.protocol || state.protoStep >= state.protocol.gateCount) {
        stopAuto();
        return;
      }
      state.protoStep += 1;
      refreshProtocol();
      state.autoTimer = window.setTimeout(tick, reduceMotion ? 0 : 480);
    };
    q<HTMLButtonElement>('#proto-auto').textContent = 'Pause';
    tick();
  });

  q<HTMLButtonElement>('#proto-reset').addEventListener('click', () => {
    stopAuto();
    state.protoStep = 0;
    refreshProtocol();
  });

  q<HTMLInputElement>('#god-view').addEventListener('change', (e) => {
    state.godView = (e.currentTarget as HTMLInputElement).checked;
    refreshProtocol();
  });

  // Exhibit 5 — label-reuse attack
  q<HTMLButtonElement>('#run-reuse').addEventListener('click', (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, 'Attacking…', async () => {
      const demo = await garbleAndGateDemo();
      state.reuse = await runLabelReuseAttack(demo, randomBit());
      renderReuseStage();
    }),
  );
}

function stopAuto(): void {
  if (state.autoTimer !== null) {
    window.clearTimeout(state.autoTimer);
    state.autoTimer = null;
  }
  const b = maybe<HTMLButtonElement>('#proto-auto');
  if (b) b.textContent = 'Auto-play';
  maybe('#proto-gate')?.setAttribute('aria-live', 'polite');
}

render();
