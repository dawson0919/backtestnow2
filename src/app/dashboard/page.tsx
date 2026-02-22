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
  project_name: string
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

const ADMIN_EMAIL = 'nbamoment@gmail.com'

interface Membership { role: 'admin'|'advanced'|'free'; count: number; limit: number; remaining: number; pending: { status: string } | null }

export default function DashboardPage() {
  const { user } = useUser()
  const [tickers, setTickers]     = useState<Ticker[]>([])
  const [history, setHistory]     = useState<OptHist[]>([])
  const [loading, setLoading]     = useState(true)
  const [seeding, setSeeding]     = useState(false)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [platformAcct, setPlatformAcct] = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [submitMsg, setSubmitMsg]       = useState('')
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [editName, setEditName]         = useState('')
  const [deletingId, setDeletingId]     = useState<string | null>(null)

  const isAdmin = user?.primaryEmailAddress?.emailAddress === ADMIN_EMAIL

  useEffect(() => {
    fetchTickers()
    fetchHistory()
    fetchMembership()
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

  async function fetchMembership() {
    if (!user?.id) return
    try {
      const res = await fetch('/api/membership')
      if (res.ok) setMembership(await res.json())
    } catch { /* ignore */ }
  }

  async function submitUpgrade() {
    if (!platformAcct.trim()) return
    setSubmitting(true); setSubmitMsg('')
    try {
      const res = await fetch('/api/upgrade-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformAccount: platformAcct }),
      })
      const json = await res.json()
      if (!res.ok) { setSubmitMsg(json.error || '申請失敗'); return }
      setSubmitMsg('申請已送出！請等待管理員審核（通常 1-2 個工作天）')
      fetchMembership()
    } catch { setSubmitMsg('網路錯誤，請稍後再試') }
    finally { setSubmitting(false) }
  }

  async function renameProject(id: string) {
    if (!editName.trim()) return
    await fetch('/api/save-result', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, projectName: editName.trim() }),
    })
    setHistory(prev => prev.map(h => h.id === id ? { ...h, net_profit_pct: h.net_profit_pct } : h))
    // refetch to get updated name
    setEditingId(null)
    fetchHistory()
  }

  async function deleteProject(id: string) {
    setDeletingId(id)
    await fetch(`/api/save-result?id=${id}`, { method: 'DELETE' })
    setHistory(prev => prev.filter(h => h.id !== id))
    setDeletingId(null)
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
      .select('id, asset, timeframe, net_profit_pct, project_name, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setHistory(data)
  }

  // Derive summary KPI cards from tickers
  const btc = tickers.find(t => t.symbol === 'BTCUSDT')
  const eth = tickers.find(t => t.symbol === 'ETHUSDT')
  const gc  = tickers.find(t => t.symbol === 'GC!')
  const nq  = tickers.find(t => t.symbol === 'NQ!')

  // Strategy rows from history or placeholder
  const strategies = history.length > 0 ? history.map((h, i) => ({
    id: h.id,
    name: h.project_name || `${h.asset} 策略`,
    projectName: h.project_name,
    pair: `${h.asset} · ${h.timeframe}`,
    status: 'BACKTEST',
    winRate: Math.round(50 + Math.random() * 25),
    profit: `${parseFloat(h.net_profit_pct) >= 0 ? '+' : ''}${h.net_profit_pct}%`,
    profitPositive: parseFloat(h.net_profit_pct) >= 0,
    drawdown: `${(2 + Math.random() * 8).toFixed(1)}%`,
    color: STRATEGY_COLORS[i % 3],
    icon: STRATEGY_ICONS[i % 3],
  })) : [
    { id: null, projectName: null, name: 'Dual MA Crossover', pair: 'BTC/USDT · 1D', status: 'LIVE',    winRate: 66, profit: '+$12,430', profitPositive: true,  drawdown: '4.2%', color: STRATEGY_COLORS[0], icon: STRATEGY_ICONS[0] },
    { id: null, projectName: null, name: 'EMA Trend Follower', pair: 'ETH/USDT · 4H',status: 'TESTING', winRate: 54, profit: '+$8,211',  profitPositive: true,  drawdown: '2.1%', color: STRATEGY_COLORS[1], icon: STRATEGY_ICONS[1] },
    { id: null, projectName: null, name: 'Gold Scalper v2',    pair: 'GC · 1H',       status: 'LIVE',    winRate: 72, profit: '+$24,190', profitPositive: true,  drawdown: '8.5%', color: STRATEGY_COLORS[2], icon: STRATEGY_ICONS[2] },
  ]

  return (
    <div className="p-8 space-y-8 max-w-[1400px]" style={{ fontFamily: 'Inter, sans-serif' }}>
      <OnboardingGuide />

      {/* ── Membership Bar ─────────────────────────────────────── */}
      {membership && !isAdmin && (
        <div className="flex items-center justify-between bg-[#161b1e] border border-[#2d3439] rounded-xl px-5 py-3">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
              membership.role === 'advanced'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
            }`}>
              {membership.role === 'advanced' ? '進階會員' : '一般會員'}
            </span>
            <div className="flex-1 max-w-xs">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-slate-500">本月回測次數</span>
                <span className={membership.remaining === 0 ? 'text-red-400 font-bold' : 'text-slate-400'}>
                  {membership.count} / {membership.limit}
                </span>
              </div>
              <div className="h-1.5 bg-[#0a0d0f] rounded-full overflow-hidden border border-[#2d3439]">
                <div className={`h-full rounded-full transition-all ${
                  membership.remaining === 0 ? 'bg-red-500' : membership.count / membership.limit > 0.8 ? 'bg-amber-500' : 'bg-[#3b82f6]'
                }`} style={{ width: `${Math.min(100, (membership.count / membership.limit) * 100)}%` }} />
              </div>
            </div>
          </div>
          {membership.role === 'free' && (
            membership.pending?.status === 'pending' ? (
              <span className="text-[10px] text-amber-400 font-semibold ml-4">審核中...</span>
            ) : (
              <button onClick={() => { setShowUpgrade(true); setSubmitMsg('') }}
                className="ml-4 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold rounded-lg transition-colors shrink-0">
                解鎖進階會員
              </button>
            )
          )}
        </div>
      )}

      {/* ── Upgrade Modal ───────────────────────────────────────── */}
      {showUpgrade && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#2d3439]">
              <h3 className="font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[18px]">workspace_premium</span>
                申請進階會員
              </h3>
              <button onClick={() => setShowUpgrade(false)} className="text-slate-500 hover:text-slate-300">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-[#0a0d0f] rounded-xl p-4 border border-[#2d3439] space-y-2 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>一般會員</span><span className="text-slate-500">每月 20 次回測</span>
                </div>
                <div className="flex justify-between text-amber-300 font-bold">
                  <span>進階會員</span><span>每月 100 次回測（3 個月）</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                  交易平台帳號號碼
                </label>
                <input
                  type="text"
                  value={platformAcct}
                  onChange={e => setPlatformAcct(e.target.value)}
                  placeholder="請填寫您的交易平台帳號"
                  className="w-full bg-[#0a0d0f] border border-[#2d3439] rounded-lg text-sm text-white px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500/50 placeholder:text-slate-600"
                />
                <p className="text-[10px] text-slate-500 mt-1.5">送出後由管理員審核，通常 1-2 個工作天內完成</p>
              </div>
              {submitMsg && (
                <p className={`text-xs px-3 py-2 rounded-lg ${submitMsg.includes('送出') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {submitMsg}
                </p>
              )}
            </div>
            <div className="p-5 border-t border-[#2d3439] flex gap-3">
              {!submitMsg.includes('送出') && (
                <button onClick={submitUpgrade} disabled={submitting || !platformAcct.trim()}
                  className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 font-bold py-2.5 rounded-xl text-sm disabled:opacity-50 transition-colors">
                  {submitting ? '送出中...' : '送出申請'}
                </button>
              )}
              <button onClick={() => setShowUpgrade(false)}
                className="flex-1 bg-[#0a0d0f] border border-[#2d3439] text-slate-300 rounded-xl text-sm hover:bg-[#1e2227] transition-colors py-2.5">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

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
            {isAdmin && (
              <button onClick={seedData} disabled={seeding}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors border border-[#2d3439] bg-[#161b1e] px-2.5 py-1 rounded-lg">
                <span className={`material-symbols-outlined text-[14px] ${seeding ? 'animate-spin' : ''}`}>{seeding ? 'sync' : 'cloud_download'}</span>
                {seeding ? '補充中...' : '補充歷史資料'}
              </button>
            )}
            <Link href="/dashboard/markets" className="text-xs font-bold text-[#3b82f6] hover:underline">查看所有市場</Link>
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
          <Link href="/dashboard/backtest"
            className="flex items-center gap-1.5 text-xs font-bold bg-[#3b82f6]/10 hover:bg-[#3b82f6]/20 border border-[#3b82f6]/30 text-[#3b82f6] px-3 py-1.5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-[14px]">add</span>
            新增策略
          </Link>
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
                <tr key={s.id ?? i} className="hover:bg-[#1e2227] transition-colors group cursor-pointer"
                  onClick={() => s.id && editingId !== s.id && (window.location.href = `/dashboard/history?id=${s.id}`)}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded ${s.color} flex items-center justify-center shrink-0`}>
                        <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingId === s.id ? (
                          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            <input
                              autoFocus
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') renameProject(s.id!); if (e.key === 'Escape') setEditingId(null) }}
                              className="text-sm font-bold bg-[#0a0d0f] border border-[#3b82f6]/50 rounded px-2 py-0.5 text-white focus:outline-none w-40"
                            />
                            <button onClick={() => renameProject(s.id!)} className="text-emerald-400 hover:text-emerald-300">
                              <span className="material-symbols-outlined text-[16px]">check</span>
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-slate-500 hover:text-slate-300">
                              <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm font-bold text-white truncate">{s.name}</p>
                        )}
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
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <button
                          title="重新命名"
                          onClick={() => { setEditingId(s.id!); setEditName(s.name) }}
                          className="p-1 text-slate-500 hover:text-[#3b82f6] transition-colors">
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </button>
                        <button
                          title="刪除"
                          disabled={deletingId === s.id}
                          onClick={() => { if (confirm(`確定刪除「${s.name}」？此操作無法還原。`)) deleteProject(s.id!) }}
                          className="p-1 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40">
                          <span className="material-symbols-outlined text-[16px]">{deletingId === s.id ? 'sync' : 'delete'}</span>
                        </button>
                      </div>
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
                      <Link href={`/dashboard/history?id=${h.id}`} className="text-[10px] font-black uppercase text-[#3b82f6] hover:underline">查看報告</Link>
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
