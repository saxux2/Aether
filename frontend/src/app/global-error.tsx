'use client';

import { useEffect } from 'react';

/**
 * Root-layout error boundary. error.tsx only catches errors thrown below the
 * root layout — a crash in layout.tsx itself (or anything it renders
 * directly) needs this separate boundary, which must render its own
 * <html>/<body> since the root layout that would normally provide them is
 * exactly what's failing.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Aether] Unhandled root layout error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '1.5rem',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
            background: '#0a0a0a',
            color: '#e5e5e5',
          }}
        >
          <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>
            Aether failed to load.
          </p>
          <p style={{ maxWidth: '28rem', fontSize: '0.75rem', color: 'rgba(229,229,229,0.5)' }}>
            No funds or open orders are affected — this is a display error. Reloading usually fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              borderRadius: '0.5rem',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '0.5rem 1rem',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'rgba(229,229,229,0.8)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
