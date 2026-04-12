import './style.css';
import {
  bytesToHex,
  evaluateAndGateDemo,
  garbleAndGateDemo,
  runInputLabelOT,
  runMillionaireProtocol3Bit,
  type AndGateDemo,
  type MillionaireProtocolResult,
} from './yao';

interface AppState {
  andDemo: AndGateDemo | null;
  protocolRun: MillionaireProtocolResult | null;
}

const state: AppState = {
  andDemo: null,
  protocolRun: null,
};

function q<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Missing element: ${selector}`);
  }
  return el as T;
}

function setThemeButton(theme: 'dark' | 'light'): void {
  const btn = q<HTMLButtonElement>('#theme-toggle');
  btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

function setupThemeToggle(): void {
  const btn = q<HTMLButtonElement>('#theme-toggle');

  const initial = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setThemeButton(initial);

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next: 'dark' | 'light' = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setThemeButton(next);
  });
}

function sectionTemplate(id: string, title: string, body: string): string {
  const headingId = `${id}-heading`;
  return `
    <section class="section" id="${id}" aria-labelledby="${headingId}">
      <div class="section-head"><h2 id="${headingId}">${title}</h2></div>
      <div class="section-body">${body}</div>
    </section>
  `;
}

function formatMoney(value: number): string {
  return `$${value}M`;
}

function render(): void {
  const app = q('#app');
  app.innerHTML = `
    <a href="#ex1" class="skip-link">Skip to main content</a>
    <header class="site-header" role="banner">
      <div class="container header-grid">
        <div>
          <h1>Garbled Gate</h1>
          <p class="subtitle">Yao's Garbled Circuits in the browser: gate-by-gate garbling, OT inputs, millionaire comparison.</p>
        </div>
      </div>
      <div class="container" style="position:relative;">
        <button id="theme-toggle" class="theme-toggle" type="button"></button>
      </div>
    </header>

    <main role="main" id="main-content">
      <div class="container">
        ${sectionTemplate(
          'ex1',
          'Exhibit 1 - The Millionaire\'s Problem',
          `
          <p>Alice has private wealth A and Bob has private wealth B. They need to decide whether A > B without revealing either wealth value. This is Yao's Millionaire's Problem (1982), the motivating case for secure two-party computation.</p>
          <div class="card-grid">
            <div class="card">
              <h3>The Problem</h3>
              <ul>
                <li>A trusted third party would solve this instantly, but none exists.</li>
                <li>Alice cannot send A directly to Bob.</li>
                <li>Bob cannot send B directly to Alice.</li>
                <li>Standard encryption alone does not solve private comparison.</li>
              </ul>
            </div>
            <div class="card">
              <h3>GC Solution Preview</h3>
              <ul>
                <li>Alice garbles a comparison circuit for A > B.</li>
                <li>Bob receives his input labels via Oblivious Transfer.</li>
                <li>Bob evaluates and learns only output.</li>
                <li>Alice learns nothing about Bob's input.</li>
              </ul>
            </div>
          </div>
          <div class="row" style="margin-top:0.8rem;">
            <div style="flex:1; min-width:210px;">
              <label for="alice-wealth">Alice wealth: <output id="alice-wealth-val" for="alice-wealth">${formatMoney(40)}</output></label>
              <input id="alice-wealth" type="range" min="1" max="100" value="40" aria-describedby="alice-wealth-val" />
            </div>
            <div style="flex:1; min-width:210px;">
              <label for="bob-wealth">Bob wealth: <output id="bob-wealth-val" for="bob-wealth">${formatMoney(35)}</output></label>
              <input id="bob-wealth" type="range" min="1" max="100" value="35" aria-describedby="bob-wealth-val" />
            </div>
            <div style="flex:1; min-width:220px;">
              <button id="solve-millionaire" class="btn" type="button">Solve with Garbled Circuits</button>
            </div>
          </div>
          <div id="millionaire-result" class="status" aria-live="polite">Protocol not run yet.</div>
          <div class="callout">
            <strong>Why this matters:</strong> this exact pattern underlies private set intersection, private auctions, secure voting, and private ML inference: compute function output without exposing raw inputs.
          </div>
          `,
        )}

        ${sectionTemplate(
          'ex2',
          'Exhibit 2 - What a Garbled Circuit Is (AND gate demo)',
          `
          <p>This interactive panel uses a single AND gate as the building block. Labels are real random 128-bit values from <code>crypto.getRandomValues</code>. Rows are encrypted with WebCrypto AES-128-GCM and displayed in shuffled order.</p>
          <div class="table-wrap" tabindex="0" role="region" aria-label="AND gate truth table">
          <table class="table">
            <caption class="sr-only">AND gate truth table</caption>
            <thead><tr><th scope="col">A</th><th scope="col">B</th><th scope="col">AND(A,B)</th></tr></thead>
            <tbody>
              <tr><td>0</td><td>0</td><td>0</td></tr>
              <tr><td>0</td><td>1</td><td>0</td></tr>
              <tr><td>1</td><td>0</td><td>0</td></tr>
              <tr><td>1</td><td>1</td><td>1</td></tr>
            </tbody>
          </table>
          </div>
          <div class="row" style="margin-top:0.8rem;">
            <div style="flex:1; min-width:220px;"><button id="garble-and" class="btn" type="button">Garble</button></div>
            <div style="flex:1; min-width:140px;">
              <label for="and-a">A bit</label>
              <select id="and-a"><option value="0">0</option><option value="1">1</option></select>
            </div>
            <div style="flex:1; min-width:140px;">
              <label for="and-b">B bit</label>
              <select id="and-b"><option value="0">0</option><option value="1">1</option></select>
            </div>
            <div style="flex:1; min-width:170px;"><button id="eval-and" class="btn" type="button">Evaluate</button></div>
            <div style="flex:1; min-width:170px;"><button id="reveal-and" class="btn" type="button">Reveal mapping</button></div>
          </div>
          <div id="and-labels" class="status" aria-live="polite">Press Garble to generate wire labels.</div>
          <div id="and-table" class="status" aria-live="polite">Garbled table not generated.</div>
          <div id="and-eval" class="status" aria-live="polite">Evaluation pending.</div>
          <div class="callout">
            <strong>What Bob learns:</strong> output label and final bit after mapping reveal. Bob does not learn unused labels or the opposite output label.
          </div>
          `,
        )}

        ${sectionTemplate(
          'ex3',
          'Exhibit 3 - Oblivious Transfer for Input Wires',
          `
          <p>OT delivers exactly one Bob input-wire label to Bob while hiding Bob's bit from Alice. This is the same 1-of-2 OT setting used in <a href="https://systemslibrarian.github.io/crypto-lab-ot-gate/" target="_blank" rel="noopener">OT Gate</a>, grounded in Chou-Orlandi (LATINCRYPT 2015).</p>
          <div class="row">
            <div style="flex:1; min-width:200px;">
              <label for="ot-choice">Bob choice bit</label>
              <select id="ot-choice"><option value="0">0</option><option value="1">1</option></select>
            </div>
            <div style="flex:1; min-width:220px;"><button id="run-ot" class="btn" type="button">Run OT</button></div>
          </div>
          <div id="ot-inputs" class="status" aria-live="polite">Messages W_B0 / W_B1 will appear after run.</div>
          <div id="ot-steps" class="status" aria-live="polite">No OT run yet.</div>
          <div class="card-grid" style="margin-top:0.8rem;">
            <div class="card"><strong>Locked box 0:</strong><div id="box0" aria-live="polite">Locked</div></div>
            <div class="card"><strong>Locked box 1:</strong><div id="box1" aria-live="polite">Locked</div></div>
          </div>
          <div class="callout">
            <strong>Per-input-bit OT:</strong> one OT per Bob input bit. A 7-bit input uses 7 OTs. OT count grows linearly with Bob's input length.
          </div>
          `,
        )}

        ${sectionTemplate(
          'ex4',
          'Exhibit 4 - Full Protocol End to End (simplified 3-bit)',
          `
          <p><strong>Simplified 3-bit comparison:</strong> this panel demonstrates the exact protocol structure used for larger comparisons, with fewer gates for browser clarity.</p>
          <div class="row">
            <div style="flex:1; min-width:190px;">
              <label for="full-alice">Alice value (1-7)</label>
              <input id="full-alice" type="range" min="1" max="7" value="5" aria-valuemin="1" aria-valuemax="7" aria-valuenow="5" aria-describedby="full-alice-val" />
              <output id="full-alice-val" for="full-alice">5</output>
            </div>
            <div style="flex:1; min-width:190px;">
              <label for="full-bob">Bob value (1-7)</label>
              <input id="full-bob" type="range" min="1" max="7" value="3" aria-valuemin="1" aria-valuemax="7" aria-valuenow="3" aria-describedby="full-bob-val" />
              <output id="full-bob-val" for="full-bob">3</output>
            </div>
            <div style="flex:1; min-width:220px;"><button id="run-full" class="btn" type="button">Run Full Protocol</button></div>
          </div>
          <div id="full-steps" class="status" aria-live="polite">Run to see all seven protocol steps.</div>
          <div id="full-result" class="status" aria-live="polite">Final output hidden.</div>
          <div class="callout">
            <strong>Learning outcome:</strong> both parties learn only who is richer (or equal), not each other's actual value.
          </div>
          `,
        )}

        ${sectionTemplate(
          'ex5',
          'Exhibit 5 - Security and Efficiency',
          `
          <div class="card-grid">
            <div class="card">
              <h3>Security model</h3>
              <ul>
                <li>Semi-honest security for baseline Yao protocol.</li>
                <li>Malicious security needs cut-and-choose and authenticated checks.</li>
                <li>Point-and-permute hides gate-row semantics.</li>
                <li>Free XOR removes ciphertext cost for XOR gates.</li>
              </ul>
            </div>
            <div class="card">
              <h3>Efficiency</h3>
              <ul>
                <li>Classic table: 4 ciphertext rows per AND/OR gate.</li>
                <li>Half Gates can reduce AND cost to 2 ciphertexts.</li>
                <li>Row reduction can reduce 4 to 3 rows.</li>
                <li>OT count = Bob input bits.</li>
              </ul>
            </div>
          </div>
          <div class="table-wrap" tabindex="0" role="region" aria-label="MPC protocol comparison table">
          <table class="table" style="margin-top:0.8rem;">
            <caption class="sr-only">Comparison of MPC approaches</caption>
            <thead>
              <tr><th scope="col">Property</th><th scope="col">Garbled Circuits</th><th scope="col">Secret Sharing MPC</th><th scope="col">FHE-based MPC</th></tr>
            </thead>
            <tbody>
              <tr><td>Function type</td><td>Any boolean</td><td>Any arithmetic</td><td>Any</td></tr>
              <tr><td>Rounds</td><td>Constant (2)</td><td>O(depth)</td><td>Constant</td></tr>
              <tr><td>Communication</td><td>O(circuit size)</td><td>O(parties x depth)</td><td>O(1) messages</td></tr>
              <tr><td>Computational cost</td><td>Moderate</td><td>Low per gate</td><td>Very high</td></tr>
              <tr><td>Semi-honest secure</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
              <tr><td>Practical for</td><td>2-party</td><td>Multi-party</td><td>Research</td></tr>
            </tbody>
          </table>
          </div>
          <div id="efficiency-live" class="status" aria-live="polite">Run Exhibit 4 to compute actual byte counts for this demo circuit.</div>
          <div class="callout">
            <strong>Why this matters:</strong> Garbled circuits are the longest-running general MPC paradigm, with modern optimizations enabling practical deployments.
          </div>
          `,
        )}

        ${sectionTemplate(
          'ex6',
          'Exhibit 6 - Garbled Circuits in Production',
          `
          <div class="card-grid">
            <div class="card"><h3>Private Set Intersection</h3><p>PSI finds set overlap without revealing non-overlapping elements. OT extension underpins practical PSI systems for private contact discovery and measurement.</p></div>
            <div class="card"><h3>Secure ML Inference</h3><p>GC evaluates private-model inference for small circuits. Practical today for smaller models, not yet for large transformer-scale circuits.</p></div>
            <div class="card"><h3>Private Auctions</h3><p>Sealed-bid workflows can reveal only winner and final price while hiding losing bids.</p></div>
            <div class="card"><h3>Threshold Cryptography</h3><p>OT-derived techniques from GC literature appear in threshold ECDSA families such as GG20.</p></div>
          </div>
          <div class="family-tree" role="img" aria-label="MPC protocol family tree showing lineage from Yao 1986 to ABY 2015" style="margin-top:0.8rem;">Yao's Garbled Circuits (1986) - general 2-party
|- GMW protocol (1987) - multi-party extension
|- BGW protocol (1988) - information-theoretic MPC
|- SPDZ (2012) - malicious-secure multi-party
|- ABY (2015) - mixed Arithmetic/Boolean/Yao protocols</div>
          <nav aria-label="Cross-demo links" class="status" style="margin-top:0.8rem;">
            Cross-demo links:
            <ul>
              <li><a href="https://systemslibrarian.github.io/crypto-lab-ot-gate/" target="_blank" rel="noopener">OT Gate (1-of-2 OT)</a></li>
              <li><a href="https://systemslibrarian.github.io/crypto-lab-silent-tally/" target="_blank" rel="noopener">Silent Tally (additive MPC)</a></li>
              <li><a href="https://systemslibrarian.github.io/crypto-lab-oblivious-shelf/" target="_blank" rel="noopener">Oblivious Shelf (PIR)</a></li>
              <li><a href="https://systemslibrarian.github.io/crypto-compare/" target="_blank" rel="noopener">Crypto Compare reference</a></li>
            </ul>
          </nav>
          `,
        )}

        <section class="section" aria-labelledby="refs-heading">
          <div class="section-head"><h2 id="refs-heading">References</h2></div>
          <div class="section-body">
            <ul>
              <li>Andrew C. Yao, How to Generate and Exchange Secrets, FOCS 1986.</li>
              <li>Mihir Bellare, Viet Tung Hoang, Phillip Rogaway, Foundations of Garbled Circuits, CCS 2012.</li>
              <li>Tung Chou, Claudio Orlandi, The Simplest Protocol for Oblivious Transfer, LATINCRYPT 2015.</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  `;

  wireEvents();
  setupThemeToggle();
}

function wireEvents(): void {
  const alice = q<HTMLInputElement>('#alice-wealth');
  const bob = q<HTMLInputElement>('#bob-wealth');
  alice.addEventListener('input', () => {
    q('#alice-wealth-val').textContent = formatMoney(Number.parseInt(alice.value, 10));
  });
  bob.addEventListener('input', () => {
    q('#bob-wealth-val').textContent = formatMoney(Number.parseInt(bob.value, 10));
  });

  q<HTMLButtonElement>('#solve-millionaire').addEventListener('click', async () => {
    const btn = q<HTMLButtonElement>('#solve-millionaire');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Running…';
    try {
    const a = Number.parseInt(alice.value, 10);
    const b = Number.parseInt(bob.value, 10);

    const a3 = Math.max(1, Math.min(7, Math.round((a / 100) * 7)));
    const b3 = Math.max(1, Math.min(7, Math.round((b / 100) * 7)));
    const run = await runMillionaireProtocol3Bit(a3, b3);
    state.protocolRun = run;

    q('#millionaire-result').innerHTML = `Final public output (from garbled circuit): <strong>${run.output}</strong>.<br>Alice's 3-bit value=${a3}, Bob's 3-bit value=${b3} (quantized from ${a} and ${b}).`;
    q('#full-steps').innerHTML = `<ol>${run.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
    q('#full-result').innerHTML = `Protocol output: <strong>${run.output}</strong>.`;
    q('#efficiency-live').innerHTML = `Measured in this run: ${run.gateCount} total gates (${run.andOrCount} AND/OR, ${run.xorCount} XOR), ${run.otCount} OTs, garbled payload ${run.garbledBytes} bytes.`;
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Solve with Garbled Circuits';
    }
  });

  q<HTMLButtonElement>('#garble-and').addEventListener('click', async () => {
    const btn = q<HTMLButtonElement>('#garble-and');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Garbling…';
    try {
    state.andDemo = await garbleAndGateDemo();
    const d = state.andDemo;
    q('#and-labels').innerHTML = `
      <strong>Step 1 labels</strong><br>
      A0=${bytesToHex(d.wireA.zero)}<br>
      A1=${bytesToHex(d.wireA.one)}<br>
      B0=${bytesToHex(d.wireB.zero)}<br>
      B1=${bytesToHex(d.wireB.one)}<br>
      C0=${bytesToHex(d.wireOut.zero)}<br>
      C1=${bytesToHex(d.wireOut.one)}
    `;
    q('#and-table').innerHTML = `
      <strong>Step 2 garbled table (4 encrypted rows, shuffled)</strong><br>
      ${d.shuffledRows
        .map(
          (r, idx) =>
            `Row ${idx + 1}: id=${r.rowId} iv=${r.ivHex.slice(0, 18)}... ct=${r.cipherHex.slice(0, 24)}...`,
        )
        .join('<br>')}
    `;
    q('#and-eval').textContent = 'Ready for evaluation.';
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Garble';
    }
  });

  q<HTMLButtonElement>('#eval-and').addEventListener('click', async () => {
    if (!state.andDemo) {
      q('#and-eval').textContent = 'Garble first.';
      return;
    }
    const evalBtn = q<HTMLButtonElement>('#eval-and');
    evalBtn.disabled = true;
    evalBtn.setAttribute('aria-busy', 'true');
    evalBtn.textContent = 'Evaluating…';
    try {
      const aBit = Number.parseInt(q<HTMLSelectElement>('#and-a').value, 10) as 0 | 1;
      const bBit = Number.parseInt(q<HTMLSelectElement>('#and-b').value, 10) as 0 | 1;
      const evalOut = await evaluateAndGateDemo(state.andDemo, aBit, bBit, false);
      q('#and-eval').innerHTML = `
        <strong>Step 5 evaluation</strong><br>
        Attempts: ${evalOut.attempted.map((a) => `${a.rowId}:${a.success ? 'ok' : 'fail'}`).join(', ')}<br>
        Successful row: ${evalOut.successfulRowId ?? 'none'}<br>
        Output label: ${evalOut.outputLabelHex || 'none'}
      `;
    } finally {
      evalBtn.disabled = false;
      evalBtn.removeAttribute('aria-busy');
      evalBtn.textContent = 'Evaluate';
    }
  });

  q<HTMLButtonElement>('#reveal-and').addEventListener('click', async () => {
    if (!state.andDemo) {
      q('#and-eval').textContent = 'Garble first.';
      return;
    }
    const revBtn = q<HTMLButtonElement>('#reveal-and');
    revBtn.disabled = true;
    revBtn.setAttribute('aria-busy', 'true');
    revBtn.textContent = 'Revealing…';
    try {
      const aBit = Number.parseInt(q<HTMLSelectElement>('#and-a').value, 10) as 0 | 1;
      const bBit = Number.parseInt(q<HTMLSelectElement>('#and-b').value, 10) as 0 | 1;
      const evalOut = await evaluateAndGateDemo(state.andDemo, aBit, bBit, true);
      const bitTxt = evalOut.outputBit === null ? 'undetermined' : String(evalOut.outputBit);
      q('#and-eval').innerHTML = `${q('#and-eval').innerHTML}<br><strong>Reveal mapping:</strong> output bit = ${bitTxt}`;
    } finally {
      revBtn.disabled = false;
      revBtn.removeAttribute('aria-busy');
      revBtn.textContent = 'Reveal mapping';
    }
  });

  q<HTMLButtonElement>('#run-ot').addEventListener('click', async () => {
    const otBtn = q<HTMLButtonElement>('#run-ot');
    otBtn.disabled = true;
    otBtn.setAttribute('aria-busy', 'true');
    otBtn.textContent = 'Running…';
    try {
    const choice = Number.parseInt(q<HTMLSelectElement>('#ot-choice').value, 10) as 0 | 1;
    const m0 = crypto.getRandomValues(new Uint8Array(16));
    const m1 = crypto.getRandomValues(new Uint8Array(16));
    const trace = await runInputLabelOT(m0, m1, choice);

    q('#ot-inputs').innerHTML = `Alice labels (messages):<br>W_B0=${bytesToHex(m0)}<br>W_B1=${bytesToHex(m1)}`;
    q('#ot-steps').innerHTML = `
      1) Bob creates ephemeral keypair and sends B-variant derived from choice bit.<br>
      2) Alice computes two ciphertexts using A and B.<br>
      3) Bob derives one key and decrypts one message.<br>
      4) Bob received W_B${choice}=${trace.receivedHex}. Alice learns nothing about choice.<br>
      A=${trace.AHex.slice(0, 24)}... B=${trace.BHex.slice(0, 24)}...
    `;

    q('#box0').innerHTML = choice === 0 ? `<span class="ok">Opened: ${trace.receivedHex.slice(0, 20)}...</span>` : '<span class="bad">Remains locked</span>';
    q('#box1').innerHTML = choice === 1 ? `<span class="ok">Opened: ${trace.receivedHex.slice(0, 20)}...</span>` : '<span class="bad">Remains locked</span>';
    } finally {
      otBtn.disabled = false;
      otBtn.removeAttribute('aria-busy');
      otBtn.textContent = 'Run OT';
    }
  });

  const fullAlice = q<HTMLInputElement>('#full-alice');
  const fullBob = q<HTMLInputElement>('#full-bob');
  fullAlice.addEventListener('input', () => {
    q('#full-alice-val').textContent = fullAlice.value;
    fullAlice.setAttribute('aria-valuenow', fullAlice.value);
  });
  fullBob.addEventListener('input', () => {
    q('#full-bob-val').textContent = fullBob.value;
    fullBob.setAttribute('aria-valuenow', fullBob.value);
  });

  q<HTMLButtonElement>('#run-full').addEventListener('click', async () => {
    const fullBtn = q<HTMLButtonElement>('#run-full');
    fullBtn.disabled = true;
    fullBtn.setAttribute('aria-busy', 'true');
    fullBtn.textContent = 'Running…';
    try {
    const run = await runMillionaireProtocol3Bit(Number.parseInt(fullAlice.value, 10), Number.parseInt(fullBob.value, 10));
    state.protocolRun = run;
    q('#full-steps').innerHTML = `<ol>${run.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
    q('#full-result').innerHTML = `Final output: <strong>${run.output}</strong>. Alice and Bob learn output only.`;
    q('#efficiency-live').innerHTML = `Measured in this run: ${run.gateCount} total gates (${run.andOrCount} AND/OR, ${run.xorCount} XOR), ${run.otCount} OTs, garbled payload ${run.garbledBytes} bytes.`;
    } finally {
      fullBtn.disabled = false;
      fullBtn.removeAttribute('aria-busy');
      fullBtn.textContent = 'Run Full Protocol';
    }
  });
}

render();
