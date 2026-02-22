'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard',           icon: 'dashboard',    label: 'Dashboard' },
  { href: '/dashboard/backtest',  icon: 'tune',         label: 'Optimizer' },
  { href: '/dashboard/history',   icon: 'history',      label: 'History' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

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
        <div className="p-4 flex items-center gap-3 border-b border-[#2d3439]">
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

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
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
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-[#2d3439] space-y-2">
          {!collapsed && (
            <Link
              href="/dashboard/backtest"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              New Backtest
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
        <header className="h-14 border-b border-[#2d3439] bg-[#0a0d0f] flex items-center justify-between px-6 shrink-0">
          <div className="flex-1 max-w-md">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
              <input
                className="w-full bg-[#161b1e] border border-[#2d3439] rounded-lg pl-9 pr-4 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="搜尋策略、資產..."
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative text-slate-500 hover:text-slate-300 transition-colors">
              <span className="material-symbols-outlined">notifications</span>
              <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-[#0a0d0f]" />
            </button>
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-[#080a0c]">
          {children}
        </main>
      </div>
    </div>
  )
}
