'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton, useUser } from '@clerk/nextjs'
import { cn } from '@/lib/utils'

const ADMIN_EMAIL = 'nbamoment@gmail.com'

const navItems = [
  { href: '/',                   icon: 'home',      label: '回到首頁' },
  { href: '/dashboard',          icon: 'dashboard', label: '儀表板' },
  { href: '/dashboard/backtest', icon: 'tune',      label: '優化器' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useUser()
  const isAdmin  = user?.primaryEmailAddress?.emailAddress === ADMIN_EMAIL

  const [collapsed, setCollapsed]   = useState(false)
  const [loading, setLoading]       = useState(false)
  const [histAssets, setHistAssets] = useState<{ asset: string; count: number }[]>([])
  const [membership, setMembership] = useState<{ remaining: number; limit: number; role: string } | null>(null)

  useEffect(() => { fetchAssets(); fetchMembership() }, [])

  async function fetchMembership() {
    try {
      const res  = await fetch('/api/membership')
      const json = await res.json()
      if (res.ok) setMembership({ remaining: json.remaining, limit: json.limit, role: json.role })
    } catch { /* ignore */ }
  }

  async function fetchAssets() {
    setLoading(true)
    try {
      const res  = await fetch('/api/save-result?limit=200')
      const json = await res.json()
      const records: Array<{ asset: string }> = json.records || []
      const counts: Record<string, number> = {}
      records.forEach(r => { counts[r.asset] = (counts[r.asset] || 0) + 1 })
      setHistAssets(
        Object.entries(counts)
          .map(([asset, count]) => ({ asset, count }))
          .sort((a, b) => b.count - a.count)
      )
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0d0f]" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside className={cn(
        'flex flex-col h-full border-r border-[#2d3439] bg-[#0a0d0f] transition-all duration-200 shrink-0',
        collapsed ? 'w-14' : 'w-60'
      )}>

        {/* Logo */}
        <div className="p-4 flex items-center gap-3 border-b border-[#2d3439] shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-white text-[18px]">query_stats</span>
          </div>
          {!collapsed && (
            <div>
              <span className="font-black text-base text-white leading-tight block">BacktestNow</span>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">Optimizer</span>
            </div>
          )}
        </div>

        {/* Scrollable nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">

          {/* ── Main nav (儀表板 + 優化器) ── */}
          {navItems.map(item => {
            const isActive = item.href === '/'
              ? false
              : item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group',
                  isActive
                    ? 'bg-blue-600/15 text-blue-400'
                    : 'text-slate-400 hover:bg-[#1e2227] hover:text-slate-200'
                )}>
                <span className="material-symbols-outlined text-[20px] shrink-0">{item.icon}</span>
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </Link>
            )
          })}

          {/* ── Optimization Records by Asset ── */}
          {!collapsed && (
            <>
              <div className="pt-4 pb-1.5 flex items-center justify-between px-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">優化紀錄</span>
                <button onClick={fetchAssets} title="重新整理"
                  className="text-slate-600 hover:text-slate-400 transition-colors">
                  <span className={cn('material-symbols-outlined text-[13px]', loading && 'animate-spin')}>
                    refresh
                  </span>
                </button>
              </div>

              {loading ? (
                <div className="px-3 py-2 text-[11px] text-slate-600 italic">載入中...</div>
              ) : histAssets.length === 0 ? (
                <div className="px-3 py-4 text-center space-y-2">
                  <span className="material-symbols-outlined text-slate-700 text-[28px] block">bar_chart</span>
                  <p className="text-[11px] text-slate-600">尚無回測紀錄</p>
                  <Link href="/dashboard/backtest"
                    className="text-[10px] font-bold text-blue-400 hover:underline">
                    開始第一次回測 →
                  </Link>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {histAssets.map(({ asset, count }) => (
                    <Link key={asset}
                      href={`/dashboard/history?asset=${encodeURIComponent(asset)}`}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-[#1e2227] hover:text-slate-200 transition-colors group">
                      <span className="material-symbols-outlined text-[15px] text-slate-600 group-hover:text-blue-400 shrink-0">
                        candlestick_chart
                      </span>
                      <span className="flex-1 truncate font-semibold">{asset}</span>
                      <span className="text-[10px] bg-[#1e2227] text-slate-500 rounded-full px-1.5 py-0.5 shrink-0 font-mono">
                        {count}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Collapsed: icon hints */}
          {collapsed && (
            <div className="pt-2 space-y-1">
              <button title="優化紀錄" onClick={() => setCollapsed(false)}
                className="w-full flex justify-center py-2.5 text-slate-600 hover:text-slate-400 hover:bg-[#1e2227] rounded-lg transition-colors">
                <span className="material-symbols-outlined text-[20px]">candlestick_chart</span>
              </button>
            </div>
          )}
        </nav>

        {/* Admin link */}
        {isAdmin && !collapsed && (
          <div className="px-3 pb-1">
            <Link href="/dashboard/admin"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-colors',
                pathname.startsWith('/dashboard/admin')
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-slate-500 hover:text-amber-300 hover:bg-amber-500/10'
              )}>
              <span className="material-symbols-outlined text-[18px]">admin_panel_settings</span>
              管理後台
            </Link>
          </div>
        )}

        {/* Bottom */}
        <div className="p-3 border-t border-[#2d3439] space-y-2 shrink-0">
          {!collapsed && (
            <Link href="/dashboard/backtest"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors">
              <span className="material-symbols-outlined text-[16px]">add</span>
              新增回測
            </Link>
          )}
          <div className="flex items-center justify-between">
            {!collapsed && (
              <div className="pl-1 flex items-center gap-2">
                <UserButton afterSignOutUrl="/" />
                {membership && membership.role !== 'admin' && (
                  <div className="flex flex-col leading-tight">
                    <span className={cn(
                      'text-[10px] font-black tabular-nums',
                      membership.remaining <= 5 ? 'text-red-400' : membership.remaining <= 10 ? 'text-amber-400' : 'text-slate-300'
                    )}>
                      {membership.remaining}/{membership.limit}
                    </span>
                    <span className="text-[9px] text-slate-600">回測餘額</span>
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setCollapsed(!collapsed)}
              className={cn(
                'flex items-center justify-center py-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e2227] transition-colors',
                collapsed ? 'w-full' : 'px-2'
              )}>
              <span className="material-symbols-outlined text-[20px]">
                {collapsed ? 'chevron_right' : 'chevron_left'}
              </span>
            </button>
          </div>
          {collapsed && (
            <div className="flex justify-center">
              <UserButton afterSignOutUrl="/" />
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-[#080a0c]">
          {children}
        </main>

        {/* ── Sponsor banner ──────────────────────────────────────── */}
        <div className="shrink-0 border-t border-[#1e2227] bg-[#080a0c] px-5 py-2 flex items-center gap-4 flex-wrap">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-700 shrink-0">贊助夥伴</span>
          <div className="w-px h-4 bg-[#1e2227] shrink-0" />

          {/* MiTrade */}
          <a
            href="https://mytd.cc/dMzp"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 group hover:opacity-90 transition-opacity"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-sm shrink-0">
              <span className="text-[11px] font-black text-white" style={{ fontStyle: 'italic' }}>M</span>
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-sm font-black text-white tracking-tight leading-none">Mi</span>
              <span className="text-sm font-black text-blue-400 tracking-tight leading-none">TRADE</span>
            </div>
            <span className="text-[9px] font-bold text-blue-500 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded hidden sm:block">
              立即開戶
            </span>
          </a>

          <div className="w-px h-4 bg-[#1e2227] shrink-0" />

          {/* Pionex 派網 */}
          <a
            href="https://reurl.cc/oKAgxg"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 group hover:opacity-90 transition-opacity"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-sm shrink-0">
              <span className="text-[11px] font-black text-white">P</span>
            </div>
            <span className="text-sm font-black text-white tracking-tight leading-none">派網</span>
            <span className="text-[10px] text-slate-500 hidden sm:block group-hover:text-slate-400 transition-colors">
              · Pionex
            </span>
            <span className="text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded hidden sm:block">
              立即開戶
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}
