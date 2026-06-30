"use client"

import { useState } from "react"
import Link from "next/link"
import { useWallet } from "@/hooks/useWallet"

const NAV_LINKS = [
  { label: "Trade",     href: "/trade" },
  { label: "My Orders", href: "/orders" },
  { label: "Portfolio", href: "/portfolio" },
]

const NAV_STYLE = {
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  background: "rgba(245,244,240,0.30)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.06)",
} as const

const BTN_CLASS =
  "text-[11px] px-4 py-2 rounded-xl border border-black/10 text-black/60 hover:text-black hover:border-black/20 hover:bg-black/[0.03] transition-all duration-200 tracking-wide"

// Connect / disconnect wallet — replaces the original "START BUILDING" CTA
function WalletNavButton({ full = false }: { full?: boolean }) {
  const { address, connected, connecting, error, connect, disconnect } = useWallet()
  const width = full ? "w-full " : ""

  if (connected && address) {
    return (
      <button
        onClick={disconnect}
        title="Disconnect wallet"
        className={`${width}${BTN_CLASS}`}
        style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      >
        <span>DISCONNECT WALLET</span>
      </button>
    )
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      title={error ?? undefined}
      className={`${width}${BTN_CLASS} disabled:opacity-60`}
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      {connecting ? "CONNECTING…" : "CONNECT WALLET"}
    </button>
  )
}

export function MobileNav() {
  const [open, setOpen] = useState(false)

  const close = () => setOpen(false)

  return (
    <div className="fixed top-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-3xl">

        {/* Main bar */}
        <nav
          className="flex items-center justify-between px-5 py-3 rounded-2xl border border-black/[0.06]"
          style={NAV_STYLE}
        >
          <Link href="/" className="font-pixel text-xs tracking-[0.25em] text-black/70">AETHER</Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-7" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
            {NAV_LINKS.map(l => (
              <Link
                key={l.label}
                href={l.href}
                className="text-[11px] text-black/60 hover:text-black transition-colors duration-200 tracking-wide"
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <WalletNavButton />
            </div>

            {/* Burger — mobile only */}
            <button
              onClick={() => setOpen(v => !v)}
              className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px] rounded-lg hover:bg-black/[0.04] transition-colors"
              aria-label={open ? "Close menu" : "Open menu"}
            >
              <span
                className="block h-px bg-black/60 transition-all duration-300 origin-center"
                style={{
                  width: "18px",
                  transform: open ? "translateY(6px) rotate(45deg)" : "none",
                }}
              />
              <span
                className="block h-px bg-black/60 transition-all duration-300"
                style={{
                  width: "18px",
                  opacity: open ? 0 : 1,
                  transform: open ? "scaleX(0)" : "none",
                }}
              />
              <span
                className="block h-px bg-black/60 transition-all duration-300 origin-center"
                style={{
                  width: "18px",
                  transform: open ? "translateY(-6px) rotate(-45deg)" : "none",
                }}
              />
            </button>
          </div>
        </nav>

        {/* Mobile dropdown */}
        <div
          className="md:hidden mt-2 overflow-hidden transition-all duration-300 ease-in-out"
          style={{ maxHeight: open ? "320px" : "0px", opacity: open ? 1 : 0 }}
        >
          <div
            className="rounded-2xl border border-black/[0.06] px-2 py-2 flex flex-col"
            style={NAV_STYLE}
          >
            {NAV_LINKS.map(l => (
              <Link
                key={l.label}
                href={l.href}
                onClick={close}
                className="px-4 py-3 text-sm text-black/60 hover:text-black hover:bg-black/[0.03] rounded-xl transition-colors tracking-wide"
                style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-1 px-2 pb-1">
              <WalletNavButton full />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
