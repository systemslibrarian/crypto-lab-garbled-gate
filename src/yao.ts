import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

const Point = ed25519.Point;
const G = Point.BASE;
const ORDER = Point.Fn.ORDER;

export interface LabelPair {
  zero: Uint8Array;
  one: Uint8Array;
}

export interface GarbledRow {
  rowId: string;
  ivHex: string;
  cipherHex: string;
  sourceInputs: [0 | 1, 0 | 1];
}

export interface GarbledBinaryGate {
  id: string;
  type: 'AND' | 'OR';
  rows: GarbledRow[];
}

export interface AndGateDemo {
  wireA: LabelPair;
  wireB: LabelPair;
  wireOut: LabelPair;
  shuffledRows: GarbledRow[];
}

export interface AndGateEvaluation {
  outputLabelHex: string;
  outputBit: 0 | 1 | null;
  successfulRowId: string | null;
  attempted: Array<{ rowId: string; success: boolean }>;
}

export interface OTTrace {
  AHex: string;
  BHex: string;
  e0Hex: string;
  e1Hex: string;
  choice: 0 | 1;
  receivedHex: string;
}

export interface GateDef {
  id: string;
  type: 'XOR' | 'AND' | 'OR';
  inA: string;
  inB: string;
  out: string;
}

export interface GarbledGateArtifact {
  id: string;
  type: 'XOR' | 'AND' | 'OR';
  inA: string;
  inB: string;
  out: string;
  table: GarbledRow[];
}

export interface MillionaireProtocolResult {
  aliceValue: number;
  bobValue: number;
  output: 'Alice is richer' | 'Bob is richer' | 'Equal';
  steps: string[];
  gateCount: number;
  andOrCount: number;
  xorCount: number;
  otCount: number;
  garbledBytes: number;
  labelsByWireHex: Record<string, { zero: string; one: string }>;
}

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

function labelPermuteBit(label: Uint8Array): 0 | 1 {
  return (label[label.length - 1] & 1) === 0 ? 0 : 1;
}

function withPermuteBit(label: Uint8Array, bit: 0 | 1): Uint8Array {
  const out = new Uint8Array(label);
  out[out.length - 1] = (out[out.length - 1] & 0xfe) | bit;
  return out;
}

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

function deriveGateKey(a: Uint8Array, b: Uint8Array, gateId: string): Uint8Array {
  const encoder = new TextEncoder();
  const material = concatBytes([a, b, encoder.encode(gateId)]);
  return sha256(material).slice(0, 16);
}

function shuffleRows(rows: GarbledRow[]): GarbledRow[] {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function garbleBinaryGate(
  gateId: string,
  type: 'AND' | 'OR',
  inA: LabelPair,
  inB: LabelPair,
  out: LabelPair,
): Promise<GarbledRow[]> {
  const rows: GarbledRow[] = [];
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

    rows.push({
      rowId: `${gateId}:${aBit}${bBit}`,
      ivHex: bytesToHex(encrypted.iv),
      cipherHex: bytesToHex(encrypted.cipher),
      sourceInputs: [aBit, bBit],
    });
  }

  return rows;
}

export async function garbleAndGateDemo(): Promise<AndGateDemo> {
  const delta = randomDelta();
  const wireA = makeLabelPair(delta);
  const wireB = makeLabelPair(delta);
  const wireOut = makeLabelPair(delta);
  const rows = await garbleBinaryGate('AND-demo', 'AND', wireA, wireB, wireOut);

  return {
    wireA,
    wireB,
    wireOut,
    shuffledRows: shuffleRows(rows),
  };
}

export async function evaluateAndGateDemo(
  demo: AndGateDemo,
  aBit: 0 | 1,
  bBit: 0 | 1,
  revealOutputMap: boolean,
): Promise<AndGateEvaluation> {
  const aLabel = aBit === 0 ? demo.wireA.zero : demo.wireA.one;
  const bLabel = bBit === 0 ? demo.wireB.zero : demo.wireB.one;

  const attempted: Array<{ rowId: string; success: boolean }> = [];
  let outputLabelHex = '';
  let successfulRowId: string | null = null;

  for (const row of demo.shuffledRows) {
    const key = deriveGateKey(aLabel, bLabel, 'AND-demo');
    const iv = hexToBytes(row.ivHex);
    const cipher = hexToBytes(row.cipherHex);
    try {
      const out = await aes128Decrypt(key, iv, cipher);
      outputLabelHex = bytesToHex(out);
      successfulRowId = row.rowId;
      attempted.push({ rowId: row.rowId, success: true });
    } catch {
      attempted.push({ rowId: row.rowId, success: false });
    }
  }

  let outputBit: 0 | 1 | null = null;
  if (revealOutputMap && outputLabelHex.length > 0) {
    if (outputLabelHex === bytesToHex(demo.wireOut.zero)) {
      outputBit = 0;
    } else if (outputLabelHex === bytesToHex(demo.wireOut.one)) {
      outputBit = 1;
    }
  }

  return {
    outputLabelHex,
    outputBit,
    successfulRowId,
    attempted,
  };
}

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
  };
}

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

function toBits3(v: number): [0 | 1, 0 | 1, 0 | 1] {
  const n = Math.max(1, Math.min(7, Math.trunc(v)));
  const b2 = ((n >> 2) & 1) as 0 | 1;
  const b1 = ((n >> 1) & 1) as 0 | 1;
  const b0 = (n & 1) as 0 | 1;
  return [b2, b1, b0];
}

async function garbleComparator(
  circuit: GateDef[],
): Promise<{ delta: Uint8Array; labels: Record<string, LabelPair>; artifacts: GarbledGateArtifact[] }> {
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

  const artifacts: GarbledGateArtifact[] = [];
  for (const gate of circuit) {
    if (gate.type === 'XOR') {
      const outZero = xorBytes(labels[gate.inA].zero, labels[gate.inB].zero);
      labels[gate.out] = { zero: outZero, one: xorBytes(outZero, delta) };
      artifacts.push({ ...gate, table: [] });
      continue;
    }
    const rows = await garbleBinaryGate(gate.id, gate.type, labels[gate.inA], labels[gate.inB], labels[gate.out]);
    const ordered = new Array<GarbledRow>(4);
    for (const row of rows) {
      const [aBit, bBit] = row.sourceInputs;
      const aLabel = aBit === 0 ? labels[gate.inA].zero : labels[gate.inA].one;
      const bLabel = bBit === 0 ? labels[gate.inB].zero : labels[gate.inB].one;
      const idx = (labelPermuteBit(aLabel) << 1) | labelPermuteBit(bLabel);
      ordered[idx] = row;
    }
    artifacts.push({ ...gate, table: ordered });
  }

  return { delta, labels, artifacts };
}

async function evaluateComparator(
  artifacts: GarbledGateArtifact[],
  active: Record<string, Uint8Array>,
): Promise<void> {
  for (const gate of artifacts) {
    if (gate.type === 'XOR') {
      active[gate.out] = xorBytes(active[gate.inA], active[gate.inB]);
      continue;
    }
    const idx = (labelPermuteBit(active[gate.inA]) << 1) | labelPermuteBit(active[gate.inB]);
    const row = gate.table[idx];
    const key = deriveGateKey(active[gate.inA], active[gate.inB], gate.id);
    active[gate.out] = await aes128Decrypt(key, hexToBytes(row.ivHex), hexToBytes(row.cipherHex));
  }
}

export async function runMillionaireProtocol3Bit(aliceValue: number, bobValue: number): Promise<MillionaireProtocolResult> {
  const [a2, a1, a0] = toBits3(aliceValue);
  const [b2, b1, b0] = toBits3(bobValue);
  const circuit = comparatorCircuit();
  const { labels, artifacts } = await garbleComparator(circuit);

  const aliceWires: Array<[string, 0 | 1]> = [
    ['a2', a2],
    ['a1', a1],
    ['a0', a0],
    ['one', 1],
  ];

  const bobWires: Array<[string, 0 | 1]> = [
    ['b2', b2],
    ['b1', b1],
    ['b0', b0],
  ];

  const active: Record<string, Uint8Array> = {};
  for (const [wire, bit] of aliceWires) {
    active[wire] = bit === 0 ? labels[wire].zero : labels[wire].one;
  }

  const otTraces: OTTrace[] = [];
  for (const [wire, bit] of bobWires) {
    const trace = await runInputLabelOT(labels[wire].zero, labels[wire].one, bit);
    otTraces.push(trace);
    active[wire] = hexToBytes(trace.receivedHex);
  }

  await evaluateComparator(artifacts, active);

  const gtLabel = bytesToHex(active.gt);
  const eqLabel = bytesToHex(active.eq);
  const gtBit = gtLabel === bytesToHex(labels.gt.one) ? 1 : 0;
  const eqBit = eqLabel === bytesToHex(labels.eq.one) ? 1 : 0;

  let output: 'Alice is richer' | 'Bob is richer' | 'Equal';
  if (eqBit === 1) {
    output = 'Equal';
  } else if (gtBit === 1) {
    output = 'Alice is richer';
  } else {
    output = 'Bob is richer';
  }

  const andOrGates = artifacts.filter((g) => g.type === 'AND' || g.type === 'OR');
  const xorGates = artifacts.filter((g) => g.type === 'XOR');
  const garbledBytes = andOrGates.reduce((acc, g) => {
    return (
      acc +
      g.table.reduce((inner, row) => {
        return inner + hexToBytes(row.ivHex).length + hexToBytes(row.cipherHex).length;
      }, 0)
    );
  }, 0);

  const labelsByWireHex: Record<string, { zero: string; one: string }> = {};
  for (const [wire, pair] of Object.entries(labels)) {
    labelsByWireHex[wire] = { zero: bytesToHex(pair.zero), one: bytesToHex(pair.one) };
  }

  const steps = [
    'Step 1 - Circuit definition: 3-bit comparator circuit with XOR, AND, and OR gates.',
    'Step 2 - Alice garbles: random 128-bit wire labels created and tables encrypted with AES-128-GCM.',
    'Step 3 - Alice sends garbled tables: Bob receives encrypted gate tables only.',
    `Step 4 - Alice input labels sent directly for bits ${a2}${a1}${a0}.`,
    `Step 5 - Bob input labels via OT: ${otTraces.length} OTs executed for bits ${b2}${b1}${b0}.`,
    'Step 6 - Bob evaluates gate by gate and obtains output labels for gt and eq.',
    'Step 7 - Alice reveals output mapping only for final output wires.',
  ];

  return {
    aliceValue: Math.max(1, Math.min(7, Math.trunc(aliceValue))),
    bobValue: Math.max(1, Math.min(7, Math.trunc(bobValue))),
    output,
    steps,
    gateCount: artifacts.length,
    andOrCount: andOrGates.length,
    xorCount: xorGates.length,
    otCount: otTraces.length,
    garbledBytes,
    labelsByWireHex,
  };
}
