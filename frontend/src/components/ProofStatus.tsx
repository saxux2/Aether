'use client';

import { useState } from 'react';
import type { ProofState } from '@/hooks/useProver';

interface Props {
  state: ProofState;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-fg/40 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs font-mono text-fg/60 break-all">{value}</p>
    </div>
  );
}

function ProofPanel({
  title,
  proof,
  publicSignals,
}: {
  title: string;
  proof: Record<string, unknown>;
  publicSignals: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-hairline/15 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-fg/[0.04] hover:bg-fg/[0.07] transition-colors text-left"
      >
        <span className="text-xs font-semibold text-accent">{title}</span>
        <span className="text-fg/40 text-xs">{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="px-3 py-3 space-y-3 bg-fg/[0.03]">
          <div>
            <p className="text-xs text-fg/40 uppercase tracking-wider mb-1">Public Signals</p>
            <div className="space-y-1">
              {publicSignals.map((s, i) => (
                <p key={i} className="text-xs font-mono text-up break-all">
                  [{i}] {s}
                </p>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-fg/40 uppercase tracking-wider mb-1">Proof (π_a, π_b, π_c)</p>
            <pre className="text-xs font-mono text-accent bg-fg/[0.05] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(proof, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProofStatus({ state }: Props) {
  if (state.status === 'idle') return null;

  if (state.status === 'generating') {
    return (
      <div className="flex items-center gap-3 p-3 bg-accent/10 border border-accent/25 rounded-lg">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="text-sm text-accent">{state.step}</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-3 bg-down/10 border border-down/25 rounded-lg">
        <p className="text-sm text-down">Proof failed: {state.message}</p>
      </div>
    );
  }

  if (state.status === 'done') {
    const { proofs } = state;
    return (
      <div className="space-y-3 p-3 bg-up/10 border border-up/25 rounded-lg">
        <div className="flex items-center gap-2">
          <span className="text-up text-base">&#10003;</span>
          <p className="text-sm text-up font-semibold">ZK proofs generated</p>
        </div>

        {/* Commitment / Nullifier */}
        <div className="space-y-2 p-3 bg-fg/[0.04] rounded-lg border border-hairline/15">
          <Field label="Commitment (Poseidon hash)" value={proofs.commitment} />
          <Field label="Nullifier" value={proofs.nullifier} />
          <Field label="Price commitment" value={String(proofs.priceCommitment)} />
        </div>

        {/* The 3 Groth16 proofs, expandable */}
        <ProofPanel
          title="1 · OrderCommitment proof"
          proof={proofs.orderProof as unknown as Record<string, unknown>}
          publicSignals={proofs.orderPublicSignals}
        />
        <ProofPanel
          title="2 · BalanceProof"
          proof={proofs.balanceProof as unknown as Record<string, unknown>}
          publicSignals={proofs.balancePublicSignals}
        />
        <ProofPanel
          title="3 · RangeProof"
          proof={proofs.rangeProof as unknown as Record<string, unknown>}
          publicSignals={proofs.rangePublicSignals}
        />
      </div>
    );
  }

  return null;
}
