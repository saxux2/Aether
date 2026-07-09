# Audit engagement outreach — draft

Two tracks, not mutually exclusive: send the direct outreach now (below), and
separately look into SCF funding — if Aether qualifies, retroactively routing
through the Soroban Security Audit Bank (5% co-pay, refundable) could make a
second/follow-up audit much cheaper later even if this first one is direct.
Check eligibility and apply at https://stellar.org/grants-and-funding and
https://stellar.org/grants-and-funding/soroban-audit-bank.

## Primary candidate: Veridise

Covers both halves of this system in one engagement — Soroban/Rust smart
contracts and the Circom/Groth16 circuits (they've audited RISC Zero, Linea,
Succinct, Semaphore, and found bugs in core circomlib itself). Contact via
their site's audit request form: https://veridise.com/audits/ — no public
email found via search, use the form or look for a direct contact on their
site.

## Alternative / supplementary: zkSecurity

ZK-specialist only (100+ Circom-focused audits, including Sui's zkLogin —
Circom + snarkjs, a similar stack to this project's circuits). Would need to
be paired with a separate Soroban/Rust-focused firm for the contracts side if
you go this route instead of a single-vendor engagement. https://zksecurity.xyz/

## Draft outreach message

Subject: Audit request — Aether Dark Pool (Stellar/Soroban, ZK dark pool DEX)

> Hi [firm name] team,
>
> We're building Aether Dark Pool, a zero-knowledge institutional dark pool
> DEX on Stellar Soroban (XLM/USDC), live on testnet at
> https://aetherstellar.vercel.app/. We're looking to engage an audit ahead
> of mainnet launch and would like a quote and timeline.
>
> Scope: 5 Soroban contracts (~1,500 LOC total — escrow custody, order book,
> matching engine, settlement, Groth16 verifier) plus 4 Circom circuits
> (order commitment, balance sufficiency, price range, match proof) that the
> contracts trust completely for correctness — we'd want both reviewed as
> one engagement, since a circuit bug bypasses every on-chain guard the same
> way a contract bug would.
>
> We've prepared an audit-prep package covering trust assumptions, known
> accepted gaps, and what to scrutinize specifically:
> [attach contracts/AUDIT_PREP.md, or share repo access]
>
> Current state: all known issues from an internal review pass are fixed
> and tested (repo available), a real multi-party trusted-setup ceremony is
> in progress separately, and we're targeting mainnet after both the
> ceremony and this audit are complete.
>
> Could you let us know your current availability, typical timeline for a
> codebase this size, and estimated cost?
>
> Thanks,
> [your name]

## What to have ready when they respond

- Repo access (this one, at whatever commit is current when you reach out)
- `contracts/AUDIT_PREP.md` — already accurate and up to date
- Confirmation of whether the real ceremony will be done before or during
  the audit window (auditors will want to know which keys they're reviewing
  against — the dev/testnet ones are fine for their purposes even if the
  real ceremony hasn't finished, since they're auditing circuit *logic*,
  not the specific key material)
