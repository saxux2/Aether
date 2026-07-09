'use client';

import { useEffect } from 'react';

/**
 * Route-segment error boundary — catches a thrown error anywhere under this
 * layout (e.g. a malformed relayer response hitting an unguarded field
 * access) and renders a recoverable fallback instead of leaving the user on
 * a blank page. Next.js requires this file to be a Client Component.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Aether] Unhandled route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium text-fg/80">Something went wrong loading this page.</p>
      <p className="max-w-md text-xs text-fg/50">
        No funds or open orders are affected — this is a display error. Try again, or reload the page.
      </p>
      <button
        onClick={reset}
        className="rounded-lg border border-hairline/15 px-4 py-2 text-xs font-medium text-fg/80 transition-all duration-200 hover:border-hairline/25 hover:bg-fg/[0.05] hover:text-fg"
      >
        Try again
      </button>
    </div>
  );
}
