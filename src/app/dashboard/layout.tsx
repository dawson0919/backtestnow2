'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { UserButton, useUser } from '@clerk/nextjs'
import { cn } from '@/lib/utils'

const ADMIN_EMAIL = 'nbamoment@gmail.com'

interface SavedStrategy {
  id: string
  project_name: string
  strategy_name: string
  updated_at: string
}

const navItems = [
  { href: '/dashboard',           icon: 'dashboard',    label: '儀表板' },
  { href: '/dashboard/markets',   icon: 'monitoring',   label: '市場' },
  { href: '/dashboard/backtest',  icon: 'tune',         label: '優化器' },
  { href: '/dashboard/history',   icon: 'history',      label: '歷史' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const { user }  = useUser()
  const isAdmin   = user?.primaryEmailAddress?.emailAddress === ADMIN_EMAIL
  const [collapsed, setCollapsed]           = useState(false)
  const [strategies, setStrategies]         = useState<SavedStrategy[]>([])
  const [loadingSidebar, setLoadingSidebar] = useState(false)
  const [showAllStrategies, setShowAllStrategies] = useState(false)

  useEffect(() => {
    fetchSidebarData()
  }, [])

  async function fetchSidebarData() {
    setLoadingSidebar(true)
    try {
      const res  = await fetch('/api/strategies')
      const data = await res.json()
      setStrategies(data.strategies || [])
    } catch { /* ignore */ }
    finally { setLoadingSidebar(false) }
  }

  // Derive unique projects from strategies
  const projects = [...new Set(strategies.map(s => s.project_name || '未命名專案'))]

  const displayedStrategies = showAllStrategies ? strategies : strategies.slice(0, 6)

  function loadStrategyInBacktest(id: string) {
    router.push(`/dashboard/backtest?strategy=${id}`)
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0d0f]" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col h-full border-r border-[#2d3439] bg-[#0a0d0f] transition-all duration-200 shrink-0',
          collapsed ? 'w-14' : 'w-64'
        )}
      >
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

        {/* Scrollable nav area */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {/* Main nav */}
          {navItems.map(item => {
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group',
                  isActive
                    ? 'bg-blue-600/15 text-blue-400'
                    : 'text-slate-400 hover:bg-[#1e2227] hover:text-slate-200'
                )}
              >
                <span className="material-symbols-outlined text-[20px] shrink-0">{item.icon}</span>
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </Link>
            )
          })}

          {/* ── Projects section ─────────────────────────────────── */}
          {!collapsed && (
            <>
              <div className="pt-3 pb-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">我的專案</span>
                  <button
                    onClick={fetchSidebarData}
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                    title="重新整理"
                  >
                    <span className={cn('material-symbols-outlined text-[13px]', loadingSidebar && 'animate-spin')}>refresh</span>
                  </button>
                </div>
              </div>

              {projects.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-slate-600 italic">
                  {loadingSidebar ? '載入中...' : '尚無專案'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {projects.map(project => {
                    const count = strategies.filter(s => (s.project_name || '未命名專案') === project).length
                    return (
                      <Link
                        key={project}
                        href={`/dashboard/history?project=${encodeURIComponent(project)}`}
                        className="flex items-center justify-between px-3 py-2 rounded-lg text-slate-400 hover:bg-[#1e2227] hover:text-slate-200 transition-colors group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="material-symbols-outlined text-[14px] text-slate-600 group-hover:text-blue-400 shrink-0">folder</span>
                          <span className="text-xs font-medium truncate">{project}</span>
                        </div>
                        <span className="text-[10px] bg-[#2d3439] text-slate-500 rounded px-1.5 py-0.5 shrink-0 ml-1">
                          {count}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Saved Strategies section ──────────────────────────── */}
          {!collapsed && (
            <>
              <div className="pt-3 pb-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">已存策略</span>
                  {strategies.length > 6 && (
                    <button
                      onClick={() => setShowAllStrategies(v => !v)}
                      className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showAllStrategies ? '收起' : `全部 ${strategies.length}`}
                    </button>
                  )}
                </div>
              </div>

              {strategies.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-slate-600 italic">
                  {loadingSidebar ? '載入中...' : '尚無已儲存策略'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {displayedStrategies.map(s => (
                    <button
                      key={s.id}
                      onClick={() => loadStrategyInBacktest(s.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-400 hover:bg-[#1e2227] hover:text-slate-200 transition-colors group"
                    >
                      <span className="material-symbols-outlined text-[14px] text-slate-600 group-hover:text-emerald-400 shrink-0">code</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate text-slate-300 group-hover:text-white">{s.strategy_name}</p>
                        <p className="text-[10px] text-slate-600 truncate">{s.project_name || '未命名專案'}</p>
                      </div>
                      <span className="material-symbols-outlined text-[13px] text-slate-700 group-hover:text-emerald-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        open_in_new
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Collapsed: just show icon hints */}
          {collapsed && (
            <div className="pt-2 space-y-1">
              <button
                title="我的策略"
                onClick={() => setCollapsed(false)}
                className="w-full flex justify-center py-2.5 text-slate-600 hover:text-slate-400 hover:bg-[#1e2227] rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">folder_open</span>
              </button>
            </div>
          )}
        </nav>

        {/* Admin link */}
        {isAdmin && !collapsed && (
          <div className="px-3 pb-1">
            <Link href="/dashboard/admin"
              className={cn('flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-colors',
                pathname.startsWith('/dashboard/admin')
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-slate-500 hover:text-amber-300 hover:bg-amber-500/10')}>
              <span className="material-symbols-outlined text-[18px]">admin_panel_settings</span>
              管理後台
            </Link>
          </div>
        )}

        {/* Bottom */}
        <div className="p-3 border-t border-[#2d3439] space-y-2 shrink-0">
          {!collapsed && (
            <Link
              href="/dashboard/backtest"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              新增回測
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center py-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-[#1e2227] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">
              {collapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-[#2d3439] bg-[#0a0d0f] flex items-center justify-end px-6 shrink-0">
          <UserButton afterSignOutUrl="/" />
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-[#080a0c]">
          {children}
        </main>
      </div>
    </div>
  )
}
