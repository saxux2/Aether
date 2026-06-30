"use client"

import { useEffect, useState, useRef } from "react"

const ORDER_HANDLES = [
  "buy-7f2a", "sell-3b1c", "buy-9d4e", "sell-2c8f",
  "buy-5a3d", "sell-1e9b", "buy-4f2c", "sell-8d1a",
  "buy-6b3e", "sell-0c7f",
]

const DETAILS = [
  "500 XLM @ $0.135 — sealed",
  "1,200 XLM @ $0.134 — sealed",
  "320 XLM @ $0.136 — crossing",
  "2,400 XLM @ $0.135 — matched",
  "880 XLM @ $0.133 — sealed",
  "150 XLM @ $0.137 — batched",
  "640 XLM @ $0.135 — settled",
  "3,100 XLM @ $0.134 — matched",
  "210 XLM @ $0.136 — sealed",
  "1,750 XLM @ $0.135 — crossing",
  "95 XLM @ $0.133 — batched",
  "560 XLM @ $0.135 — settled",
  "1,020 XLM @ $0.134 — matched",
  "430 XLM @ $0.136 — sealed",
]

const PRICES = ["$0.133", "$0.134", "$0.135", "$0.136", "$0.137"]
const STATUSES = [
  { label: "sealed",  color: "#4ade80" },
  { label: "sealed",  color: "#4ade80" },
  { label: "matched", color: "#4ade80" },
  { label: "batched", color: "#facc15" },
  { label: "settled", color: "#60a5fa" },
]

type OrderRow = {
  id: string
  name: string
  task: string
  region: string
  status: typeof STATUSES[number]
  progress: number
  elapsed: string
  key: number
}

function randomRow(key: number): OrderRow {
  return {
    id: Math.random().toString(36).slice(2, 8).toUpperCase(),
    name: ORDER_HANDLES[Math.floor(Math.random() * ORDER_HANDLES.length)],
    task: DETAILS[Math.floor(Math.random() * DETAILS.length)],
    region: PRICES[Math.floor(Math.random() * PRICES.length)],
    status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
    progress: Math.floor(Math.random() * 85 + 10),
    elapsed: `${Math.floor(Math.random() * 14 + 1)}m ${Math.floor(Math.random() * 59)}s`,
    key,
  }
}

// Animated progress bar that slowly ticks forward (fill progress toward settlement)
function ProgressBar({ initial }: { initial: number }) {
  const [pct, setPct] = useState(initial)
  const rafRef = useRef<number>(0)
  const pctRef = useRef(initial)

  useEffect(() => {
    const tick = () => {
      pctRef.current = Math.min(99, pctRef.current + 0.015)
      setPct(Math.round(pctRef.current))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div style={{ width: "100%", height: 2, background: "rgba(0,0,0,0.08)", borderRadius: 9 }}>
      <div style={{
        height: "100%", borderRadius: 9,
        width: `${pct}%`,
        background: "rgba(0,0,0,0.35)",
        transition: "width 0.5s linear",
      }} />
    </div>
  )
}

// Stable seed rows — same on server and client, no random values
const SEED_ROWS: OrderRow[] = [
  { id: "A1B2C3", name: "buy-7f2a",  task: "500 XLM @ $0.135 — sealed",     region: "$0.135", status: STATUSES[0], progress: 42, elapsed: "0m 12s", key: 0 },
  { id: "D4E5F6", name: "sell-3b1c", task: "1,200 XLM @ $0.134 — matched",  region: "$0.134", status: STATUSES[2], progress: 67, elapsed: "0m 48s", key: 1 },
  { id: "G7H8I9", name: "buy-2c8f",  task: "320 XLM @ $0.136 — batched",    region: "$0.136", status: STATUSES[3], progress: 18, elapsed: "1m 05s", key: 2 },
  { id: "J0K1L2", name: "sell-5a3d", task: "880 XLM @ $0.133 — sealed",     region: "$0.133", status: STATUSES[0], progress: 55, elapsed: "0m 30s", key: 3 },
  { id: "M3N4O5", name: "buy-8d1a",  task: "3,100 XLM @ $0.135 — matched",  region: "$0.135", status: STATUSES[2], progress: 80, elapsed: "0m 22s", key: 4 },
  { id: "P6Q7R8", name: "sell-9d4e", task: "640 XLM @ $0.135 — settled",    region: "$0.135", status: STATUSES[4], progress: 99, elapsed: "1m 01s", key: 5 },
]

export function LiveAgentFeed() {
  const [rows, setRows] = useState<OrderRow[]>(SEED_ROWS)
  const keyRef = useRef(100)

  useEffect(() => {
    // Hydrate with random data only after client mount
    setRows(Array.from({ length: 6 }, (_, i) => randomRow(i)))

    const t = setInterval(() => {
      keyRef.current++
      setRows(prev => [...prev.slice(1), randomRow(keyRef.current)])
    }, 2800)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{
      border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 16,
      overflow: "hidden",
      background: "rgba(255,255,255,0.7)",
    }}>
      {/* Table header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "80px 1fr 80px 70px",
        padding: "8px 16px",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        background: "rgba(0,0,0,0.03)",
      }}>
        {["ORDER", "DETAIL", "PRICE", "STATUS"].map(h => (
          <span key={h} style={{ fontSize: 8, letterSpacing: "0.16em", color: "rgba(0,0,0,0.30)", fontFamily: "monospace" }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ overflow: "hidden" }}>
        {rows.map((row, i) => (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "80px 1fr 80px 70px",
              padding: "10px 16px",
              borderBottom: "1px solid rgba(0,0,0,0.04)",
              gap: 8,
              alignItems: "center",
              animation: i === rows.length - 1 ? "rowSlideIn 0.4s cubic-bezier(0.16,1,0.3,1) both" : "none",
            }}
          >
            {/* Order handle */}
            <div>
              <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(0,0,0,0.65)", marginBottom: 1 }}>{row.name}</div>
              <div style={{ fontSize: 7.5, fontFamily: "monospace", color: "rgba(0,0,0,0.25)" }}>#{row.id}</div>
            </div>

            {/* Detail + progress */}
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 9, color: "rgba(0,0,0,0.50)", lineHeight: 1.35, marginBottom: 5,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{row.task}</div>
              <ProgressBar initial={row.progress} />
            </div>

            {/* Price */}
            <div style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(0,0,0,0.30)" }}>{row.region}</div>

            {/* Status */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: row.status.color,
                boxShadow: row.status.label === "sealed" ? `0 0 6px ${row.status.color}` : "none",
                animation: row.status.label === "sealed" ? "statusPulse 2s ease-in-out infinite" : "none",
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(0,0,0,0.35)" }}>{row.status.label}</span>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes rowSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

export function LiveAgentCounter() {
  const [count, setCount] = useState(3847)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const t = setInterval(() => {
      setCount(v => v + Math.floor(Math.random() * 3 - 1))
    }, 1200)
    return () => clearInterval(t)
  }, [])

  return (
    <span style={{
      fontFamily: "monospace",
      fontSize: "clamp(3rem, 6vw, 5rem)",
      fontWeight: 300,
      color: "rgba(0,0,0,0.85)",
      lineHeight: 1,
      letterSpacing: "-0.02em",
      transition: "color 0.3s ease",
    }}>
      {mounted ? count.toLocaleString("en-US") : "3,847"}
    </span>
  )
}
