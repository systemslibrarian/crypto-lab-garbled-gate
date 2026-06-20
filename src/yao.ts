import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

const Point = ed25519.Point;
const G = Point.BASE;
const ORDER = Point.Fn.ORDER;

// ── Core types ───────────────────────────────────────────────────────────

export interface LabelPair {
  zero: Uint8Array;
  one: Uint8Array;
}

/**
 * One ciphertext row of a garbled gate, stored at its point-and-permute slot.
 * `selectBits` are the colour (permute) bits the evaluator reads off the two
 * active input labels to jump straight to this row. `trueInputs`/`outBit` are
 * the underlying logical values — SECRET in a real protocol, surfaced here only
 * for the "God view" teaching toggle.
 */
export interface GarbledRow {
  slot: 0 | 1 | 2 | 3;
  selectBits: [0 | 1, 0 | 1];
  trueInputs: [0 | 1, 0 | 1];
  outBit: 0 | 1;
  ivHex: string;
  cipherHex: string;
}

export interface AndGateDemo {
  delta: Uint8Array;
  wireA: LabelPair;
  wireB: LabelPair;
  wireOut: LabelPair;
  rows: GarbledRow[]; // length 4, ordered by slot 0..3
}

export interface AndGateEvaluation {
  aBit: 0 | 1;
  bBit: 0 | 1;
  selectBits: [0 | 1, 0 | 1];
  slot: 0 | 1 | 2 | 3;
  outputLabelHex: string;
  outputBit: 0 | 1 | null;
  decryptOk: boolean;
}

export interface OTTrace {
  AHex: string;
  BHex: string;
  e0Hex: string;
  e1Hex: string;
  choice: 0 | 1;
  receivedHex: string;
  message0Hex: string;
  message1Hex: string;
}

export interface GateDef {
  id: string;
  type: 'XOR' | 'AND' | 'OR';
  inA: string;
  inB: string;
  out: string;
}

export type WireKind = 'aliceIn' | 'bobIn' | 'const' | 'internal' | 'output';

export interface WireNode {
  name: string;
  level: number;
  kind: WireKind;
}

export interface GateNode extends GateDef {
  level: number;
  free: boolean; // XOR gates are free (no ciphertext)
}

export interface CircuitLayout {
  wires: Record<string, WireNode>;
  gates: GateNode[];
  depth: number;
  outputs: string[];
}

export interface GateTraceStep {
  id: string;
  type: 'XOR' | 'AND' | 'OR';
  inA: string;
  inB: string;
  out: string;
  aBit: 0 | 1;
  bBit: 0 | 1;
  outBit: 0 | 1;
  slot: number | null; // point-and-permute slot decrypted, null for free XOR
  free: boolean;
}

export interface MillionaireProtocolResult {
  aliceValue: number;
  bobValue: number;
  aliceBits: [0 | 1, 0 | 1, 0 | 1];
  bobBits: [0 | 1, 0 | 1, 0 | 1];
  output: 'Alice is richer' | 'Bob is richer' | 'Equal';
  steps: string[];
  layout: CircuitLayout;
  gateTrace: GateTraceStep[];
  wireBits: Record<string, 0 | 1>;
  otTraces: OTTrace[];
  gateCount: number;
  andOrCount: number;
  xorCount: number;
  otCount: number;
  garbledBytes: number;
  freeXorBytesSaved: number;
  labelsByWireHex: Record<string, { zero: string; one: string }>;
}

// ── Byte helpers ─────────────────────────────────────────────────────────

function randomBytes(len: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(len));
}

function randomScalar(): bigint {
  const buf = randomBytes(64);
  let n = 0n;
  for (const b of buf) {
    n = (n << 8n) | BigInt(b);
  }
  return (n % (ORDER - 1n)) + 1n;
}

function randomBit(): 0 | 1 {
  const b = randomBytes(1)[0] & 1;
  return b === 0 ? 0 : 1;
}

function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) {
    return 0;
  }
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  while (true) {
    const v = new DataView(randomBytes(4).buffer).getUint32(0, false);
    if (v < limit) {
      return v % maxExclusive;
    }
  }
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u8.length);
  new Uint8Array(out).set(u8);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ── Wire labels, permute bits, Free-XOR delta ────────────────────────────

/** The point-and-permute "colour" bit: the public lsb of a 128-bit label. */
export function labelPermuteBit(label: Uint8Array): 0 | 1 {
  return (label[label.length - 1] & 1) === 0 ? 0 : 1;
}

function withPermuteBit(label: Uint8Array, bit: 0 | 1): Uint8Array {
  const out = new Uint8Array(label);
  out[out.length - 1] = (out[out.length - 1] & 0xfe) | bit;
  return out;
}

/**
 * Free-XOR global offset Δ. Its lsb is forced to 1 so that the two labels of
 * any wire always carry opposite colour bits (zero⊕Δ flips the lsb).
 */
function randomDelta(): Uint8Array {
  const d = randomBytes(16);
  d[d.length - 1] |= 1;
  return d;
}

function makeLabelPair(delta: Uint8Array): LabelPair {
  const perm0 = randomBit();
  const zero = withPermuteBit(randomBytes(16), perm0);
  const one = xorBytes(zero, delta);
  return { zero, one };
}

function logicalEval(type: 'AND' | 'OR' | 'XOR', a: 0 | 1, b: 0 | 1): 0 | 1 {
  if (type === 'AND') {
    return (a & b) as 0 | 1;
  }
  if (type === 'OR') {
    return (a | b) as 0 | 1;
  }
  return (a ^ b) as 0 | 1;
}

// ── Symmetric encryption (WebCrypto AES-128-GCM) ─────────────────────────

async function aes128Encrypt(key: Uint8Array, plaintext: Uint8Array): Promise<{ iv: Uint8Array; cipher: Uint8Array }> {
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = randomBytes(12);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, cryptoKey, toArrayBuffer(plaintext)),
  );
  return { iv, cipher };
}

async function aes128Decrypt(key: Uint8Array, iv: Uint8Array, cipher: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, cryptoKey, toArrayBuffer(cipher));
  return new Uint8Array(pt);
}

/** Per-row gate key H(A‖B‖gateId): binds a row to one pair of input labels. */
function deriveGateKey(a: Uint8Array, b: Uint8Array, gateId: string): Uint8Array {
  const encoder = new TextEncoder();
  const material = concatBytes([a, b, encoder.encode(gateId)]);
  return sha256(material).slice(0, 16);
}

// ── Garbling a single AND/OR gate (point-and-permute ordered) ────────────

async function garbleBinaryGate(
  gateId: string,
  type: 'AND' | 'OR',
  inA: LabelPair,
  inB: LabelPair,
  out: LabelPair,
): Promise<GarbledRow[]> {
  const rows = new Array<GarbledRow>(4);
  const inputs: Array<[0 | 1, 0 | 1]> = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ];

  for (const [aBit, bBit] of inputs) {
    const aLabel = aBit === 0 ? inA.zero : inA.one;
    const bLabel = bBit === 0 ? inB.zero : inB.one;
    const outBit = logicalEval(type, aBit, bBit);
    const outLabel = outBit === 0 ? out.zero : out.one;
    const key = deriveGateKey(aLabel, bLabel, gateId);
    const encrypted = await aes128Encrypt(key, outLabel);

    const selA = labelPermuteBit(aLabel);
    const selB = labelPermuteBit(bLabel);
    const slot = ((selA << 1) | selB) as 0 | 1 | 2 | 3;

    rows[slot] = {
      slot,
      selectBits: [selA, selB],
      trueInputs: [aBit, bBit],
      outBit,
      ivHex: bytesToHex(encrypted.iv),
      cipherHex: bytesToHex(encrypted.cipher),
    };
  }

  return rows;
}

// ── Exhibit 2: single AND gate ───────────────────────────────────────────

export async function garbleAndGateDemo(): Promise<AndGateDemo> {
  const delta = randomDelta();
  const wireA = makeLabelPair(delta);
  const wireB = makeLabelPair(delta);
  const wireOut = makeLabelPair(delta);
  const rows = await garbleBinaryGate('AND-demo', 'AND', wireA, wireB, wireOut);

  return { delta, wireA, wireB, wireOut, rows };
}

/**
 * Evaluate using point-and-permute: read the two colour bits off the active
 * labels, jump to exactly that slot, decrypt only that one row.
 */
export async function evaluateAndGateDemo(
  demo: AndGateDemo,
  aBit: 0 | 1,
  bBit: 0 | 1,
  revealOutputMap: boolean,
): Promise<AndGateEvaluation> {
  const aLabel = aBit === 0 ? demo.wireA.zero : demo.wireA.one;
  const bLabel = bBit === 0 ? demo.wireB.zero : demo.wireB.one;

  const selA = labelPermuteBit(aLabel);
  const selB = labelPermuteBit(bLabel);
  const slot = ((selA << 1) | selB) as 0 | 1 | 2 | 3;
  const row = demo.rows[slot];

  const key = deriveGateKey(aLabel, bLabel, 'AND-demo');
  let outputLabelHex = '';
  let decryptOk = false;
  try {
    const out = await aes128Decrypt(key, hexToBytes(row.ivHex), hexToBytes(row.cipherHex));
    outputLabelHex = bytesToHex(out);
    decryptOk = true;
  } catch {
    decryptOk = false;
  }

  let outputBit: 0 | 1 | null = null;
  if (revealOutputMap && outputLabelHex.length > 0) {
    if (outputLabelHex === bytesToHex(demo.wireOut.zero)) {
      outputBit = 0;
    } else if (outputLabelHex === bytesToHex(demo.wireOut.one)) {
      outputBit = 1;
    }
  }

  return { aBit, bBit, selectBits: [selA, selB], slot, outputLabelHex, outputBit, decryptOk };
}

/**
 * Try to decrypt EVERY row under the key for (aBit,bBit). Exactly one row
 * authenticates — this is what point-and-permute lets the evaluator skip.
 */
export async function trialDecryptAll(
  demo: AndGateDemo,
  aBit: 0 | 1,
  bBit: 0 | 1,
): Promise<Array<{ slot: number; ok: boolean }>> {
  const aLabel = aBit === 0 ? demo.wireA.zero : demo.wireA.one;
  const bLabel = bBit === 0 ? demo.wireB.zero : demo.wireB.one;
  const key = deriveGateKey(aLabel, bLabel, 'AND-demo');

  const results: Array<{ slot: number; ok: boolean }> = [];
  for (const row of demo.rows) {
    try {
      await aes128Decrypt(key, hexToBytes(row.ivHex), hexToBytes(row.cipherHex));
      results.push({ slot: row.slot, ok: true });
    } catch {
      results.push({ slot: row.slot, ok: false });
    }
  }
  return results;
}

// ── Exhibit 3: Chou-Orlandi 1-of-2 OT ────────────────────────────────────

export async function runInputLabelOT(message0: Uint8Array, message1: Uint8Array, choice: 0 | 1): Promise<OTTrace> {
  const a = randomScalar();
  const A = G.multiply(a);
  const ABytes = A.toBytes();

  const r = randomScalar();
  const rG = G.multiply(r);
  const B = choice === 0 ? rG : A.add(rG);
  const BBytes = B.toBytes();

  const k0 = sha256(B.multiply(a).toBytes()).slice(0, 16);
  const k1 = sha256(B.subtract(A).multiply(a).toBytes()).slice(0, 16);

  const e0 = await aes128Encrypt(k0, message0);
  const e1 = await aes128Encrypt(k1, message1);

  const kb = sha256(A.multiply(r).toBytes()).slice(0, 16);
  const chosen = choice === 0 ? e0 : e1;
  const received = await aes128Decrypt(kb, chosen.iv, chosen.cipher);

  return {
    AHex: bytesToHex(ABytes),
    BHex: bytesToHex(BBytes),
    e0Hex: `${bytesToHex(e0.iv)}:${bytesToHex(e0.cipher)}`,
    e1Hex: `${bytesToHex(e1.iv)}:${bytesToHex(e1.cipher)}`,
    choice,
    receivedHex: bytesToHex(received),
    message0Hex: bytesToHex(message0),
    message1Hex: bytesToHex(message1),
  };
}

// ── Exhibit 4: 3-bit comparator circuit ──────────────────────────────────

/**
 * A > B and A == B for two 3-bit numbers, expressed in XOR/AND/OR.
 * Built in dependency order so a single forward pass can assign wire levels.
 */
function comparatorCircuit(): GateDef[] {
  return [
    { id: 'nb2', type: 'XOR', inA: 'b2', inB: 'one', out: 'nb2' },
    { id: 'nb1', type: 'XOR', inA: 'b1', inB: 'one', out: 'nb1' },
    { id: 'nb0', type: 'XOR', inA: 'b0', inB: 'one', out: 'nb0' },

    { id: 'g2', type: 'AND', inA: 'a2', inB: 'nb2', out: 'g2' },
    { id: 'x2', type: 'XOR', inA: 'a2', inB: 'b2', out: 'x2' },
    { id: 'e2', type: 'XOR', inA: 'x2', inB: 'one', out: 'e2' },

    { id: 'g1', type: 'AND', inA: 'a1', inB: 'nb1', out: 'g1' },
    { id: 'x1', type: 'XOR', inA: 'a1', inB: 'b1', out: 'x1' },
    { id: 'e1', type: 'XOR', inA: 'x1', inB: 'one', out: 'e1' },

    { id: 'g0', type: 'AND', inA: 'a0', inB: 'nb0', out: 'g0' },
    { id: 'x0', type: 'XOR', inA: 'a0', inB: 'b0', out: 'x0' },
    { id: 'e0', type: 'XOR', inA: 'x0', inB: 'one', out: 'e0' },

    { id: 'term1', type: 'AND', inA: 'e2', inB: 'g1', out: 'term1' },
    { id: 'e1g0', type: 'AND', inA: 'e1', inB: 'g0', out: 'e1g0' },
    { id: 'term2', type: 'AND', inA: 'e2', inB: 'e1g0', out: 'term2' },
    { id: 'o1', type: 'OR', inA: 'g2', inB: 'term1', out: 'o1' },
    { id: 'gt', type: 'OR', inA: 'o1', inB: 'term2', out: 'gt' },

    { id: 'e1e0', type: 'AND', inA: 'e1', inB: 'e0', out: 'e1e0' },
    { id: 'eq', type: 'AND', inA: 'e2', inB: 'e1e0', out: 'eq' },
  ];
}

function wireKind(name: string, isOutput: boolean): WireKind {
  if (isOutput) return 'output';
  if (name === 'one') return 'const';
  if (/^a[0-9]$/.test(name)) return 'aliceIn';
  if (/^b[0-9]$/.test(name)) return 'bobIn';
  return 'internal';
}

export function comparatorLayout(): CircuitLayout {
  const circuit = comparatorCircuit();
  const outputs = ['gt', 'eq'];
  const level: Record<string, number> = {};
  const wires: Record<string, WireNode> = {};

  const ensureInput = (name: string) => {
    if (level[name] === undefined) {
      level[name] = 0;
      wires[name] = { name, level: 0, kind: wireKind(name, false) };
    }
  };

  for (const g of circuit) {
    ensureInput(g.inA);
    ensureInput(g.inB);
  }

  const gates: GateNode[] = [];
  for (const g of circuit) {
    const lv = Math.max(level[g.inA] ?? 0, level[g.inB] ?? 0) + 1;
    level[g.out] = lv;
    wires[g.out] = { name: g.out, level: lv, kind: wireKind(g.out, outputs.includes(g.out)) };
    gates.push({ ...g, level: lv, free: g.type === 'XOR' });
  }

  const depth = Math.max(...Object.values(level));
  return { wires, gates, depth, outputs };
}

function toBits3(v: number): [0 | 1, 0 | 1, 0 | 1] {
  const n = Math.max(1, Math.min(7, Math.trunc(v)));
  const b2 = ((n >> 2) & 1) as 0 | 1;
  const b1 = ((n >> 1) & 1) as 0 | 1;
  const b0 = (n & 1) as 0 | 1;
  return [b2, b1, b0];
}

/** Plaintext evaluation — the "God view" ground truth for every wire. */
export function evalCircuitPlain(circuit: GateDef[], inputs: Record<string, 0 | 1>): Record<string, 0 | 1> {
  const bits: Record<string, 0 | 1> = { ...inputs };
  for (const g of circuit) {
    bits[g.out] = logicalEval(g.type, bits[g.inA], bits[g.inB]);
  }
  return bits;
}

interface GarbledCircuit {
  delta: Uint8Array;
  labels: Record<string, LabelPair>;
  gates: Array<GateDef & { table: GarbledRow[] }>;
}

async function garbleComparator(circuit: GateDef[]): Promise<GarbledCircuit> {
  const delta = randomDelta();
  const labels: Record<string, LabelPair> = {};
  const wires = new Set<string>();

  for (const g of circuit) {
    wires.add(g.inA);
    wires.add(g.inB);
    wires.add(g.out);
  }
  for (const wire of wires) {
    labels[wire] = makeLabelPair(delta);
  }

  const gates: Array<GateDef & { table: GarbledRow[] }> = [];
  for (const gate of circuit) {
    if (gate.type === 'XOR') {
      // Free XOR: out0 = inA0 ⊕ inB0, out1 = out0 ⊕ Δ. No ciphertext.
      const outZero = xorBytes(labels[gate.inA].zero, labels[gate.inB].zero);
      labels[gate.out] = { zero: outZero, one: xorBytes(outZero, delta) };
      gates.push({ ...gate, table: [] });
      continue;
    }
    const table = await garbleBinaryGate(gate.id, gate.type, labels[gate.inA], labels[gate.inB], labels[gate.out]);
    gates.push({ ...gate, table });
  }

  return { delta, labels, gates };
}

async function evaluateComparator(
  gc: GarbledCircuit,
  active: Record<string, Uint8Array>,
): Promise<void> {
  for (const gate of gc.gates) {
    if (gate.type === 'XOR') {
      active[gate.out] = xorBytes(active[gate.inA], active[gate.inB]);
      continue;
    }
    const slot = (labelPermuteBit(active[gate.inA]) << 1) | labelPermuteBit(active[gate.inB]);
    const row = gate.table[slot];
    const key = deriveGateKey(active[gate.inA], active[gate.inB], gate.id);
    active[gate.out] = await aes128Decrypt(key, hexToBytes(row.ivHex), hexToBytes(row.cipherHex));
  }
}

export async function runMillionaireProtocol3Bit(aliceValue: number, bobValue: number): Promise<MillionaireProtocolResult> {
  const aliceBits = toBits3(aliceValue);
  const bobBits = toBits3(bobValue);
  const [a2, a1, a0] = aliceBits;
  const [b2, b1, b0] = bobBits;
  const circuit = comparatorCircuit();
  const layout = comparatorLayout();
  const gc = await garbleComparator(circuit);

  // Plaintext ground truth for every wire (God view + correctness check).
  const inputBits: Record<string, 0 | 1> = { a2, a1, a0, b2, b1, b0, one: 1 };
  const wireBits = evalCircuitPlain(circuit, inputBits);

  // Real garbled evaluation. Alice's input labels are sent directly; Bob's
  // arrive via one OT per input bit.
  const active: Record<string, Uint8Array> = {};
  const aliceWires: Array<[string, 0 | 1]> = [
    ['a2', a2],
    ['a1', a1],
    ['a0', a0],
    ['one', 1],
  ];
  for (const [wire, bit] of aliceWires) {
    active[wire] = bit === 0 ? gc.labels[wire].zero : gc.labels[wire].one;
  }

  const bobWires: Array<[string, 0 | 1]> = [
    ['b2', b2],
    ['b1', b1],
    ['b0', b0],
  ];
  const otTraces: OTTrace[] = [];
  for (const [wire, bit] of bobWires) {
    const trace = await runInputLabelOT(gc.labels[wire].zero, gc.labels[wire].one, bit);
    otTraces.push(trace);
    active[wire] = hexToBytes(trace.receivedHex);
  }

  await evaluateComparator(gc, active);

  // Verify the garbled run agrees with plaintext on every output wire.
  for (const out of layout.outputs) {
    const garbledBit = bytesToHex(active[out]) === bytesToHex(gc.labels[out].one) ? 1 : 0;
    if (garbledBit !== wireBits[out]) {
      throw new Error(`Garbled/plain mismatch on wire ${out}: ${garbledBit} vs ${wireBits[out]}`);
    }
  }

  const gtBit = wireBits.gt;
  const eqBit = wireBits.eq;
  let output: 'Alice is richer' | 'Bob is richer' | 'Equal';
  if (eqBit === 1) {
    output = 'Equal';
  } else if (gtBit === 1) {
    output = 'Alice is richer';
  } else {
    output = 'Bob is richer';
  }

  // Per-gate trace in evaluation order, with the slot the evaluator decrypted.
  const gateTrace: GateTraceStep[] = gc.gates.map((gate) => {
    const aBit = wireBits[gate.inA];
    const bBit = wireBits[gate.inB];
    const slot = gate.type === 'XOR' ? null : (labelPermuteBit(active[gate.inA]) << 1) | labelPermuteBit(active[gate.inB]);
    return {
      id: gate.id,
      type: gate.type,
      inA: gate.inA,
      inB: gate.inB,
      out: gate.out,
      aBit,
      bBit,
      outBit: wireBits[gate.out],
      slot,
      free: gate.type === 'XOR',
    };
  });

  const andOrGates = gc.gates.filter((g) => g.type === 'AND' || g.type === 'OR');
  const xorGates = gc.gates.filter((g) => g.type === 'XOR');
  const garbledBytes = andOrGates.reduce((acc, g) => {
    return (
      acc +
      g.table.reduce((inner, row) => inner + hexToBytes(row.ivHex).length + hexToBytes(row.cipherHex).length, 0)
    );
  }, 0);
  // What 4-row classic garbling of the XOR gates would have cost (~per-row size).
  const avgRowBytes = andOrGates.length > 0 ? garbledBytes / (andOrGates.length * 4) : 0;
  const freeXorBytesSaved = Math.round(xorGates.length * 4 * avgRowBytes);

  const labelsByWireHex: Record<string, { zero: string; one: string }> = {};
  for (const [wire, pair] of Object.entries(gc.labels)) {
    labelsByWireHex[wire] = { zero: bytesToHex(pair.zero), one: bytesToHex(pair.one) };
  }

  const steps = [
    'Circuit agreed: both parties fix the public 3-bit comparator (XOR / AND / OR gates).',
    'Alice garbles: random 128-bit labels per wire; AND/OR rows encrypted with AES-128-GCM; XOR gates are free.',
    'Alice sends the garbled tables — encrypted rows only, no labels for the gates themselves.',
    `Alice sends her own input labels directly for bits ${a2}${a1}${a0} (their values stay hidden inside the labels).`,
    `Bob obtains his input labels via ${otTraces.length} oblivious transfers for bits ${b2}${b1}${b0} — Alice never learns which.`,
    'Bob evaluates gate by gate, decrypting exactly one row per AND/OR via point-and-permute.',
    'Alice reveals the output mapping for gt and eq only — so both learn the verdict and nothing else.',
  ];

  return {
    aliceValue: Math.max(1, Math.min(7, Math.trunc(aliceValue))),
    bobValue: Math.max(1, Math.min(7, Math.trunc(bobValue))),
    aliceBits,
    bobBits,
    output,
    steps,
    layout,
    gateTrace,
    wireBits,
    otTraces,
    gateCount: gc.gates.length,
    andOrCount: andOrGates.length,
    xorCount: xorGates.length,
    otCount: otTraces.length,
    garbledBytes,
    freeXorBytesSaved,
    labelsByWireHex,
  };
}

// Exported for the test suite.
export const __test = { comparatorCircuit, garbleBinaryGate, makeLabelPair, randomDelta, xorBytes, deriveGateKey };
