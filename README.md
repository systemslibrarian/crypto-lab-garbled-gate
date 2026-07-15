# crypto-lab-garbled-gate

## What It Is

Garbled Gate demonstrates Yao's Garbled Circuits (Yao, FOCS 1986) - the foundational protocol for general-purpose secure two-party computation. A garbled circuit allows two parties to jointly evaluate any boolean function on their private inputs without either party learning the other's input. The garbler encrypts each gate's truth table under random wire labels; the evaluator decrypts gate by gate, learning only the output. Input wire labels are exchanged using Oblivious Transfer, ensuring neither party learns more than the protocol output. The canonical application is Yao's Millionaire's Problem: who is richer, without revealing actual wealth.

## When to Use It

- Two-party computation of any boolean function with semi-honest security
- Private set intersection, private comparison, secure auctions
- As the Boolean component in mixed-protocol MPC (ABY-style)
- When constant-round communication is required (GC evaluates in 2 rounds)
- Not practical for very large circuits (millions of gates) without significant optimization and hardware acceleration
- Provides only semi-honest security by default - malicious security requires cut-and-choose or authenticated garbling (significant overhead)
- Multi-party settings (>2 parties) require GMW or SPDZ extensions
- Do NOT use this as a production MPC library — it is a teaching demo that documents where it simplifies for clarity.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-garbled-gate](https://systemslibrarian.github.io/crypto-lab-garbled-gate/)**

Six interactive exhibits, built to be *watched*, not just read:

1. **The Millionaire's Problem** — the motivating scenario, with a one-click private comparison and a self-check.
2. **Anatomy of one garbled gate** — a visual AND gate with colour-coded 128-bit wire-label chips and four *padlock* rows. Step garble → pick inputs → evaluate → reveal, and watch **point-and-permute** open exactly one row. A "Why only one row?" view trial-decrypts all four so you see three GCM rejections and one success.
3. **Oblivious Transfer** — real Chou–Orlandi OT on Curve25519; one box opens, the other stays sealed, and Alice can't tell which.
4. **The full protocol, gate by gate** — a layered SVG comparator circuit you step through gate by gate (buttons or ←/→ arrow keys), with per-gate narration of *how* each gate opens, a **God-view** toggle that reveals the secret bit on every wire (the view Bob never has), and a live meter of garbled bytes / OTs / Free-XOR savings.
5. **Security & cost** — semi-honest model, Free XOR / row reduction / Half Gates, a comparison against secret-sharing MPC and FHE, and a **live label-reuse attack**: reuse one garbled gate and watch Bob extract Alice's secret bit with two honest decryptions.
6. **In production** — PSI, secure ML inference, sealed-bid auctions, threshold signatures, plus the MPC family tree.

Every exhibit runs **real cryptography** in the browser (WebCrypto AES-128-GCM, `@noble/curves` ed25519, genuine Free-XOR with a global Δ). An **Honest implementation notes** section documents exactly where the demo simplifies for teaching.

## What Can Go Wrong

- **Reusing a garbled circuit.** A garbled circuit is single-use; evaluating two input sets under the same wire labels leaks information, so each evaluation needs fresh garbling.
- **Semi-honest assumption broken.** A malicious garbler can garble the wrong function or feed inconsistent labels; defending against this needs cut-and-choose or authenticated garbling, with real overhead.
- **Weak or broken Oblivious Transfer.** OT is what stops the evaluator from learning both input labels; a flawed OT undermines the entire privacy guarantee.
- **Selective-failure attacks.** If the garbler can make evaluation succeed or fail depending on the evaluator's private input, the abort itself leaks a bit — a known pitfall that careful protocol design must close.
- **Insufficient wire-label entropy / encryption misuse.** Predictable labels or reused AES keys/nonces in the gate encryption can let an evaluator decrypt rows it should not, collapsing the security of point-and-permute.

## Real-World Usage

- **Private set intersection and contact discovery** use secure two-party computation so parties learn only the intersection, not each other's full sets.
- **Sealed-bid and secure auctions** compute the winner/price without revealing losing bids.
- **Privacy-preserving machine-learning inference** lets a client and a model owner jointly evaluate a model without exposing inputs or weights.
- **Real MPC deployments** such as the Boston wage-equity study used secure computation to aggregate sensitive salary data across employers without sharing raw figures.
- **MPC toolkits** like EMP-toolkit, ABY, and related frameworks implement garbled circuits (with Free-XOR, Half Gates, and OT extension) for research and production use.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-garbled-gate
cd crypto-lab-garbled-gate
npm install
npm run dev
```

## Related Demos

- [crypto-lab-ot-gate](https://systemslibrarian.github.io/crypto-lab-ot-gate/) — Chou-Orlandi Oblivious Transfer, the primitive that exchanges input labels here.
- [crypto-lab-gg20-wallet](https://systemslibrarian.github.io/crypto-lab-gg20-wallet/) — threshold ECDSA, MPC applied to signing.
- [crypto-lab-frost-threshold](https://systemslibrarian.github.io/crypto-lab-frost-threshold/) — threshold Schnorr signing, another MPC protocol.
- [crypto-lab-shamir-gate](https://systemslibrarian.github.io/crypto-lab-shamir-gate/) — secret sharing, the alternative MPC foundation compared in Exhibit 5.
- [crypto-lab-psi-gate](https://systemslibrarian.github.io/crypto-lab-psi-gate/) — private set intersection, a headline garbled-circuit application.

---

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
