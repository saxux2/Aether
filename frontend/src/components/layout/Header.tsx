'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { WalletConnect } from '@/components/WalletConnect';

const links = [
  { href: '/trade',     label: 'Trade' },
  { href: '/orders',    label: 'My Orders' },
  { href: '/portfolio', label: 'Portfolio' },
];

export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header
      className="relative h-14 bg-page/80 border-b border-hairline/10 flex items-center px-3 sm:px-6 sticky top-0 z-20"
      style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
    >
      <div className="flex-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          className="md:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-fg/60 hover:text-fg hover:bg-fg/[0.05] transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        <Link href="/" className="flex items-center gap-2 whitespace-nowrap sm:ml-4">
          <Image src="/logo.png" alt="Aether" width={30} height={30} />
          <span className="text-[16px] font-semibold tracking-tight text-fg">Aether</span>
        </Link>
      </div>

      <nav className="hidden md:flex items-center gap-1 text-sm h-full" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {links.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`relative h-full flex items-center px-3 text-[13px] transition-colors ${
                active ? 'text-fg font-medium' : 'text-fg/50 hover:text-fg'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 flex items-center justify-end gap-3">
        <WalletConnect />
      </div>

      {menuOpen && (
        <nav
          className="absolute inset-x-0 top-full flex flex-col border-b border-hairline/10 bg-page py-2 shadow-lg md:hidden"
          style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        >
          {links.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`px-5 py-3 text-sm transition-colors ${
                  active ? 'text-fg font-medium bg-fg/[0.05]' : 'text-fg/55 hover:text-fg hover:bg-fg/[0.05]'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
