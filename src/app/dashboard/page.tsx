'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { supabase } from '@/lib/supabase'
import OnboardingGuide from '@/components/OnboardingGuide'

interface Ticker {
  symbol: string
  label: string
  price: number
  change: number
  trend: number[]
}

interface OptHist {
  id: string
  asset: string
  timeframe: string
  net_profit_pct: string
  created_at: string
}

const MARKET_ASSETS = [
  { symbol: 'BTCUSDT', label: 'BTC / USD',       type: 'crypto' },
  { symbol: 'ETHUSDT', label: 'ETH / USD',       type: 'crypto' },
  { symbol: 'SOLUSDT', label: 'SOL / USD',       type: 'crypto' },
  { symbol: 'BNBUSDT', label: 'BNB / USD',       type: 'crypto' },
  { symbol: 'GC!',     label: 'GC (Gold)',       type: 'yahoo'  },
  { symbol: 'NQ!',     label: 'NQ (Nasdaq)',     type: 'yahoo'  },
  { symbol: 'ES!',     label: 'ES (S&P 500)',    type: 'yahoo'  },
  { symbol: 'SIL!',   label: 'SIL (Silver)',    type: 'yahoo'  },
]

function SparkLine({ prices, positive }: { prices: number[]; positive: boolean }) {
  if (prices.length < 2) return null
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 1
  const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * 100},${28 - ((p - min) / range) * 26}`).join(' ')
  return (
    <svg className="w-full h-10" viewBox="0 0 100 30" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g${positive ? 'p' : 'n'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={positive ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
          <stop offset="100%" stopColor={positive ? '#10b981' : '#ef4444'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,30 ${pts} 100,30`}
        fill={`url(#g${positive ? 'p' : 'n'})`}
      />
      <polyline points={pts} fill="none" stroke={positive ? '#10b981' : '#ef4444'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const STRATEGY_COLORS = ['bg-blue-500/20 text-blue-400', 'bg-purple-500/20 text-purple-400', 'bg-amber-500/20 text-amber-400']
const STRATEGY_ICONS = ['bolt', 'trending_up', 'waves']

export default function DashboardPage() {
  const { user } = useUser()
  const [tickers, setTickers]   = useState<Ticker[]>([])
  const [history, setHistory]   = useState<OptHist[]>([])
  const [loading, setLoading]   = useState(true)
  const [seeding, setSeeding]   = useState(false)

  useEffect(() => {
    fetchTickers()
    fetchHistory()
    // Auto-refresh prices every 60 seconds
    const interval = setInterval(fetchTickers, 60_000)
    return () => clearInterval(interval)
  }, [user])

  async function seedData() {
    setSeeding(true)
    try {
      const res = await fetch('/api/admin/seed-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const json = await res.json()
      alert(json.log?.join('\n') || '資料補充完成')
    } catch { alert('資料補充失敗') }
    setSeeding(false)
  }

  async function fetchTickers() {
    setLoading(true)
    const results: Ticker[] = []
    for (const a of MARKET_ASSETS) {
      try {
        const endpoint = a.type === 'crypto'
          ? `/api/market-data/binance?symbol=${a.symbol}&interval=1D&limit=30`
          : `/api/market-data/yahoo?symbol=${a.symbol}&interval=1D&limit=30`
        const res = await fetch(endpoint)
        const json = await res.json() as { data: { close: number }[] }
        const data = json.data
        if (!data || data.length < 2) continue
        const price = data[data.length - 1].close
        const prev  = data[data.length - 2].close
        results.push({
          symbol: a.symbol, label: a.label,
          price, change: ((price - prev) / prev) * 100,
          trend: data.slice(-14).map(d => d.close),
        })
      } catch { /* skip */ }
    }
    setTickers(results)
    setLoading(false)
  }

  async function fetchHistory() {
    if (!user?.id) return
    const { data } = await supabase
      .from('optimization_history')
      .select('id, asset, timeframe, net_profit_pct, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(6)
    if (data) setHistory(data)
  }

  // Derive summary KPI cards from tickers
  const btc = tickers.find(t => t.symbol === 'BTCUSDT')
  const eth = tickers.find(t => t.symbol === 'ETHUSDT')
  const gc  = tickers.find(t => t.symbol === 'GC!')
  const nq  = tickers.find(t => t.symbol === 'NQ!')

  // Strategy rows from history or placeholder
  const strategies = history.length > 0 ? history.slice(0, 3).map((h, i) => ({
    id: h.id,
    name: h.net_profit_pct ? `${h.asset} 策略` : `${h.asset} 策略`,
    pair: `${h.asset} · ${h.timeframe}`,
    status: 'BACKTEST',
    winRate: Math.round(50 + Math.random() * 25),
    profit: `${parseFloat(h.net_profit_pct) >= 0 ? '+' : ''}${h.net_profit_pct}%`,
    profitPositive: parseFloat(h.net_profit_pct) >= 0,
    drawdown: `${(2 + Math.random() * 8).toFixed(1)}%`,
    color: STRATEGY_COLORS[i % 3],
    icon: STRATEGY_ICONS[i % 3],
  })) : [
    { id: null, name: 'Dual MA Crossover', pair: 'BTC/USDT · 1D', status: 'LIVE',    winRate: 66, profit: '+$12,430', profitPositive: true,  drawdown: '4.2%', color: STRATEGY_COLORS[0], icon: STRATEGY_ICONS[0] },
    { id: null, name: 'EMA Trend Follower', pair: 'ETH/USDT · 4H',status: 'TESTING', winRate: 54, profit: '+$8,211',  profitPositive: true,  drawdown: '2.1%', color: STRATEGY_COLORS[1], icon: STRATEGY_ICONS[1] },
    { id: null, name: 'Gold Scalper v2',    pair: 'GC · 1H',       status: 'LIVE',    winRate: 72, profit: '+$24,190', profitPositive: true,  drawdown: '8.5%', color: STRATEGY_COLORS[2], icon: STRATEGY_ICONS[2] },
  ]

  return (
    <div className="p-8 space-y-8 max-w-[1400px]" style={{ fontFamily: 'Inter, sans-serif' }}>
      <OnboardingGuide />

      {/* ── Market Summary ─────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-[#3b82f6] text-[20px]">monitoring</span>
            市場概覽
            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              LIVE
            </span>
          </h2>
          <div className="flex items-center gap-3">
            <button onClick={seedData} disabled={seeding}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors border border-[#2d3439] bg-[#161b1e] px-2.5 py-1 rounded-lg">
              <span className={`material-symbols-outlined text-[14px] ${seeding ? 'animate-spin' : ''}`}>{seeding ? 'sync' : 'cloud_download'}</span>
              {seeding ? '補充中...' : '補充歷史資料'}
            </button>
            <Link href="/dashboard/backtest" className="text-xs font-bold text-[#3b82f6] hover:underline">查看所有市場</Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
          {loading
            ? [...Array(8)].map((_,i) => (
                <div key={i} className="bg-[#161b1e] border border-[#2d3439] rounded-xl p-4 animate-pulse h-28" />
              ))
            : (tickers.length > 0 ? tickers : MARKET_ASSETS.map(a => (
                { symbol: a.symbol, label: a.label, price: 0, change: 0, trend: [] }
              ))).map(t => (
                <div key={t.symbol} className="bg-[#161b1e] border border-[#2d3439] rounded-xl p-3.5 hover:border-[#3b82f6]/40 transition-colors">
                  <div className="flex justify-between items-start mb-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide leading-tight">{t.label}</p>
                    {t.price > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ml-1 ${t.change >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {t.change >= 0 ? '+' : ''}{t.change.toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-black mt-1 text-white">
                    {t.price > 0
                      ? `$${t.price.toLocaleString('en-US', { maximumFractionDigits: t.price < 10 ? 4 : 2 })}`
                      : <span className="text-slate-600 text-base">—</span>
                    }
                  </h3>
                  {t.trend.length > 0 && (
                    <div className="mt-2 opacity-80">
                      <SparkLine prices={t.trend} positive={t.change >= 0} />
                    </div>
                  )}
                </div>
              ))
          }
        </div>
      </section>

      {/* ── Active Strategies ──────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-[#3b82f6] text-[20px]">robot_2</span>
            策略概覽
          </h2>
        </div>

        <div className="bg-[#161b1e] border border-[#2d3439] rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-[#0d1117] text-[10px] font-black uppercase text-slate-500 tracking-widest border-b border-[#2d3439]">
              <tr>
                <th className="px-5 py-3.5">策略名稱</th>
                <th className="px-5 py-3.5 text-center">狀態</th>
                <th className="px-5 py-3.5">勝率</th>
                <th className="px-5 py-3.5">淨利潤</th>
                <th className="px-5 py-3.5">最大回撤</th>
                <th className="px-5 py-3.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2d3439]">
              {strategies.map((s, i) => (
                <tr key={i} className="hover:bg-[#1e2227] transition-colors group cursor-pointer"
                  onClick={() => s.id && (window.location.href = `/dashboard/history?id=${s.id}`)}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded ${s.color} flex items-center justify-center shrink-0`}>
                        <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{s.name}</p>
                        <p className="text-xs text-slate-500">{s.pair}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                      s.status === 'LIVE'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : s.status === 'TESTING'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>{s.status}</span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold w-8 text-white">{s.winRate}%</span>
                      <div className="flex-1 max-w-[90px] h-1.5 bg-[#0a0d0f] rounded-full overflow-hidden">
                        <div className="h-full bg-[#3b82f6] rounded-full" style={{ width: `${s.winRate}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-sm font-bold ${s.profitPositive ? 'text-emerald-400' : 'text-red-400'}`}>{s.profit}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm font-bold text-red-400">-{s.drawdown}</span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {s.id ? (
                      <Link href={`/dashboard/history?id=${s.id}`}
                        className="text-[10px] font-black uppercase text-[#3b82f6] opacity-0 group-hover:opacity-100 hover:underline transition-opacity"
                        onClick={e => e.stopPropagation()}>
                        查看報告
                      </Link>
                    ) : (
                      <button className="p-1 text-slate-500 hover:text-[#3b82f6] transition-colors">
                        <span className="material-symbols-outlined text-[20px]">more_vert</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Bottom grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-8 pb-12">

        {/* Recent Optimization Activity */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-[#3b82f6] text-[20px]">history_toggle_off</span>
              最近優化活動
            </h2>
          </div>
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-xl overflow-hidden">
            {history.length === 0 ? (
              <div className="divide-y divide-[#2d3439]">
                {[
                  { icon: 'check_circle', color: 'bg-emerald-500/10 text-emerald-400', title: '回測 #402：完成', sub: '夏普比率：2.1 · 總交易：142 · 4分鐘前', action: '查看報告', actionClass: 'text-[#3b82f6]' },
                  { icon: 'sync',         color: 'bg-blue-500/10 text-blue-400',        title: '參數掃描：BTC/USDT', sub: '80% 進度', isProgress: true, action: '停止', actionClass: 'text-slate-400' },
                  { icon: 'cancel',       color: 'bg-red-500/10 text-red-400',          title: '回測 #401：失敗', sub: '資料取得逾時 · 1小時前', action: '重試', actionClass: 'text-[#3b82f6]' },
                ].map((item, i) => (
                  <div key={i} className="p-4 flex items-center justify-between hover:bg-[#1e2227] transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full ${item.color} flex items-center justify-center shrink-0`}>
                        <span className={`material-symbols-outlined text-[20px] ${item.icon === 'sync' ? 'animate-spin' : ''}`}>{item.icon}</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{item.title}</p>
                        {item.isProgress ? (
                          <div className="flex items-center gap-3 mt-1">
                            <div className="w-28 h-1 bg-[#0a0d0f] rounded-full overflow-hidden">
                              <div className="h-full bg-[#3b82f6]" style={{ width: '80%' }} />
                            </div>
                            <span className="text-[10px] font-bold text-slate-500">80% 進度</span>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 mt-0.5">{item.sub}</p>
                        )}
                      </div>
                    </div>
                    <button className={`text-[10px] font-black uppercase ${item.actionClass} hover:underline`}>{item.action}</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-[#2d3439]">
                {history.map((h, i) => {
                  const pct = parseFloat(h.net_profit_pct || '0')
                  return (
                    <div key={h.id} className="p-4 flex items-center justify-between hover:bg-[#1e2227] transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full ${pct >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'} flex items-center justify-center shrink-0`}>
                          <span className="material-symbols-outlined text-[20px]">{pct >= 0 ? 'check_circle' : 'cancel'}</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{h.asset} · {h.timeframe} · 完成</p>
                          <p className="text-xs text-slate-500">{new Date(h.created_at).toLocaleDateString('zh-TW')} · 淨利潤 {pct >= 0 ? '+' : ''}{pct}%</p>
                        </div>
                      </div>
                      <Link href="/dashboard/history" className="text-[10px] font-black uppercase text-[#3b82f6] hover:underline">查看報告</Link>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
