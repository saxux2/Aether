'use client';

import { useEffect, useState } from 'react';

/**
 * True below `breakpointPx`, false at/above it, null until the client mounts
 * (SSR has no viewport to measure — callers should treat null as "unknown").
 */
export function useIsMobile(breakpointPx = 768): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [breakpointPx]);

  return isMobile;
}
