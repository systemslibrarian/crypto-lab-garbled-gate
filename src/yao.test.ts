import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  comparatorLayout,
  evalCircuitPlain,
  evaluateAndGateDemo,
  garbleAndGateDemo,
  labelPermuteBit,
  runInputLabelOT,
  runMillionaireProtocol3Bit,
  trialDecryptAll,
  __test,
} from './yao';

const { comparatorCircuit } = __test;

function xorHex(a: Uint8Array, b: Uint8Array): string {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return bytesToHex(out);
}

describe('single garbled AND gate', () => {
  it('evaluates the AND truth table correctly for every input', async () => {
    const demo = await garbleAndGateDemo();
    const cases: Array<[0 | 1, 0 | 1, 0 | 1]> = [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
    ];
    for (const [a, b, expected] of cases) {
      const ev = await evaluateAndGateDemo(demo, a, b, true);
      expect(ev.decryptOk).toBe(true);
      expect(ev.outputBit).toBe(expected);
    }
  });

  it('routes to the slot named by the active labels’ colour bits', async () => {
    const demo = await garbleAndGateDemo();
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as Array<[0 | 1, 0 | 1]>) {
      const aLabel = a === 0 ? demo.wireA.zero : demo.wireA.one;
      const bLabel = b === 0 ? demo.wireB.zero : demo.wireB.one;
      const expectedSlot = (labelPermuteBit(aLabel) << 1) | labelPermuteBit(bLabel);
      const ev = await evaluateAndGateDemo(demo, a, b, false);
      expect(ev.slot).toBe(expectedSlot);
    }
  });

  it('point-and-permute: exactly one of the four rows authenticates', async () => {
    const demo = await garbleAndGateDemo();
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as Array<[0 | 1, 0 | 1]>) {
      const trials = await trialDecryptAll(demo, a, b);
      expect(trials.filter((t) => t.ok)).toHaveLength(1);
    }
  });

  it('Free-XOR invariant: label₁ = label₀ ⊕ Δ on every wire', async () => {
    const demo = await garbleAndGateDemo();
    const delta = demo.delta;
    for (const wire of [demo.wireA, demo.wireB, demo.wireOut]) {
      expect(xorHex(wire.zero, delta)).toBe(bytesToHex(wire.one));
      // and opposite colour bits, which point-and-permute relies on
      expect(labelPermuteBit(wire.zero)).not.toBe(labelPermuteBit(wire.one));
    }
  });
});

describe('Chou-Orlandi 1-of-2 OT', () => {
  it('delivers exactly the chosen message', async () => {
    for (const choice of [0, 1] as const) {
      const m0 = crypto.getRandomValues(new Uint8Array(16));
      const m1 = crypto.getRandomValues(new Uint8Array(16));
      const trace = await runInputLabelOT(m0, m1, choice);
      const expected = choice === 0 ? bytesToHex(m0) : bytesToHex(m1);
      expect(trace.receivedHex).toBe(expected);
    }
  });
});

describe('comparator circuit layout', () => {
  it('assigns gt/eq as outputs and gives every gate a positive level', () => {
    const layout = comparatorLayout();
    expect(layout.outputs).toEqual(['gt', 'eq']);
    expect(layout.depth).toBeGreaterThan(0);
    for (const g of layout.gates) {
      expect(g.level).toBeGreaterThanOrEqual(1);
      expect(g.level).toBeGreaterThan(layout.wires[g.inA].level);
      expect(g.level).toBeGreaterThan(layout.wires[g.inB].level);
    }
  });

  it('plaintext comparator matches arithmetic comparison for all 3-bit pairs', () => {
    const circuit = comparatorCircuit();
    for (let a = 1; a <= 7; a += 1) {
      for (let b = 1; b <= 7; b += 1) {
        const bit = (n: number, i: number) => ((n >> i) & 1) as 0 | 1;
        const bits = evalCircuitPlain(circuit, {
          a2: bit(a, 2), a1: bit(a, 1), a0: bit(a, 0),
          b2: bit(b, 2), b1: bit(b, 1), b0: bit(b, 0),
          one: 1,
        });
        expect(bits.gt).toBe(a > b ? 1 : 0);
        expect(bits.eq).toBe(a === b ? 1 : 0);
      }
    }
  });
});

describe('full millionaire protocol', () => {
  it('garbled evaluation matches the true verdict for all 49 pairs', async () => {
    // 49 protocols × (garbling + 3 ed25519 OTs) is heavy; allow extra time.
    for (let a = 1; a <= 7; a += 1) {
      for (let b = 1; b <= 7; b += 1) {
        // runMillionaireProtocol3Bit internally throws if garbled != plaintext,
        // so reaching here already proves the garbled run is correct.
        const run = await runMillionaireProtocol3Bit(a, b);
        const expected = a > b ? 'Alice is richer' : a < b ? 'Bob is richer' : 'Equal';
        expect(run.output).toBe(expected);
        expect(run.otCount).toBe(3);
        expect(run.xorCount).toBeGreaterThan(0);
        expect(run.garbledBytes).toBeGreaterThan(0);
      }
    }
  }, 30000);
});
