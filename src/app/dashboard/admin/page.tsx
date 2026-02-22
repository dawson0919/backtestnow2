'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'

const ADMIN_EMAIL = 'nbamoment@gmail.com'

interface Application {
  id: string
  user_id: string
  user_email: string
  user_name: string
  platform_account: string
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string
  created_at: string
  reviewed_at: string | null
}

export default function AdminPage() {
  const { user } = useUser()
  const router   = useRouter()
  const [apps, setApps]         = useState<Application[]>([])
  const [loading, setLoading]   = useState(true)
  const [note, setNote]         = useState<Record<string, string>>({})
  const [acting, setActing]     = useState<string | null>(null)
  const [filter, setFilter]     = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')

  const isAdmin = user?.primaryEmailAddress?.emailAddress === ADMIN_EMAIL

  useEffect(() => {
    if (user && !isAdmin) { router.replace('/dashboard'); return }
    if (isAdmin) fetchApps()
  }, [user, isAdmin])

  async function fetchApps() {
    setLoading(true)
    const res = await fetch('/api/admin/applications')
    if (res.ok) {
      const data = await res.json()
      setApps(data.applications ?? [])
    }
    setLoading(false)
  }

  async function act(id: string, action: 'approve' | 'reject') {
    setActing(id)
    const res = await fetch('/api/admin/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, note: note[id] ?? '' }),
    })
    if (res.ok) {
      setApps(prev => prev.map(a => a.id === id ? { ...a, status: action === 'approve' ? 'approved' : 'rejected', admin_note: note[id] ?? '' } : a))
    }
    setActing(null)
  }

  const displayed = apps.filter(a => filter === 'all' || a.status === filter)

  if (!user) return null
  if (!isAdmin) return null

  return (
    <div className="p-8 max-w-5xl space-y-6" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-400">admin_panel_settings</span>
          管理員 — 進階會員申請審核
        </h1>
        <button onClick={fetchApps} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 border border-[#2d3439] bg-[#161b1e] px-2.5 py-1 rounded-lg">
          <span className="material-symbols-outlined text-[14px]">refresh</span>刷新
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-bold transition-colors ${filter === f ? 'bg-[#3b82f6] text-white' : 'bg-[#161b1e] border border-[#2d3439] text-slate-400'}`}>
            {f === 'pending' ? '待審核' : f === 'approved' ? '已通過' : f === 'rejected' ? '已拒絕' : '全部'}
            {f !== 'all' && (
              <span className="ml-1 opacity-70">({apps.filter(a => a.status === f).length})</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <span className="material-symbols-outlined animate-spin mr-2">sync</span>載入中...
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-2">
          <span className="material-symbols-outlined text-5xl">inbox</span>
          <p>{filter === 'pending' ? '目前沒有待審核的申請' : '沒有記錄'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(a => (
            <div key={a.id} className="bg-[#161b1e] border border-[#2d3439] rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                      a.status === 'pending'  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                      a.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                               'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      {a.status === 'pending' ? '待審核' : a.status === 'approved' ? '已通過' : '已拒絕'}
                    </span>
                    <span className="text-sm font-bold text-white">{a.user_name || '(未知)'}</span>
                    <span className="text-xs text-slate-500">{a.user_email}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500">交易平台帳號：</span>
                      <span className="text-white font-mono font-bold">{a.platform_account || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">申請時間：</span>
                      <span className="text-slate-300">{new Date(a.created_at).toLocaleString('zh-TW')}</span>
                    </div>
                    {a.admin_note && (
                      <div className="col-span-2">
                        <span className="text-slate-500">備注：</span>
                        <span className="text-slate-300">{a.admin_note}</span>
                      </div>
                    )}
                  </div>
                </div>

                {a.status === 'pending' && (
                  <div className="flex flex-col gap-2 shrink-0 min-w-[180px]">
                    <input
                      type="text"
                      placeholder="備注（可選）"
                      value={note[a.id] ?? ''}
                      onChange={e => setNote(prev => ({ ...prev, [a.id]: e.target.value }))}
                      className="text-xs bg-[#0a0d0f] border border-[#2d3439] rounded px-2 py-1.5 text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => act(a.id, 'approve')} disabled={acting === a.id}
                        className="flex-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-bold py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                        {acting === a.id ? '...' : '通過'}
                      </button>
                      <button onClick={() => act(a.id, 'reject')} disabled={acting === a.id}
                        className="flex-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-bold py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                        {acting === a.id ? '...' : '拒絕'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
