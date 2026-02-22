'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const ASSETS = [
  { symbol: 'BTCUSDT', label: 'BTC / USD',    type: 'crypto',  category: '加密貨幣' },
  { symbol: 'ETHUSDT', label: 'ETH / USD',    type: 'crypto',  category: '加密貨幣' },
  { symbol: 'SOLUSDT', label: 'SOL / USD',    type: 'crypto',  category: '加密貨幣' },
  { symbol: 'BNBUSDT', label: 'BNB / USD',    type: 'crypto',  category: '加密貨幣' },
  { symbol: 'GC!',     label: 'GC (Gold)',    type: 'yahoo',   category: '期貨' },
  { symbol: 'NQ!',     label: 'NQ (Nasdaq)',  type: 'yahoo',   category: '期貨' },
  { symbol: 'ES!',     label: 'ES (S&P 500)', type: 'yahoo',   category: '期貨' },
  { symbol: 'SIL!',   label: 'SIL (Silver)', type: 'yahoo',   category: '期貨' },
]

interface AssetData {
  symbol: string
  label: string
  category: string
  price: number
  change: number
  changeAbs: number
  high: number
  low: number
  volume: number
  trend: number[]
  loaded: boolean
  error: boolean
}

function SparkLine({ prices, positive }: { prices: number[]; positive: boolean }) {
  if (prices.length < 2) return <div className="h-12 flex items-center justify-center text-slate-700 text-xs">—</div>
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 1
  const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * 100},${36 - ((p - min) / range) * 32}`).join(' ')
  return (
    <svg className="w-full h-12" viewBox="0 0 100 40" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg${positive ? 'p' : 'n'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={positive ? '#10b981' : '#ef4444'} stopOpacity="0.25" />
          <stop offset="100%" stopColor={positive ? '#10b981' : '#ef4444'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${pts} 100,40`} fill={`url(#sg${positive ? 'p' : 'n'})`} />
      <polyline points={pts} fill="none" stroke={positive ? '#10b981' : '#ef4444'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function fmt(n: number, decimals?: number): string {
  if (!n || isNaN(n)) return '—'
  const d = decimals ?? (n < 10 ? 4 : n < 1000 ? 2 : 0)
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function MarketsPage() {
  const [assets, setAssets] = useState<AssetData[]>(
    ASSETS.map(a => ({ ...a, price: 0, change: 0, changeAbs: 0, high: 0, low: 0, volume: 0, trend: [], loaded: false, error: false }))
  )
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    loadAll()
    const iv = setInterval(loadAll, 60_000)
    return () => clearInterval(iv)
  }, [])

  async function loadAll() {
    await Promise.allSettled(ASSETS.map((a, i) => loadOne(a, i)))
    setLastUpdate(new Date())
  }

  async function loadOne(a: typeof ASSETS[0], idx: number) {
    try {
      const endpoint = a.type === 'crypto'
        ? `/api/market-data/binance?symbol=${a.symbol}&interval=1D&limit=30`
        : `/api/market-data/yahoo?symbol=${a.symbol}&interval=1D&limit=30`
      const res  = await fetch(endpoint)
      const json = await res.json() as { data: { open: number; high: number; low: number; close: number; volume: number }[] }
      if (!res.ok || !json.data?.length) throw new Error('no data')

      const data  = json.data
      const last  = data[data.length - 1]
      const prev  = data[data.length - 2]
      const price = last.close
      const chg   = ((price - prev.close) / prev.close) * 100

      setAssets(prev => prev.map((x, i) => i === idx ? {
        ...x,
        price,
        change:    chg,
        changeAbs: price - prev.close,
        high:      last.high,
        low:       last.low,
        volume:    last.volume,
        trend:     data.slice(-20).map(d => d.close),
        loaded:    true,
        error:     false,
      } : x))
    } catch {
      setAssets(prev => prev.map((x, i) => i === idx ? { ...x, loaded: true, error: true } : x))
    }
  }

  const cryptoAssets  = assets.filter(a => a.category === '加密貨幣')
  const futuresAssets = assets.filter(a => a.category === '期貨')

  return (
    <div className="p-8 max-w-[1400px] space-y-8" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-[#3b82f6] text-[26px]">monitoring</span>
            市場概覽
            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              LIVE
            </span>
          </h1>
          {lastUpdate && (
            <p className="text-xs text-slate-500 mt-1">
              最後更新：{lastUpdate.toLocaleTimeString('zh-TW')}　每 60 秒自動刷新
            </p>
          )}
        </div>
        <button onClick={loadAll}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white border border-[#2d3439] bg-[#161b1e] px-3 py-1.5 rounded-lg transition-colors">
          <span className="material-symbols-outlined text-[14px]">refresh</span>
          刷新
        </button>
      </div>

      {/* Crypto */}
      <section>
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">加密貨幣</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cryptoAssets.map(a => (
            <AssetCard key={a.symbol} asset={a} />
          ))}
        </div>
      </section>

      {/* Futures */}
      <section>
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">期貨</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {futuresAssets.map(a => (
            <AssetCard key={a.symbol} asset={a} />
          ))}
        </div>
      </section>

      {/* Table view */}
      <section>
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">詳細數據</h2>
        <div className="bg-[#161b1e] border border-[#2d3439] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0d1117]">
              <tr>
                {['資產', '最新價', '24H 漲跌', '24H 漲跌幅', '日高', '日低', '操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500 text-left border-b border-[#2d3439]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1f25]">
              {assets.map(a => (
                <tr key={a.symbol} className="hover:bg-[#1e2227] transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-bold text-white text-sm">{a.label}</p>
                      <p className="text-[10px] text-slate-500">{a.category}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-white">
                    {a.loaded && !a.error ? `$${fmt(a.price)}` : a.error ? <span className="text-red-500/60 text-xs">載入失敗</span> : <span className="text-slate-700 animate-pulse">載入中...</span>}
                  </td>
                  <td className={`px-4 py-3 font-mono font-bold ${a.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {a.loaded && !a.error ? `${a.change >= 0 ? '+' : ''}$${fmt(Math.abs(a.changeAbs))}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {a.loaded && !a.error ? (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${a.change >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {a.change >= 0 ? '+' : ''}{a.change.toFixed(2)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-300">
                    {a.loaded && !a.error ? `$${fmt(a.high)}` : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-300">
                    {a.loaded && !a.error ? `$${fmt(a.low)}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/backtest?asset=${a.symbol}`}
                      className="text-[10px] font-black uppercase text-[#3b82f6] hover:underline">
                      回測
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function AssetCard({ asset: a }: { asset: AssetData }) {
  const pos = a.change >= 0
  return (
    <div className="bg-[#161b1e] border border-[#2d3439] rounded-xl p-4 hover:border-[#3b82f6]/40 transition-colors">
      <div className="flex justify-between items-start mb-1">
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{a.label}</p>
          <p className="text-[9px] text-slate-600">{a.category}</p>
        </div>
        {a.loaded && !a.error && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ml-1 ${pos ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {pos ? '+' : ''}{a.change.toFixed(2)}%
          </span>
        )}
      </div>

      <div className="mt-1 mb-2">
        {!a.loaded ? (
          <div className="h-7 bg-[#2d3439] rounded animate-pulse w-32" />
        ) : a.error ? (
          <p className="text-sm text-red-500/60">資料載入失敗</p>
        ) : (
          <h3 className="text-2xl font-black text-white">
            ${fmt(a.price)}
          </h3>
        )}
      </div>

      {a.trend.length > 0 && (
        <div className="opacity-80">
          <SparkLine prices={a.trend} positive={pos} />
        </div>
      )}

      {a.loaded && !a.error && (
        <div className="flex justify-between text-[10px] text-slate-500 mt-2 pt-2 border-t border-[#2d3439]">
          <span>H: ${fmt(a.high)}</span>
          <span>L: ${fmt(a.low)}</span>
          <Link href={`/dashboard/backtest?asset=${a.symbol}`} className="text-[#3b82f6] hover:underline font-bold">回測 →</Link>
        </div>
      )}
    </div>
  )
}
