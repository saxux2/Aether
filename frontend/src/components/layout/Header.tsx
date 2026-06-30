'use client';

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

  return (
    <header
      className="h-14 bg-page/80 border-b border-hairline/10 flex items-center px-6 sticky top-0 z-20"
      style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
    >
      <div className="flex-1">
        <Link href="/" className="flex items-center whitespace-nowrap ml-4">
          <Image src="/logo.png" alt="Aether" width={36} height={36} />
        </Link>
      </div>

      <nav className="flex items-center gap-1 text-sm h-full" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
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
    </header>
  );
}
