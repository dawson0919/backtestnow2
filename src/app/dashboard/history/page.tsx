'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { supabase } from '@/lib/supabase'
import { formatPercent } from '@/lib/utils'

interface OptHist {
  id: string
  asset: string
  timeframe: string
  code: string
  net_profit_pct: string
  top_params: Record<string, unknown>
  created_at: string
}

export default function HistoryPage() {
  const { user } = useUser()
  const [records, setRecords] = useState<OptHist[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<OptHist | null>(null)
  const [showCode, setShowCode] = useState(false)

  useEffect(() => {
    if (user?.id) fetchHistory()
  }, [user])

  async function fetchHistory() {
    setLoading(true)
    const { data } = await supabase
      .from('optimization_history')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
    if (data) setRecords(data)
    setLoading(false)
  }

  const best = records[0]
  const avgReturn = records.length
    ? records.reduce((s, r) => s + parseFloat(r.net_profit_pct || '0'), 0) / records.length
    : 0

  return (
    <div className="min-h-full bg-[#080a0c]" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#2d3439] bg-[#0a0d0f]/90 backdrop-blur px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-[#161b1e] border border-[#2d3439] rounded-lg">
              <span className="material-symbols-outlined text-blue-400">analytics</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">優化歷史記錄</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-0.5">
                Optimization History · {records.length} records
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/backtest"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/30"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              新回測
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Metrics */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: '總優化次數', value: String(records.length), icon: 'swap_horiz', bar: Math.min(records.length / 20, 1) },
            { label: '最佳收益', value: best ? formatPercent(parseFloat(best.net_profit_pct)) : '—', icon: 'insights', color: best && parseFloat(best.net_profit_pct) >= 0 ? 'text-emerald-400' : 'text-red-400', bar: 0.68 },
            { label: '平均收益', value: formatPercent(avgReturn), icon: 'calculate', color: avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400', bar: 0.5 },
            { label: '本月回測', value: String(records.filter(r => r.created_at.startsWith(new Date().toISOString().substring(0, 7))).length), icon: 'payments', bar: 0.4 },
          ].map(m => (
            <div key={m.label} className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl p-5 space-y-2">
              <div className="flex justify-between items-start">
                <p className="text-xs font-medium text-slate-500">{m.label}</p>
                <span className="material-symbols-outlined text-slate-600 text-xl">{m.icon}</span>
              </div>
              <p className={`text-3xl font-black ${m.color || 'text-white'}`}>{m.value}</p>
              <div className="h-1 bg-[#1e2227] rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: `${(m.bar || 0) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>

        {/* Table */}
        <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl overflow-hidden">
          <div className="p-5 border-b border-[#2d3439]">
            <h2 className="text-lg font-bold text-white">優化結果列表</h2>
            <p className="text-slate-500 text-sm mt-0.5">點擊記錄查看詳情</p>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500">
              <span className="material-symbols-outlined text-4xl block mb-2 animate-spin">sync</span>
              載入中...
            </div>
          ) : records.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <span className="material-symbols-outlined text-5xl block mb-3">history</span>
              <p className="font-medium">尚無優化記錄</p>
              <Link href="/dashboard/backtest" className="text-blue-400 hover:underline text-sm mt-2 inline-block">
                開始第一次回測 →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0d1117]">
                    {['資產', '週期', '最佳回報', '最佳參數', '日期', '操作'].map(h => (
                      <th key={h} className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-[#2d3439]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2227]">
                  {records.map(r => {
                    const pct = parseFloat(r.net_profit_pct || '0')
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelected(r)}
                        className="hover:bg-[#161b1e] cursor-pointer transition-colors"
                      >
                        <td className="p-4 font-semibold text-sm text-white">{r.asset}</td>
                        <td className="p-4 text-sm text-slate-300">{r.timeframe}</td>
                        <td className={`p-4 font-bold text-sm ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatPercent(pct)}
                        </td>
                        <td className="p-4 text-xs text-slate-400 font-mono">
                          {r.top_params ? Object.entries(r.top_params).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' | ') : '—'}
                        </td>
                        <td className="p-4 text-sm text-slate-500">
                          {new Date(r.created_at).toLocaleDateString('zh-TW')}
                        </td>
                        <td className="p-4">
                          <button
                            onClick={e => { e.stopPropagation(); setSelected(r); setShowCode(true) }}
                            className="text-xs font-bold text-blue-400 hover:underline"
                          >
                            查看代碼
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Selected detail */}
        {selected && (
          <section className="bg-[#0a0d0f] border border-[#2d3439] rounded-xl overflow-hidden">
            <div className="p-5 border-b border-[#2d3439] flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">{selected.asset} · {selected.timeframe} — 詳細報告</h2>
                <p className="text-slate-500 text-xs mt-0.5">{new Date(selected.created_at).toLocaleString('zh-TW')}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCode(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#161b1e] border border-[#2d3439] hover:bg-[#1e2227] rounded-lg text-xs font-bold text-slate-300 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">terminal</span>
                  查看代碼
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="px-3 py-1.5 text-slate-500 hover:text-slate-300"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            </div>

            {selected.top_params && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0d1117]">
                      {['參數名', '最佳值', '狀態'].map(h => (
                        <th key={h} className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-[#2d3439]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2227]">
                    {Object.entries(selected.top_params).map(([k, v]) => (
                      <tr key={k} className="hover:bg-[#161b1e] transition-colors">
                        <td className="p-4 font-semibold text-sm text-white">{k}</td>
                        <td className="p-4 font-mono text-sm text-emerald-400 font-bold">{String(v)}</td>
                        <td className="p-4">
                          <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-black uppercase rounded">Optimized</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Code Modal */}
      {showCode && selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#2d3439]">
              <div>
                <h3 className="font-bold text-white">PineScript 代碼 — {selected.asset}</h3>
                <p className="text-xs text-slate-400 mt-0.5">含優化後參數的完整策略代碼</p>
              </div>
              <button onClick={() => setShowCode(false)} className="text-slate-500 hover:text-slate-300">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="bg-[#0d1117] rounded-lg p-4 text-[12px] font-mono text-slate-300 whitespace-pre-wrap">
                {selected.code}
              </pre>
            </div>
            <div className="p-4 border-t border-[#2d3439] flex gap-3">
              <button
                onClick={() => navigator.clipboard.writeText(selected.code)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                複製代碼
              </button>
              <button
                onClick={() => setShowCode(false)}
                className="px-4 bg-[#0a0d0f] border border-[#2d3439] text-slate-300 rounded-lg text-sm hover:bg-[#1e2227] transition-colors"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
