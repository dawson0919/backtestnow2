'use client'

import React, { useEffect, useState, useMemo, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { parsePineScript, generateUpdatedCode } from '@/lib/pinescript-parser'

interface MonthlyPnL {
  year: number; month: number; key: string
  trades: number; winTrades: number
  pnlPct: number; pnlDollars: number; pointsMove: number
}

interface TradeSummary {
  entryTs:    number
  exitTs:     number
  entry:      number
  exit:       number
  pnlPct:     number
  pnlDollars: number
  direction?: 'long' | 'short'
}

interface OptHist {
  id: string
  asset: string
  timeframe: string
  code?: string
  net_profit_pct: string
  asset_type: 'crypto' | 'futures'
  point_value: number
  total_return_pct: number | null
  max_drawdown_pct: number | null
  sharpe_ratio: number | null
  win_rate: number | null
  profit_factor: number | null
  total_trades: number | null
  total_dollar_pnl: number | null
  monthly_pnl: MonthlyPnL[] | null
  trades_summary: TradeSummary[] | null
  top_params: Record<string, number | string>
  project_name: string
  created_at: string
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']


function EquityCurve({
  trades, isFutures, pnlMode,
}: {
  trades: TradeSummary[]; isFutures: boolean; pnlMode: 'pct' | 'dollars'
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  if (trades.length < 2) return (
    <div className="h-56 flex items-center justify-center text-slate-600 text-sm">無交易紀錄資料</div>
  )

  const sorted = [...trades].sort((a, b) => a.exitTs - b.exitTs)
  let cum = 0
  const pts: { ts: number; cum: number }[] = [{ ts: sorted[0].entryTs, cum: 0 }]
  sorted.forEach(t => {
    cum += isFutures && pnlMode === 'dollars' ? t.pnlDollars : t.pnlPct
    pts.push({ ts: t.exitTs, cum })
  })

  const cums   = pts.map(p => p.cum)
  const minC   = Math.min(...cums, 0)
  const maxC   = Math.max(...cums, 0)
  const range  = maxC - minC || 1
  const W = 1000, H = 300, PL = 72, PR = 90, PT = 20, PB = 36
  const cW = W - PL - PR, cH = H - PT - PB
  const toX = (ts: number) => PL + ((ts - pts[0].ts) / ((pts[pts.length - 1].ts - pts[0].ts) || 1)) * cW
  const toY = (v: number)  => PT + cH - ((v - minC) / range) * cH
  const zeroY   = toY(0)
  const finalV  = pts[pts.length - 1].cum
  const isPos   = finalV >= 0
  const color   = isPos ? '#10b981' : '#ef4444'
  const pathD   = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.ts).toFixed(1)},${toY(p.cum).toFixed(1)}`).join(' ')
  const fillD   = `${pathD} L${toX(pts[pts.length-1].ts).toFixed(1)},${zeroY.toFixed(1)} L${toX(pts[0].ts).toFixed(1)},${zeroY.toFixed(1)}Z`

  // Y-axis grid: 5 lines
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: minC + f * range, y: toY(minC + f * range) }))
  // X-axis: up to 7 labels, deduplicated
  const xIdxs  = Array.from(new Set(Array.from({ length: 7 }, (_, i) => Math.round(i * (pts.length - 1) / 6))))
  const fmt    = (v: number) => isFutures && pnlMode === 'dollars'
    ? (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`)
    : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  function handleMouseMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * W
    const rawIdx = (relX - PL) / cW * (pts.length - 1)
    const idx = Math.max(0, Math.min(pts.length - 1, Math.round(rawIdx)))
    setHoverIdx(idx)
  }

  const hp = hoverIdx !== null ? pts[hoverIdx] : null
  const hx = hp ? toX(hp.ts) : 0
  const hy = hp ? toY(hp.cum) : 0
  const hDate = hp ? new Date(hp.ts) : null
  const hLabel = hDate
    ? `${hDate.getFullYear()}/${String(hDate.getMonth()+1).padStart(2,'0')}/${String(hDate.getDate()).padStart(2,'0')}`
    : ''
  // Tooltip box position: flip to left side when near right edge
  const tipW = 120, tipH = 44
  const tipX = hp ? (hx + tipW + 10 > W - PR ? hx - tipW - 10 : hx + 10) : 0
  const tipY = hp ? Math.max(PT, Math.min(hy - tipH / 2, PT + cH - tipH)) : 0

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 300 }}>
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
        <clipPath id="eqClip"><rect x={PL} y={PT} width={cW} height={cH} /></clipPath>
      </defs>

      {/* Y grid + labels */}
      {yTicks.map(({ v, y }) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={y} y2={y} stroke={Math.abs(v) < 0.001 ? '#2d3439' : '#161b1e'} strokeWidth={Math.abs(v) < 0.001 ? 1.5 : 1} />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#475569">{fmt(v)}</text>
        </g>
      ))}

      {/* Fill + line clipped to chart area */}
      <g clipPath="url(#eqClip)">
        <path d={fillD} fill="url(#eqGrad)" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </g>

      {/* Final value badge */}
      <rect x={W - PR + 6} y={Math.min(Math.max(toY(finalV) - 11, PT), PT + cH - 22)} width={PR - 10} height={22} rx="4" fill={color} />
      <text x={W - PR + 6 + (PR - 10) / 2} y={Math.min(Math.max(toY(finalV) - 11, PT), PT + cH - 22) + 15}
        textAnchor="middle" fontSize="11" fontWeight="bold" fill="white">
        {fmt(finalV)}
      </text>

      {/* X-axis dates */}
      {xIdxs.map((idx, i) => {
        const p = pts[idx]
        const d = new Date(p.ts)
        const label = idx === 0 || d.getMonth() === 0
          ? `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`
          : `${String(d.getMonth() + 1).padStart(2, '0')}月`
        return (
          <text key={i} x={toX(p.ts)} y={H - 6} textAnchor="middle" fontSize="10" fill="#475569">{label}</text>
        )
      })}

      {/* Hover crosshair + tooltip */}
      {hp && (
        <g>
          {/* Vertical crosshair */}
          <line x1={hx} x2={hx} y1={PT} y2={PT + cH} stroke="#475569" strokeWidth="1" strokeDasharray="4 3" />
          {/* Dot on curve */}
          <circle cx={hx} cy={hy} r="4" fill={color} stroke="#0a0d0f" strokeWidth="2" />
          {/* Tooltip box */}
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="5" fill="#1e2227" stroke="#2d3439" strokeWidth="1" />
          <text x={tipX + tipW / 2} y={tipY + 14} textAnchor="middle" fontSize="10" fill="#94a3b8">{hLabel}</text>
          <text x={tipX + tipW / 2} y={tipY + 32} textAnchor="middle" fontSize="13" fontWeight="bold"
            fill={hp.cum >= 0 ? '#10b981' : '#ef4444'}>
            {fmt(hp.cum)}
          </text>
        </g>
      )}

      {/* Transparent overlay for mouse tracking */}
      <rect
        x={PL} y={PT} width={cW} height={cH}
        fill="transparent"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ cursor: 'crosshair' }}
      />
    </svg>
  )
}

function HistoryContent() {
  const searchParams = useSearchParams()
  const [records, setRecords]     = useState<OptHist[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<OptHist | null>(null)
  const [showCode, setShowCode]   = useState(false)
  const [chartView, setChartView] = useState<'monthly'|'cumulative'>('monthly')
  const [pnlMode, setPnlMode]     = useState<'pct'|'dollars'>('pct')
  const [tradeSort, setTradeSort]           = useState<'seq'|'pnl'>('seq')
  const [showAllTrades, setShowAllTrades]   = useState(false)
  // Category nav
  const [catTab, setCatTab]                 = useState<'all'|'project'|'asset'|'type'>('all')
  const [catValue, setCatValue]             = useState<string>('')
  const [deletingId, setDeletingId]         = useState<string | null>(null)
  const [searchQ, setSearchQ]               = useState('')

  useEffect(() => { fetchHistory() }, [])

  async function fetchHistory() {
    setLoading(true)
    try {
      const res  = await fetch('/api/save-result?limit=100')
      const json = await res.json() as { records: OptHist[] }
      const data = json.records || []
      setRecords(data)
      const targetId      = searchParams.get('id')
      const targetProject = searchParams.get('project')
      if (targetId) {
        const found = data.find(r => r.id === targetId)
        setSelected(found ?? data[0] ?? null)
      } else if (targetProject) {
        setCatTab('project')
        setCatValue(targetProject)
        const first = data.find(r => (r.project_name || '未命名專案') === targetProject)
        setSelected(first ?? data[0] ?? null)
      } else if (data.length > 0) {
        setSelected(data[0])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function deleteRecord(id: string) {
    if (!confirm('確定要刪除這筆優化記錄嗎？')) return
    setDeletingId(id)
    try {
      await fetch(`/api/save-result?id=${id}`, { method: 'DELETE' })
      setRecords(prev => prev.filter(r => r.id !== id))
      if (selected?.id === id) setSelected(null)
    } catch { /* ignore */ }
    setDeletingId(null)
  }

  // ── Monthly data for chart ────────────────────────────────────────────────
  const monthlyData: MonthlyPnL[] = useMemo(() => {
    if (!selected?.monthly_pnl?.length) return []
    return selected.monthly_pnl
  }, [selected])

  const isFutures   = (selected?.asset_type ?? 'crypto') === 'futures'
  const maxAbsVal   = Math.max(...monthlyData.map(m => Math.abs(isFutures ? m.pnlDollars : m.pnlPct)), 0.01)

  // Build cumulative equity curve from monthly data
  const cumulativeData = useMemo(() => {
    let cum = 0
    return monthlyData.map(m => {
      cum += isFutures ? m.pnlDollars : m.pnlPct
      return { ...m, cumulative: cum }
    })
  }, [monthlyData, isFutures])
  const maxCumAbs = Math.max(...cumulativeData.map(m => Math.abs(m.cumulative)), 0.01)

  // ── Detailed trade stats computed from trades_summary ─────────────────────
  const detailedStats = useMemo(() => {
    const trades = selected?.trades_summary ?? []
    const wins   = trades.filter(t => t.pnlPct > 0)
    const losses = trades.filter(t => t.pnlPct < 0)
    const grossProfit   = wins.reduce((s, t) => s + t.pnlPct, 0)
    const grossLoss     = losses.reduce((s, t) => s + Math.abs(t.pnlPct), 0)
    const avgWin        = wins.length   > 0 ? grossProfit / wins.length   : 0
    const avgLoss       = losses.length > 0 ? grossLoss   / losses.length : 0
    const maxWin        = trades.length > 0 ? Math.max(...trades.map(t => t.pnlPct))     : 0
    const maxLoss       = trades.length > 0 ? Math.min(...trades.map(t => t.pnlPct))     : 0
    const maxWinDollar  = trades.length > 0 ? Math.max(...trades.map(t => t.pnlDollars)) : 0
    const maxLossDollar = trades.length > 0 ? Math.min(...trades.map(t => t.pnlDollars)) : 0
    const avgDurationMs = trades.length > 0
      ? trades.reduce((s, t) => s + (t.exitTs - t.entryTs), 0) / trades.length : 0
    const timeStart = trades.length > 0 ? new Date(Math.min(...trades.map(t => t.entryTs))) : null
    const timeEnd   = trades.length > 0 ? new Date(Math.max(...trades.map(t => t.exitTs)))  : null
    return {
      count: trades.length, wins: wins.length, losses: losses.length,
      grossProfit, grossLoss,
      avgPnl: trades.length > 0 ? (grossProfit - grossLoss) / trades.length : 0,
      avgWin, avgLoss,
      winLossRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
      maxWin, maxLoss, maxWinDollar, maxLossDollar,
      largestWinPct: grossProfit > 0 ? (maxWin / grossProfit) * 100 : 0,
      avgDurationMs, timeStart, timeEnd,
    }
  }, [selected])

  // ── Param comparison ──────────────────────────────────────────────────────
  const comparison = useMemo(() => {
    if (!selected?.top_params) return []
    return Object.entries(selected.top_params).map(([param, optimized]) => {
      const original   = typeof optimized === 'number' ? Math.round(Number(optimized) * 1.5) : optimized
      const improvement = typeof optimized === 'number' && typeof original === 'number'
        ? `${(((Number(optimized) - Number(original)) / (Number(original) || 1)) * 100).toFixed(1)}%`
        : 'New'
      return { param, original: String(original), optimized: String(optimized), improvement }
    })
  }, [selected])

  // ── Category groups for sidebar ───────────────────────────────────────────
  const catGroups = useMemo(() => {
    if (catTab === 'all') return []
    const key = catTab === 'project' ? 'project_name' : catTab === 'asset' ? 'asset' : 'asset_type'
    const counts: Record<string, number> = {}
    records.forEach(r => {
      const v = String((r as unknown as Record<string, unknown>)[key] || '未命名專案')
      counts[v] = (counts[v] || 0) + 1
    })
    return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  }, [records, catTab])

  const filteredRecords = useMemo(() => {
    let base = records
    if (catTab !== 'all' && catValue) {
      const key = catTab === 'project' ? 'project_name' : catTab === 'asset' ? 'asset' : 'asset_type'
      base = base.filter(r => {
        const v = String((r as unknown as Record<string, unknown>)[key] || '未命名專案')
        return v === catValue
      })
    }
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase()
      base = base.filter(r =>
        (r.project_name || '未命名專案').toLowerCase().includes(q) ||
        r.asset.toLowerCase().includes(q) ||
        r.timeframe.toLowerCase().includes(q)
      )
    }
    return base
  }, [records, catTab, catValue, searchQ])

  function fmtPnl(m: MonthlyPnL) {
    if (isFutures && pnlMode === 'dollars') {
      const v = m.pnlDollars
      return `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    }
    const v = m.pnlPct
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  }

  function fmtCum(v: number) {
    if (isFutures && pnlMode === 'dollars') {
      return `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    }
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  }

  // Apply optimized top_params back into the original code so the user gets
  // an immediately usable PineScript with the best parameter values embedded.
  const displayedCode = useMemo(() => {
    if (!selected?.code) return ''
    if (!selected.top_params || Object.keys(selected.top_params).length === 0) return selected.code
    const parsed = parsePineScript(selected.code)
    return generateUpdatedCode(selected.code, parsed.params, selected.top_params)
  }, [selected])

  // ── Buy & Hold comparison ──────────────────────────────────────────────────
  const buyAndHold = useMemo(() => {
    const trades = selected?.trades_summary ?? []
    if (trades.length < 2) return null
    const sortedByEntry = [...trades].sort((a, b) => a.entryTs - b.entryTs)
    const sortedByExit  = [...trades].sort((a, b) => b.exitTs - a.exitTs)
    const firstEntry = sortedByEntry[0].entry
    const lastExit   = sortedByExit[0].exit
    if (!firstEntry || firstEntry === 0) return null
    return ((lastExit - firstEntry) / firstEntry) * 100
  }, [selected])

  // ── CSV export ─────────────────────────────────────────────────────────────
  function exportCSV() {
    const trades = selected?.trades_summary ?? []
    if (trades.length === 0) return
    const isFut = selected?.asset_type === 'futures'
    const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs)
    const fmtDate = (ts: number) =>
      new Date(ts).toISOString().replace('T', ' ').slice(0, 19)
    const headers = ['#', '方向', '進場時間', '進場價', '出場時間', '出場價', '損益%', ...(isFut ? ['損益$'] : []), '持倉時間(h)', '結果']
    const rows = sorted.map((t, i) => {
      const durH = Math.round((t.exitTs - t.entryTs) / 3600000)
      return [
        i + 1,
        t.direction === 'short' ? '做空' : '做多',
        fmtDate(t.entryTs),
        t.entry,
        fmtDate(t.exitTs),
        t.exit,
        t.pnlPct.toFixed(4),
        ...(isFut ? [t.pnlDollars.toFixed(2)] : []),
        durH,
        t.pnlPct > 0 ? '獲利' : '虧損',
      ]
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `${selected?.asset ?? 'trades'}_${selected?.timeframe ?? ''}_trades.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-full bg-[#080a0c]" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ── Sticky Header ──────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-[#2d3439] bg-[#0a0d0f]/90 backdrop-blur px-6 lg:px-10 py-4">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-[#161b1e] border border-[#2d3439] rounded-lg">
              <span className="material-symbols-outlined text-[#3b82f6]">analytics</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                {selected ? (selected.project_name || `${selected.asset} — ${selected.timeframe}`) : '優化報告'}
              </h1>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">
                {selected?.asset_type === 'futures' ? '期貨 · 點值損益' : '加密貨幣 · % 回報'}
                {' '} · {records.length} 次優化記錄
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {selected && isFutures && (
              <div className="flex items-center gap-1 bg-[#161b1e] border border-[#2d3439] rounded-lg p-1">
                <button onClick={() => setPnlMode('pct')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${pnlMode==='pct' ? 'bg-[#2d3439] text-white' : 'text-slate-500'}`}>% 波動</button>
                <button onClick={() => setPnlMode('dollars')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${pnlMode==='dollars' ? 'bg-[#2d3439] text-white' : 'text-slate-500'}`}>$ 損益</button>
              </div>
            )}
            <button onClick={() => selected && setShowCode(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#161b1e] hover:bg-[#1e2227] border border-[#2d3439] rounded-lg text-sm font-bold text-slate-300 transition-colors">
              <span className="material-symbols-outlined text-[16px]">terminal</span>
              匯出腳本
            </button>
            <Link href="/dashboard/backtest"
              className="flex items-center gap-2 px-4 py-2 bg-[#3b82f6] hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/30">
              <span className="material-symbols-outlined text-[16px]">add</span>
              新增回測
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 lg:p-10 space-y-8">

        {/* ── Equity Curve ─────────────────────────────────────────────── */}
        <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl overflow-hidden">
          {/* TradingView-style summary bar */}
          <div className="px-6 py-4 border-b border-[#2d3439]">
            {selected ? (
              <>
                <p className="text-sm font-bold text-white mb-3">
                  {selected.project_name || selected.asset} · {selected.timeframe}
                  {detailedStats.timeStart && (
                    <span className="ml-3 text-xs font-normal text-slate-500">
                      {detailedStats.timeStart.toLocaleDateString('zh-TW')} — {detailedStats.timeEnd?.toLocaleDateString('zh-TW')}
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-8">
                  {(() => {
                    const totalReturn = selected.total_return_pct ?? parseFloat(selected.net_profit_pct || '0')
                    const winCount = detailedStats.count > 0
                      ? detailedStats.wins
                      : (selected.total_trades && selected.win_rate ? Math.round(selected.total_trades * (selected.win_rate / 100)) : null)
                    return [
                      {
                        label: '總損益',
                        value: isFutures && selected.total_dollar_pnl != null
                          ? `${selected.total_dollar_pnl >= 0 ? '+' : ''}$${Math.abs(selected.total_dollar_pnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                          : `${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`,
                        color: totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400',
                      },
                      {
                        label: '最大資產回撤',
                        value: selected.max_drawdown_pct != null ? `-${selected.max_drawdown_pct.toFixed(2)}%` : '—',
                        color: 'text-red-400',
                      },
                      {
                        label: '總交易量',
                        value: String(selected.total_trades ?? '—'),
                        color: 'text-white',
                      },
                      {
                        label: '獲利交易',
                        value: selected.win_rate != null
                          ? `${selected.win_rate.toFixed(2)}%  ${winCount ?? ''}/${selected.total_trades ?? ''}`
                          : '—',
                        color: 'text-white',
                      },
                      {
                        label: '獲利因子',
                        value: selected.profit_factor?.toFixed(3) ?? (detailedStats.grossLoss > 0 ? (detailedStats.grossProfit / detailedStats.grossLoss).toFixed(3) : '—'),
                        color: 'text-white',
                      },
                      ...(buyAndHold !== null ? [{
                        label: 'Buy & Hold',
                        value: `${buyAndHold >= 0 ? '+' : ''}${buyAndHold.toFixed(2)}%`,
                        color: buyAndHold >= 0 ? 'text-slate-400' : 'text-slate-400',
                      }] : []),
                    ].map(item => (
                      <div key={item.label}>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{item.label}</p>
                        <p className={`text-base font-black mt-0.5 ${item.color}`}>{item.value}</p>
                      </div>
                    ))
                  })()}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">選取下方記錄以查看股票圖表</p>
            )}
          </div>
          {/* Chart area */}
          <div className="px-4 py-4">
            {selected?.trades_summary && selected.trades_summary.length >= 2 ? (
              <EquityCurve
                trades={selected.trades_summary}
                isFutures={isFutures}
                pnlMode={pnlMode}
              />
            ) : (
              <div className="h-56 flex items-center justify-center text-slate-600 text-sm">
                {selected ? '此記錄無交易資料可繪製圖表' : '—'}
              </div>
            )}
          </div>
        </section>

        {/* ── Detailed Report ──────────────────────────────────────────── */}
        <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#2d3439] flex items-center gap-3">
            <span className="material-symbols-outlined text-[#3b82f6] text-[20px]">bar_chart_4_bars</span>
            <div>
              <h2 className="text-base font-bold text-white">詳細回測報告</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selected
                  ? `${selected.asset} · ${selected.timeframe} · ${selected.project_name || '未命名專案'}`
                  : '選取下方記錄以查看詳細數據'}
                {detailedStats.timeStart && (
                  <span className="ml-2 text-slate-600">
                    {detailedStats.timeStart.toLocaleDateString('zh-TW')} — {detailedStats.timeEnd?.toLocaleDateString('zh-TW')}
                  </span>
                )}
              </p>
            </div>
          </div>

          {!selected ? (
            <div className="p-12 text-center text-slate-500">
              <span className="material-symbols-outlined text-5xl block mb-3">analytics</span>
              <p className="text-sm">點選下方記錄以查看完整回測指標</p>
            </div>
          ) : (() => {
            const s = selected
            const totalReturn = s.total_return_pct ?? parseFloat(s.net_profit_pct || '0')
            const ds = detailedStats
            const hasTrades = ds.count > 0
            const winCount  = hasTrades ? ds.wins : (s.total_trades && s.win_rate ? Math.round(s.total_trades * (s.win_rate / 100)) : null)
            const lossCount = hasTrades ? ds.losses : (s.total_trades && winCount != null ? s.total_trades - winCount : null)

            type Row = { label: string; value: React.ReactNode; color?: string }
            type Group = { title: string; rows: Row[] }

            const groups: Group[] = [
              {
                title: '期間 & 總覽',
                rows: [
                  ...(ds.timeStart ? [{ label: '回測期間', value: `${ds.timeStart.toLocaleDateString('zh-TW')} — ${ds.timeEnd?.toLocaleDateString('zh-TW')}` }] : []),
                  { label: '總交易次數', value: <span className="font-bold text-white">{s.total_trades ?? ds.count ?? '—'}</span> },
                  { label: '淨利', value: <span className={`font-black ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%{isFutures && s.total_dollar_pnl != null ? <span className="ml-2 font-normal text-xs text-slate-500">${s.total_dollar_pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span> : null}</span> },
                  ...(hasTrades ? [
                    { label: '毛利', value: <span className="font-bold text-emerald-400">+{ds.grossProfit.toFixed(3)}%</span> },
                    { label: '毛損', value: <span className="font-bold text-red-400">-{ds.grossLoss.toFixed(3)}%</span> },
                  ] : []),
                ],
              },
              {
                title: '勝率統計',
                rows: [
                  { label: '獲利交易', value: <span className="font-bold text-emerald-400">{winCount ?? '—'}</span> },
                  { label: '虧損交易', value: <span className="font-bold text-red-400">{lossCount ?? '—'}</span> },
                  { label: '勝率', value: <span className="font-bold text-white">{s.win_rate != null ? `${s.win_rate.toFixed(2)}%` : (hasTrades ? `${((ds.wins / ds.count) * 100).toFixed(2)}%` : '—')}</span> },
                  { label: '獲利因子', value: <span className="font-bold text-white">{s.profit_factor?.toFixed(3) ?? (ds.grossLoss > 0 ? (ds.grossProfit / ds.grossLoss).toFixed(3) : '—')}</span> },
                ],
              },
              ...(hasTrades ? [{
                title: '損益分析',
                rows: [
                  { label: '平均每筆損益', value: <span className={`font-bold ${ds.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{ds.avgPnl >= 0 ? '+' : ''}{ds.avgPnl.toFixed(3)}%</span> },
                  { label: '平均獲利交易', value: <span className="font-bold text-emerald-400">+{ds.avgWin.toFixed(3)}%</span> },
                  { label: '平均虧損交易', value: <span className="font-bold text-red-400">-{ds.avgLoss.toFixed(3)}%</span> },
                  { label: '平均獲利 / 平均虧損', value: <span className="font-bold text-white">{ds.winLossRatio.toFixed(3)}</span> },
                  { label: '最大獲利交易', value: <span className="font-bold text-emerald-400">+{ds.maxWin.toFixed(3)}%{isFutures && ds.maxWinDollar > 0 ? <span className="ml-2 font-normal text-xs text-slate-500">${ds.maxWinDollar.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span> : null}</span> },
                  { label: '最大虧損交易', value: <span className="font-bold text-red-400">{ds.maxLoss.toFixed(3)}%{isFutures && ds.maxLossDollar < 0 ? <span className="ml-2 font-normal text-xs text-slate-500">${ds.maxLossDollar.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span> : null}</span> },
                  { label: '單筆最大獲利佔總獲利比例', value: <span className="text-slate-300">{ds.largestWinPct.toFixed(2)}%</span> },
                  { label: '平均持倉時間', value: (() => { const h = Math.round(ds.avgDurationMs / 3600000); return <span className="font-mono text-xs text-slate-300">{h >= 24 ? `${Math.floor(h / 24)}天 ${h % 24}h` : `${h}h`}</span> })() },
                ] as Row[],
              }] : []),
              {
                title: '風險指標',
                rows: [
                  { label: '最大回撤', value: <span className="font-black text-red-400">{s.max_drawdown_pct != null ? `-${s.max_drawdown_pct.toFixed(2)}%` : '—'}</span> },
                  { label: '夏普比率', value: <span className={`font-black ${(s.sharpe_ratio ?? 0) >= 1 ? 'text-emerald-400' : 'text-yellow-400'}`}>{s.sharpe_ratio?.toFixed(3) ?? '—'}</span> },
                ],
              },
            ]

            return (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#0d1117]">
                      <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-[#2d3439] w-1/2">指標</th>
                      <th className="px-5 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-[#2d3439]">數值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(group => (
                      <React.Fragment key={group.title}>
                        <tr className="bg-[#0d1117]/60">
                          <td colSpan={2} className="px-5 py-2 text-[9px] font-black uppercase tracking-widest text-slate-600">{group.title}</td>
                        </tr>
                        {group.rows.map((row, i) => (
                          <tr key={i} className="border-t border-[#1a1f25] hover:bg-[#161b1e] transition-colors">
                            <td className="px-5 py-3 text-slate-400">{row.label}</td>
                            <td className="px-5 py-3 text-right">{row.value}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </section>

        {/* ── Monthly Net Profit Chart ───────────────────────────────── */}
        <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="text-xl font-bold text-white">損益分析</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                {isFutures
                  ? `期貨 · 每合約（點值 $${selected?.point_value ?? 1}）`
                  : '加密貨幣 · 每次交易週期百分比回報'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[#161b1e] border border-[#2d3439] rounded-lg p-1">
                <button onClick={() => setChartView('monthly')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${chartView==='monthly' ? 'bg-[#2d3439] text-white' : 'text-slate-500'}`}>月度</button>
                <button onClick={() => setChartView('cumulative')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${chartView==='cumulative' ? 'bg-[#2d3439] text-white' : 'text-slate-500'}`}>累積</button>
              </div>
            </div>
          </div>

          {/* Bar Chart */}
          {monthlyData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-600 gap-2">
              <span className="material-symbols-outlined text-[36px]">bar_chart</span>
              <p className="text-sm">此回測紀錄無月度損益資料</p>
              <p className="text-xs">重新執行回測即可生成</p>
            </div>
          ) : (
          <>
          <div className="relative h-72">
            {/* Y-axis */}
            <div className="absolute left-0 top-0 h-full w-14 flex flex-col justify-between text-[10px] text-slate-500 font-mono pointer-events-none pr-2">
              {chartView === 'monthly'
                ? [maxAbsVal, maxAbsVal/2, 0, -maxAbsVal/2, -maxAbsVal].map((v,i) => (
                    <span key={i} className="text-right">{isFutures && pnlMode==='dollars' ? `$${Math.round(v/1000)}k` : `${v.toFixed(0)}%`}</span>
                  ))
                : [maxCumAbs, maxCumAbs/2, 0, -maxCumAbs/2, -maxCumAbs].map((v,i) => (
                    <span key={i} className="text-right">{isFutures && pnlMode==='dollars' ? `$${Math.round(v/1000)}k` : `${v.toFixed(0)}%`}</span>
                  ))
              }
            </div>
            {/* Grid */}
            <div className="absolute inset-0 ml-14 flex flex-col justify-between pointer-events-none">
              {[0,1,2,3,4].map(i => (
                <div key={i} className={`w-full border-t ${i===2 ? 'border-[#2d3439]' : 'border-[#161b1e]'}`} />
              ))}
            </div>
            {/* Bars */}
            <div className="ml-14 h-full flex items-center justify-between gap-1 px-1">
              {(chartView === 'monthly' ? monthlyData : cumulativeData).map((m, i) => {
                const rawVal = chartView === 'monthly'
                  ? (isFutures && pnlMode === 'dollars' ? m.pnlDollars : m.pnlPct)
                  : (isFutures && pnlMode === 'dollars' ? (m as typeof cumulativeData[0]).cumulative : (m as typeof cumulativeData[0]).cumulative)
                const maxV   = chartView === 'monthly' ? maxAbsVal : maxCumAbs
                const isPos  = rawVal >= 0
                const pct    = (Math.abs(rawVal) / maxV) * 44  // 44% of half-height
                const label  = MONTH_LABELS[(m.month - 1) % 12]
                return (
                  <div key={i} title={`${label} ${m.year}: ${fmtPnl(m)}`}
                    className="flex-1 flex flex-col items-center h-full justify-center group">
                    {/* Above zero */}
                    <div className="w-full flex flex-col items-center justify-end" style={{ height: '46%' }}>
                      {isPos && (
                        <div className="w-full max-w-[40px] rounded-t transition-all group-hover:opacity-90"
                          style={{ height: `${pct * 2}%`, background: 'rgba(16,185,129,0.8)', minHeight: isPos ? '3px' : 0 }} />
                      )}
                    </div>
                    {/* Zero line */}
                    <div className="border-t border-[#2d3439] w-full shrink-0" />
                    {/* Below zero */}
                    <div className="w-full flex flex-col items-center justify-start" style={{ height: '46%' }}>
                      {!isPos && (
                        <div className="w-full max-w-[40px] rounded-b"
                          style={{ height: `${pct * 2}%`, background: 'rgba(239,68,68,0.8)', minHeight: 3 }} />
                      )}
                    </div>
                    <p className="mt-2 text-[9px] font-bold text-slate-600 uppercase shrink-0">{label}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Monthly table */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {monthlyData.slice(-6).map((m, i) => {
              const val   = isFutures && pnlMode === 'dollars' ? m.pnlDollars : m.pnlPct
              const isPos = val >= 0
              return (
                <div key={i} className="bg-[#0d1117] rounded-lg p-3 text-center border border-[#1e2227]">
                  <p className="text-[10px] text-slate-500 font-bold">{MONTH_LABELS[m.month-1]} {m.year}</p>
                  <p className={`text-sm font-black mt-1 ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPnl(m)}</p>
                  <p className="text-[9px] text-slate-600 mt-0.5">{m.trades} 次交易 · {m.winTrades} 勝</p>
                </div>
              )
            })}
          </div>
          </>
          )}
        </section>

        {/* ── Trade Records ─────────────────────────────────────────── */}
        {(() => {
          const trades = selected?.trades_summary ?? []
          if (trades.length === 0) return null
          // chronoOrder maps entryTs -> chronological number (#1 = oldest)
          const chronoOrder = new Map<number, number>(
            [...trades].sort((a, b) => a.entryTs - b.entryTs).map((t, i) => [t.entryTs, i + 1])
          )
          const sorted = [...trades].sort((a, b) =>
            tradeSort === 'pnl' ? b.pnlPct - a.pnlPct : b.entryTs - a.entryTs
          )
          const displayed = showAllTrades ? sorted : sorted.slice(0, 20)
          const wins  = trades.filter(t => t.pnlPct > 0).length
          const losses = trades.length - wins
          const grossProfit = trades.filter(t => t.pnlPct > 0).reduce((s, t) => s + t.pnlPct, 0)
          const grossLoss   = trades.filter(t => t.pnlPct < 0).reduce((s, t) => s + Math.abs(t.pnlPct), 0)
          const isFut = (selected?.asset_type ?? 'crypto') === 'futures'

          return (
            <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl overflow-hidden">
              <div className="p-5 border-b border-[#2d3439] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#3b82f6] text-[20px]">receipt_long</span>
                    交易紀錄
                  </h2>
                  <p className="text-slate-500 text-sm mt-0.5">
                    共 {trades.length} 筆交易 · {wins} 勝 / {losses} 敗 · 毛利 +{grossProfit.toFixed(2)}% / 毛損 -{grossLoss.toFixed(2)}%
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-[#161b1e] border border-[#2d3439] rounded-lg p-1">
                    <button onClick={() => setTradeSort('seq')}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${tradeSort==='seq' ? 'bg-[#2d3439] text-white' : 'text-slate-500'}`}>最新優先</button>
                    <button onClick={() => setTradeSort('pnl')}
                      className={`px-3 py-1 rounded text-xs font-bold transition-colors ${tradeSort==='pnl' ? 'bg-[#2d3439] text-white' : 'text-slate-500'}`}>損益排序</button>
                  </div>
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#161b1e] border border-[#2d3439] hover:bg-[#1e2227] text-slate-300 text-xs font-semibold rounded-lg transition-colors"
                    title="匯出 CSV"
                  >
                    <span className="material-symbols-outlined text-[14px]">download</span>
                    CSV
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#0d1117]">
                      {['#', '方向', '進場時間', '出場時間', '進場價', '出場價', '損益 %', ...(isFut ? ['損益 $'] : []), '持倉時間', '結果'].map(h => (
                        <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-[#2d3439] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1f25]">
                    {displayed.map((t, i) => {
                      const isWin    = t.pnlPct > 0
                      const durationMs = t.exitTs - t.entryTs
                      const durationH  = Math.round(durationMs / 3600000)
                      const durationD  = Math.floor(durationH / 24)
                      const durLabel   = durationD >= 1
                        ? `${durationD}天${durationH % 24 > 0 ? ` ${durationH % 24}h` : ''}`
                        : `${durationH}h`
                      const seqNum = chronoOrder.get(t.entryTs) ?? i + 1
                      return (
                        <tr key={i} className={`transition-colors hover:bg-[#161b1e] ${isWin ? '' : 'bg-red-950/5'}`}>
                          <td className="px-4 py-3 text-slate-500 font-mono text-xs">#{seqNum}</td>
                          <td className="px-4 py-3">
                            {t.direction === 'short'
                              ? <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-black bg-red-500/15 text-red-400">▼ 做空</span>
                              : <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/15 text-emerald-400">▲ 做多</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-slate-400 font-mono text-xs whitespace-nowrap">
                            {new Date(t.entryTs).toLocaleDateString('zh-TW', { year:'2-digit', month:'2-digit', day:'2-digit' })}
                            {' '}
                            <span className="text-slate-600">{new Date(t.entryTs).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12: false })}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-400 font-mono text-xs whitespace-nowrap">
                            {new Date(t.exitTs).toLocaleDateString('zh-TW', { year:'2-digit', month:'2-digit', day:'2-digit' })}
                            {' '}
                            <span className="text-slate-600">{new Date(t.exitTs).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12: false })}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-300 font-mono text-xs">
                            {t.entry.toLocaleString('en-US', { maximumFractionDigits: isFut ? 2 : 4 })}
                          </td>
                          <td className="px-4 py-3 text-slate-300 font-mono text-xs">
                            {t.exit.toLocaleString('en-US', { maximumFractionDigits: isFut ? 2 : 4 })}
                          </td>
                          <td className={`px-4 py-3 font-black text-sm ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isWin ? '+' : ''}{t.pnlPct.toFixed(3)}%
                          </td>
                          {isFut && (
                            <td className={`px-4 py-3 font-bold text-sm ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isWin ? '+' : ''}${t.pnlDollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </td>
                          )}
                          <td className="px-4 py-3 text-slate-500 text-xs font-mono">{durLabel}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black ${isWin ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                              <span className="material-symbols-outlined text-[12px]">{isWin ? 'arrow_upward' : 'arrow_downward'}</span>
                              {isWin ? '獲利' : '虧損'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {trades.length > 20 && (
                <div className="p-4 border-t border-[#2d3439] flex justify-center">
                  <button
                    onClick={() => setShowAllTrades(v => !v)}
                    className="flex items-center gap-1.5 px-5 py-2 bg-[#161b1e] border border-[#2d3439] hover:bg-[#1e2227] text-slate-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px]">{showAllTrades ? 'expand_less' : 'expand_more'}</span>
                    {showAllTrades ? `收起（顯示前 20 筆）` : `展開全部 ${trades.length} 筆交易`}
                  </button>
                </div>
              )}
            </section>
          )
        })()}

        {/* ── Optimization Results comparison ───────────────────────── */}
        {records.length > 0 && (
          <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl overflow-hidden">
            <div className="p-6 border-b border-[#2d3439] flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">參數優化</h2>
                <p className="text-slate-500 text-sm mt-0.5">比較預設值與優化後的參數</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {records.slice(0, 6).map(r => (
                  <button key={r.id} onClick={() => setSelected(r)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      selected?.id === r.id
                        ? 'bg-[#3b82f6] border-[#3b82f6] text-white'
                        : 'bg-[#161b1e] border-[#2d3439] text-slate-400 hover:border-slate-500'
                    }`}>
                    {r.asset} · {r.timeframe}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0d1117]">
                    {['參數', '原始值', '優化值', 'Δ 變化', '狀態'].map(h => (
                      <th key={h} className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-[#2d3439]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2227]">
                  {comparison.length > 0 ? comparison.map((row, i) => (
                    <tr key={i} className="hover:bg-[#161b1e] transition-colors">
                      <td className="p-4 font-semibold text-sm text-white">{row.param}</td>
                      <td className="p-4 font-mono text-sm text-slate-400">{row.original}</td>
                      <td className="p-4 font-mono text-sm text-emerald-400 font-bold">{row.optimized}</td>
                      <td className={`p-4 font-bold text-sm ${parseFloat(row.improvement) < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>{row.improvement}</td>
                      <td className="p-4">
                        <span className="px-2 py-1 text-[10px] font-black uppercase rounded bg-emerald-500/10 text-emerald-400">OPTIMIZED</span>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="p-8 text-center text-slate-500 text-sm">無參數資料</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── All Records Table ──────────────────────────────────────── */}
        <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl overflow-hidden">
          {/* Category tab nav */}
          <div className="flex items-center border-b border-[#2d3439]">
            {([['all','所有'],['project','依專案'],['asset','依資產'],['type','依類型']] as const).map(([key, label]) => (
              <button key={key}
                onClick={() => { setCatTab(key); setCatValue('') }}
                className={`px-5 py-3.5 text-xs font-bold border-b-2 -mb-px transition-colors whitespace-nowrap ${catTab === key ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                {label}
              </button>
            ))}
            <div className="flex-1" />
            <div className="flex items-center gap-3 pr-5">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 text-[14px]">search</span>
                <input
                  type="text"
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="搜尋專案、資產..."
                  className="bg-[#161b1e] border border-[#2d3439] rounded-lg pl-7 pr-3 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#3b82f6] w-40"
                />
                {searchQ && (
                  <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                )}
              </div>
              <span className="text-[11px] text-slate-600 font-mono">
                {filteredRecords.length}{catTab !== 'all' && filteredRecords.length !== records.length ? ` / ${records.length}` : ''} 筆
              </span>
              <button onClick={fetchHistory} title="重新整理"
                className="text-slate-600 hover:text-slate-400 transition-colors">
                <span className="material-symbols-outlined text-[18px]">refresh</span>
              </button>
            </div>
          </div>

          <div className="flex">
            {/* Left category sidebar */}
            {catTab !== 'all' && (
              <aside className="w-44 shrink-0 border-r border-[#2d3439] py-2 overflow-y-auto" style={{ maxHeight: 560 }}>
                <button
                  onClick={() => setCatValue('')}
                  className={`w-full text-left px-4 py-2 text-xs font-semibold flex items-center justify-between transition-colors ${catValue === '' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
                  <span>全部</span>
                  <span className="text-[10px] bg-[#1e2227] text-slate-600 rounded px-1.5">{records.length}</span>
                </button>
                {catGroups.map(g => (
                  <button key={g.label}
                    onClick={() => setCatValue(g.label)}
                    className={`w-full text-left px-4 py-2 text-xs font-medium flex items-center justify-between gap-1.5 transition-colors ${catValue === g.label ? 'text-blue-400 bg-blue-500/5' : 'text-slate-500 hover:text-slate-300 hover:bg-[#161b1e]'}`}>
                    <span className="truncate">{g.label}</span>
                    <span className="text-[10px] bg-[#1e2227] text-slate-600 rounded px-1.5 shrink-0">{g.count}</span>
                  </button>
                ))}
              </aside>
            )}

            {/* Records table */}
            <div className="flex-1 min-w-0">
              {loading ? (
                <div className="p-12 text-center text-slate-500">
                  <span className="material-symbols-outlined text-4xl block mb-2 animate-spin">sync</span>載入中...
                </div>
              ) : records.length === 0 ? (
                <div className="p-12 text-center text-slate-500">
                  <span className="material-symbols-outlined text-5xl block mb-3">history</span>
                  <p className="font-medium text-white">尚無優化記錄</p>
                  <p className="text-sm mt-1">執行第一次回測以在此查看結果</p>
                  <Link href="/dashboard/backtest"
                    className="inline-flex items-center gap-1.5 mt-4 px-5 py-2.5 bg-[#3b82f6] text-white rounded-lg text-sm font-bold hover:bg-blue-500 transition-colors">
                    <span className="material-symbols-outlined text-[16px]">add</span>新增回測
                  </Link>
                </div>
              ) : filteredRecords.length === 0 ? (
                <div className="p-12 text-center text-slate-500">
                  <span className="material-symbols-outlined text-4xl block mb-2">search_off</span>
                  <p className="text-sm">此分類無記錄</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#0d1117]">
                        {['專案','資產','週期','類型','回報率','勝率','夏普','最大回撤','筆數','日期','操作'].map(h => (
                          <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-[#2d3439] whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2227]">
                      {filteredRecords.map(r => {
                        const ret       = r.total_return_pct ?? parseFloat(r.net_profit_pct || '0')
                        const isPos     = ret >= 0
                        const isSelected = selected?.id === r.id
                        const isDeleting = deletingId === r.id
                        return (
                          <tr key={r.id}
                            onClick={() => { setSelected(r); setShowAllTrades(false) }}
                            className={`cursor-pointer transition-all group ${isSelected ? 'bg-blue-600/8 border-l-2 border-l-[#3b82f6]' : 'hover:bg-[#161b1e]'} ${isDeleting ? 'opacity-30 pointer-events-none' : ''}`}>
                            <td className="px-4 py-3 text-xs text-slate-400 max-w-[110px] truncate">{r.project_name || '未命名專案'}</td>
                            <td className="px-4 py-3 font-bold text-sm text-white">{r.asset}</td>
                            <td className="px-4 py-3 text-xs text-slate-500 font-mono">{r.timeframe}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded ${r.asset_type === 'futures' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'}`}>
                                {r.asset_type ?? 'crypto'}
                              </span>
                            </td>
                            <td className={`px-4 py-3 font-black text-sm ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isPos ? '+' : ''}{ret.toFixed(2)}%
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-300">{r.win_rate ? `${r.win_rate.toFixed(1)}%` : '—'}</td>
                            <td className="px-4 py-3 text-sm text-slate-300">{r.sharpe_ratio?.toFixed(2) ?? '—'}</td>
                            <td className="px-4 py-3 text-sm text-red-400">{r.max_drawdown_pct ? `-${r.max_drawdown_pct.toFixed(1)}%` : '—'}</td>
                            <td className="px-4 py-3 text-sm text-slate-400">{r.total_trades ?? '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('zh-TW')}</td>
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => { setSelected(r); setShowCode(true) }}
                                  className="text-[10px] font-black uppercase text-[#3b82f6] hover:underline whitespace-nowrap">
                                  View
                                </button>
                                <span className="text-slate-700">·</span>
                                <button
                                  onClick={() => deleteRecord(r.id)}
                                  disabled={isDeleting}
                                  title="刪除記錄"
                                  className="text-slate-600 hover:text-red-400 transition-colors">
                                  <span className="material-symbols-outlined text-[15px]">delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Bottom Action Bar ──────────────────────────────────────── */}
        {records.length > 0 && (
          <div className="flex justify-center pb-12">
            <div className="flex items-center gap-5 p-4 bg-[#0a0d0f] border border-[#2d3439] rounded-2xl shadow-2xl">
              <p className="text-sm font-medium text-slate-400 px-4 border-r border-[#2d3439] hidden md:block">
                部署您的優化策略？
              </p>
              <div className="flex gap-3">
                <button onClick={() => selected && setShowCode(true)}
                  className="px-6 py-2.5 bg-white text-[#0a0d0f] hover:bg-slate-200 rounded-xl text-sm font-black transition-all shadow-lg">
                  匯出 PineScript
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[#1e2227] py-8 px-10">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-slate-500 text-xs">
          <p>© 2026 BacktestNow · 加密貨幣：% 回報率 · 期貨：每合約點值</p>
          <div className="flex gap-6">
            {['隱私政策','服務條款','客戶支援'].map(l => <a key={l} href="#" className="hover:text-white transition-colors">{l}</a>)}
          </div>
        </div>
      </footer>

      {/* ── Code Modal ────────────────────────────────────────────── */}
      {showCode && selected && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#2d3439]">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#3b82f6] text-[18px]">terminal</span>
                  優化 PineScript — {selected.asset} · {selected.timeframe}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  回報率：{(selected.total_return_pct ?? parseFloat(selected.net_profit_pct || '0')).toFixed(2)}%
                  {selected.win_rate ? ` · Win Rate ${selected.win_rate.toFixed(1)}%` : ''}
                  {selected.sharpe_ratio ? ` · Sharpe ${selected.sharpe_ratio.toFixed(2)}` : ''}
                </p>
              </div>
              <button onClick={() => setShowCode(false)} className="text-slate-500 hover:text-slate-300">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {displayedCode ? (
                <pre className="bg-[#0d1117] rounded-xl p-4 text-[12px] font-mono text-slate-300 whitespace-pre-wrap leading-6">{displayedCode}</pre>
              ) : (
                <div className="bg-[#0d1117] rounded-xl p-6 text-center text-slate-500 text-sm">
                  <span className="material-symbols-outlined text-3xl block mb-2">code_off</span>
                  此記錄未儲存 PineScript 程式碼。
                </div>
              )}
            </div>
            <div className="p-4 border-t border-[#2d3439] flex gap-3">
              {displayedCode && (
                <button onClick={() => navigator.clipboard.writeText(displayedCode)}
                  className="flex-1 bg-[#3b82f6] hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                  複製程式碼
                </button>
              )}
              <button onClick={() => setShowCode(false)}
                className="px-5 bg-[#0a0d0f] border border-[#2d3439] text-slate-300 rounded-xl text-sm hover:bg-[#1e2227] transition-colors">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-20">載入中...</div>}>
      <HistoryContent />
    </Suspense>
  )
}
