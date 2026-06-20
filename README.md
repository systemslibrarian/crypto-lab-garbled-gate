# crypto-lab-garbled-gate

## 1. What It Is

Garbled Gate demonstrates Yao's Garbled Circuits (Yao, FOCS 1986) - the foundational protocol for general-purpose secure two-party computation. A garbled circuit allows two parties to jointly evaluate any boolean function on their private inputs without either party learning the other's input. The garbler encrypts each gate's truth table under random wire labels; the evaluator decrypts gate by gate, learning only the output. Input wire labels are exchanged using Oblivious Transfer, ensuring neither party learns more than the protocol output. The canonical application is Yao's Millionaire's Problem: who is richer, without revealing actual wealth.

## 2. When to Use It

- ✅ Two-party computation of any boolean function with semi-honest security
- ✅ Private set intersection, private comparison, secure auctions
- ✅ As the Boolean component in mixed-protocol MPC (ABY-style)
- ✅ When constant-round communication is required (GC evaluates in 2 rounds)
- ❌ Not practical for very large circuits (millions of gates) without significant optimization and hardware acceleration
- ❌ Provides only semi-honest security by default - malicious security requires cut-and-choose or authenticated garbling (significant overhead)
- ❌ Multi-party settings (>2 parties) require GMW or SPDZ extensions

## 3. Live Demo

Link: https://systemslibrarian.github.io/crypto-lab-garbled-gate/

Six interactive exhibits, built to be *watched*, not just read:

1. **The Millionaire's Problem** — the motivating scenario, with a one-click private comparison and a self-check.
2. **Anatomy of one garbled gate** — a visual AND gate with colour-coded 128-bit wire-label chips and four *padlock* rows. Step garble → pick inputs → evaluate → reveal, and watch **point-and-permute** open exactly one row. A "Why only one row?" view trial-decrypts all four so you see three GCM rejections and one success.
3. **Oblivious Transfer** — real Chou–Orlandi OT on Curve25519; one box opens, the other stays sealed, and Alice can't tell which.
4. **The full protocol, gate by gate** — a layered SVG comparator circuit you step through gate by gate, with a **God-view** toggle that reveals the secret bit on every wire (the view Bob never has) and a live meter of garbled bytes / OTs / Free-XOR savings.
5. **Security & cost** — semi-honest model, single-use circuits, Free XOR / row reduction / Half Gates, and a comparison against secret-sharing MPC and FHE.
6. **In production** — PSI, secure ML inference, sealed-bid auctions, threshold signatures, plus the MPC family tree.

Every exhibit runs **real cryptography** in the browser (WebCrypto AES-128-GCM, `@noble/curves` ed25519, genuine Free-XOR with a global Δ). An **Honest implementation notes** section documents exactly where the demo simplifies for teaching.

## 4. How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-garbled-gate
cd crypto-lab-garbled-gate
npm install
npm run dev      # local dev server
npm test         # vitest: AND/OR/XOR correctness, Free-XOR invariant,
                 # point-and-permute, OT, comparator over all 49 pairs, UI mount
npm run build    # typecheck + production bundle
```

## 5. Part of the Crypto-Lab Suite

Part of [crypto-lab](https://systemslibrarian.github.io/crypto-lab/) - browser-based cryptography demos spanning 2,500 years of cryptographic history to NIST FIPS 2024 post-quantum standards.

So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31