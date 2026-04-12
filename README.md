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

Six exhibits: the Millionaire's Problem motivation, step-by-step garbling of an AND gate with real wire labels and encrypted garbled table, Oblivious Transfer for input wires with Chou-Orlandi OT, the full millionaire's protocol end-to-end on a 3-bit comparison circuit, security analysis and Free XOR/Half Gates optimizations, and real-world deployments in PSI, secure ML inference, and threshold cryptography.

## 4. How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-garbled-gate
cd crypto-lab-garbled-gate
npm install
npm run dev
```

## 5. Part of the Crypto-Lab Suite

Part of [crypto-lab](https://systemslibrarian.github.io/crypto-lab/) - browser-based cryptography demos spanning 2,500 years of cryptographic history to NIST FIPS 2024 post-quantum standards.

So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31