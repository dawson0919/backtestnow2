'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { supabase } from '@/lib/supabase'

interface MarketTicker {
  symbol: string
  name: string
  price: number
  change: number
  positive: boolean
  trend: number[]
}

interface OptHist {
  id: string
  asset: string
  timeframe: string
  net_profit_pct: string
  created_at: string
}

export default function DashboardPage() {
  const { user } = useUser()
  const [tickers, setTickers] = useState<MarketTicker[]>([])
  const [history, setHistory] = useState<OptHist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTickers()
    fetchHistory()
  }, [])

  async function fetchTickers() {
    const symbols = [
      { symbol: 'BTCUSDT', name: 'BTC / USDT' },
      { symbol: 'ETHUSDT', name: 'ETH / USDT' },
      { symbol: 'SOLUSDT', name: 'SOL / USDT' },
      { symbol: 'BNBUSDT', name: 'BNB / USDT' },
    ]
    try {
      const results = await Promise.all(
        symbols.map(async s => {
          const res = await fetch(`/api/market-data/binance?symbol=${s.symbol}&interval=1D&limit=30`)
          const json = await res.json()
          const data = json.data as { close: number }[]
          if (!data || data.length < 2) return null
          const current = data[data.length - 1].close
          const prev = data[data.length - 2].close
          const change = ((current - prev) / prev) * 100
          return {
            symbol: s.symbol,
            name: s.name,
            price: current,
            change,
            positive: change >= 0,
            trend: data.slice(-12).map(d => d.close),
          }
        })
      )
      setTickers(results.filter(Boolean) as MarketTicker[])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function fetchHistory() {
    if (!user?.id) return
    const { data } = await supabase
      .from('optimization_history')
      .select('id, asset, timeframe, net_profit_pct, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
    if (data) setHistory(data)
  }

  function SparkLine({ prices, positive }: { prices: number[]; positive: boolean }) {
    if (prices.length < 2) return null
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const range = max - min || 1
    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * 100
      const y = 30 - ((p - min) / range) * 28
      return `${x},${y}`
    }).join(' ')
    return (
      <svg className="w-full h-10" viewBox="0 0 100 30" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={positive ? '#10b981' : '#ef4444'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }

  return (
    <div className="p-8 space-y-8 max-w-7xl">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-black text-white">
          歡迎回來，{user?.firstName || 'Trader'} 👋
        </h1>
        <p className="text-slate-400 text-sm mt-1">以下是您的交易儀表板</p>
      </div>

      {/* Market Summary */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-400 text-[20px]">monitoring</span>
            市場行情
          </h2>
          <Link href="/dashboard/backtest" className="text-xs font-bold text-blue-400 hover:underline">
            開始回測 →
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-[#161b1e] border border-[#2d3439] rounded-xl p-4 animate-pulse h-28" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {tickers.map(t => (
              <div key={t.symbol} className="card-hover bg-[#161b1e] border border-[#2d3439] rounded-xl p-4">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">{t.name}</p>
                    <h3 className="text-xl font-black mt-1">
                      ${t.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </h3>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.positive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    {t.positive ? '+' : ''}{t.change.toFixed(2)}%
                  </span>
                </div>
                <SparkLine prices={t.trend} positive={t.positive} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick Actions + History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent History */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-blue-400 text-[20px]">history_toggle_off</span>
              最近優化記錄
            </h2>
            <Link href="/dashboard/history" className="text-xs font-bold text-blue-400 hover:underline">查看全部</Link>
          </div>
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-xl overflow-hidden">
            {history.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                <span className="material-symbols-outlined text-4xl block mb-2">analytics</span>
                尚無優化記錄。<Link href="/dashboard/backtest" className="text-blue-400 hover:underline">立即開始第一次優化</Link>
              </div>
            ) : (
              <div className="divide-y divide-[#2d3439]">
                {history.map(h => (
                  <div key={h.id} className="p-4 flex items-center justify-between hover:bg-[#1e2227] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{h.asset} · {h.timeframe}</p>
                        <p className="text-xs text-slate-500">{new Date(h.created_at).toLocaleDateString('zh-TW')}</p>
                      </div>
                    </div>
                    <span className={`text-sm font-bold ${parseFloat(h.net_profit_pct || '0') >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {parseFloat(h.net_profit_pct || '0') >= 0 ? '+' : ''}{h.net_profit_pct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Start */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-blue-400 text-[20px]">rocket_launch</span>
              快速啟動
            </h2>
          </div>
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-xl p-6 space-y-4">
            <p className="text-sm text-slate-400">選擇資產並使用內建雙均線範例策略快速開始</p>
            {[
              { label: 'BTC 雙均線優化', asset: 'BTCUSDT' },
              { label: 'ETH 雙均線優化', asset: 'ETHUSDT' },
              { label: 'GC Gold 雙均線優化', asset: 'GC!' },
              { label: 'NQ Nasdaq 雙均線優化', asset: 'NQ!' },
            ].map(item => (
              <Link
                key={item.asset}
                href={`/dashboard/backtest?asset=${item.asset}&template=dual_ma`}
                className="flex items-center justify-between p-3 bg-[#0a0d0f] border border-[#2d3439] rounded-lg hover:border-blue-500/40 hover:bg-blue-600/5 transition-all group"
              >
                <span className="text-sm font-medium text-slate-300 group-hover:text-white">{item.label}</span>
                <span className="material-symbols-outlined text-slate-500 group-hover:text-blue-400 text-[18px]">arrow_forward</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
