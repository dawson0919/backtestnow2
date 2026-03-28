'use client'

import { useEffect, useState, useCallback } from 'react'

interface NewsItem {
  uuid: string
  title: string
  publisher: string
  link: string
  providerPublishTime: number
  type: string
  relatedSymbols: string[]
}

interface NewsResponse {
  items: NewsItem[]
  fetchedAt: number
  cached: boolean
  error?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(unixSec: number): string {
  const diffMs = Date.now() - unixSec * 1000
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1)  return '剛剛'
  if (mins < 60) return `${mins} 分鐘前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs} 小時前`
  const days = Math.floor(hrs / 24)
  return `${days} 天前`
}

function formatTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const SYMBOL_COLORS: Record<string, string> = {
  'Gold':       'text-amber-400 bg-amber-500/10 border-amber-500/20',
  'Crude Oil':  'text-red-400 bg-red-500/10 border-red-500/20',
  'Nasdaq 100': 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  'S&P 500':    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  'Market':     'text-blue-400 bg-blue-500/10 border-blue-500/20',
}

function SymbolBadge({ label }: { label: string }) {
  const cls = SYMBOL_COLORS[label] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/20'
  return (
    <span className={`inline-flex items-center text-[9px] font-black uppercase tracking-widest border px-1.5 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
function NewsSkeletonRow() {
  return (
    <div className="flex gap-4 p-4 border-b border-[#1e2227] animate-pulse">
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-[#2d3439] rounded w-3/4" />
        <div className="h-3 bg-[#2d3439] rounded w-1/2" />
        <div className="flex gap-1.5">
          <div className="h-4 w-16 bg-[#2d3439] rounded" />
          <div className="h-4 w-20 bg-[#2d3439] rounded" />
        </div>
      </div>
    </div>
  )
}

// ── News row ─────────────────────────────────────────────────────────────────
function NewsRow({ item }: { item: NewsItem }) {
  const uniqueSymbols = [...new Set(item.relatedSymbols)].filter(s => s !== 'Market').slice(0, 3)
  const showMarket   = item.relatedSymbols.includes('Market') && uniqueSymbols.length === 0

  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 px-4 py-3.5 hover:bg-[#111518] transition-colors border-b border-[#1e2227] last:border-0 group"
    >
      {/* Icon */}
      <div className="w-8 h-8 rounded-lg bg-[#1e2227] flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-[#2d3439] transition-colors">
        <span className="material-symbols-outlined text-slate-500 text-[16px] group-hover:text-blue-400 transition-colors">
          article
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm font-semibold text-slate-200 leading-snug group-hover:text-white transition-colors line-clamp-2">
          {item.title}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-600 font-medium">{item.publisher}</span>
          <span className="text-[10px] text-slate-700">·</span>
          <span className="text-[11px] text-slate-600" title={formatTime(item.providerPublishTime)}>
            {timeAgo(item.providerPublishTime)}
          </span>
        </div>

        {(uniqueSymbols.length > 0 || showMarket) && (
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {uniqueSymbols.map(s => <SymbolBadge key={s} label={s} />)}
            {showMarket && <SymbolBadge label="Market" />}
          </div>
        )}
      </div>

      {/* External link arrow */}
      <span className="material-symbols-outlined text-slate-700 text-[16px] shrink-0 mt-1 group-hover:text-blue-400 transition-colors">
        open_in_new
      </span>
    </a>
  )
}

// ── Filter bar ───────────────────────────────────────────────────────────────
const FILTERS = ['全部', 'Gold', 'Crude Oil', 'Nasdaq 100', 'S&P 500']

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FinancialNewsPage() {
  const [data, setData]       = useState<NewsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('全部')
  const [search, setSearch]   = useState('')

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    try {
      const res  = await fetch('/api/financial-news')
      const json = await res.json() as NewsResponse
      setData(json)
    } catch {
      setData({ items: [], fetchedAt: Date.now(), cached: false, error: '無法載入新聞' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Auto-refresh every 30 minutes
    const iv = setInterval(() => load(false), 30 * 60_000)
    return () => clearInterval(iv)
  }, [load])

  const filtered = (data?.items ?? []).filter(item => {
    if (filter !== '全部' && !item.relatedSymbols.includes(filter)) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return item.title.toLowerCase().includes(q) || item.publisher.toLowerCase().includes(q)
    }
    return true
  })

  const fetchedDate = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleString('zh-TW', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div className="p-8 max-w-[1200px] space-y-6" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-[#3b82f6] text-[22px]">newspaper</span>
            <h1 className="text-xl font-black text-white">每日財經新聞</h1>
            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              LIVE
            </span>
          </div>
          <p className="text-xs text-slate-500">
            黃金 · 原油 · 納指 · 標普 500 · 最新市場資訊
            {fetchedDate && (
              <span className="ml-2 text-slate-700">· 更新於 {fetchedDate}{data?.cached ? ' (快取)' : ''}</span>
            )}
          </p>
        </div>

        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 border border-[#2d3439] bg-[#161b1e] hover:bg-[#1e2227] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-[14px] ${loading ? 'animate-spin' : ''}`}>
            {loading ? 'sync' : 'refresh'}
          </span>
          重新整理
        </button>
      </div>

      {/* ── Search + Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-[16px]">
            search
          </span>
          <input
            type="text"
            placeholder="搜尋新聞標題..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-[#161b1e] border border-[#2d3439] rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                filter === f
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                  : 'bg-[#161b1e] border-[#2d3439] text-slate-500 hover:text-slate-300 hover:border-[#3d4449]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── News list ────────────────────────────────────────────────────── */}
      <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl overflow-hidden">

        {/* Column header */}
        <div className="px-4 py-2.5 border-b border-[#2d3439] flex items-center justify-between bg-[#0d1117]">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
            財經新聞 — 即時更新
          </span>
          {!loading && data && (
            <span className="text-[10px] text-slate-700">
              {filtered.length} 則
            </span>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div>
            {Array.from({ length: 8 }).map((_, i) => <NewsSkeletonRow key={i} />)}
          </div>
        )}

        {/* Error state */}
        {!loading && data?.error && (
          <div className="flex flex-col items-center gap-3 py-16 text-center px-4">
            <span className="material-symbols-outlined text-slate-700 text-[36px]">wifi_off</span>
            <p className="text-sm font-semibold text-slate-500">{data.error}</p>
            <button
              onClick={() => load()}
              className="text-xs font-bold text-blue-400 hover:underline"
            >
              重試
            </button>
          </div>
        )}

        {/* Empty filtered state */}
        {!loading && !data?.error && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center px-4">
            <span className="material-symbols-outlined text-slate-700 text-[36px]">newspaper</span>
            <p className="text-sm font-semibold text-slate-500">
              {search ? `找不到包含「${search}」的新聞` : '目前無新聞資料'}
            </p>
          </div>
        )}

        {/* News items */}
        {!loading && !data?.error && filtered.length > 0 && (
          <div>
            {filtered.map(item => <NewsRow key={item.uuid} item={item} />)}
          </div>
        )}
      </div>

      {/* ── Disclaimer ───────────────────────────────────────────────────── */}
      <p className="text-[10px] text-slate-700 leading-relaxed text-center">
        新聞資料來源：Yahoo Finance。僅供參考，不構成投資建議。請自行判斷投資風險。
      </p>
    </div>
  )
}
