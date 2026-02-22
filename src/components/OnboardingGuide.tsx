'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const STEPS = [
  {
    icon: 'code',
    title: '貼上 PineScript 策略',
    desc: '將您在 TradingView 撰寫的 PineScript v5 策略貼至左側程式碼編輯器。系統會自動偵測所有可調整參數。',
    tip: '點擊「載入範例」可快速試用雙均線範例策略。',
    color: 'bg-blue-600/20 text-blue-400 border-blue-500/30',
  },
  {
    icon: 'tune',
    title: '選擇資產 & 執行優化',
    desc: '選擇目標資產（BTC、ETH、黃金、納指期貨…）與時間週期，調整參數範圍後點擊「⚡ 執行優化」。',
    tip: '點擊「✨ AI 建議回測範圍」可讓 AI 自動設定合理的參數區間。',
    color: 'bg-violet-600/20 text-violet-400 border-violet-500/30',
  },
  {
    icon: 'analytics',
    title: '查看報告 & 匯出策略',
    desc: '優化完成後自動進入歷史報告，可查看淨報酬率、夏普比率、權益曲線及月度損益等詳細分析。',
    tip: '找到最佳參數後點擊「套用」即可匯出含新參數的 PineScript。',
    color: 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30',
  },
]

const STORAGE_KEY = 'backtestnow_onboarded_v1'

export default function OnboardingGuide() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch { /* SSR / blocked storage */ }
  }, [])

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#2d3439]">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-[#3b82f6] text-[20px]">rocket_launch</span>
              歡迎使用 BacktestNow
            </h2>
            <button onClick={dismiss} className="text-slate-500 hover:text-slate-300 transition-colors">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <p className="text-xs text-slate-500">3 步驟開始您的第一次策略優化回測</p>
        </div>

        {/* Step indicators */}
        <div className="px-6 pt-5 flex items-center gap-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'bg-[#3b82f6] w-6' : i < step ? 'bg-emerald-500 w-4' : 'bg-[#2d3439] w-4'}`}
            />
          ))}
          <span className="ml-auto text-[10px] text-slate-500 font-semibold">{step + 1} / {STEPS.length}</span>
        </div>

        {/* Step content */}
        <div className="px-6 py-5">
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${s.color} mb-4`}>
            <span className="material-symbols-outlined text-[28px] shrink-0">{s.icon}</span>
            <div>
              <p className="font-bold text-white text-sm mb-0.5">步驟 {step + 1}：{s.title}</p>
              <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-[#0a0d0f] border border-[#2d3439] rounded-lg px-3 py-2.5">
            <span className="material-symbols-outlined text-amber-400 text-[15px] mt-0.5 shrink-0">lightbulb</span>
            <p className="text-[11px] text-slate-400">{s.tip}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(p => p - 1)}
              className="px-4 py-2 bg-[#0a0d0f] border border-[#2d3439] text-slate-300 rounded-lg text-sm hover:bg-[#1e2227] transition-colors"
            >
              上一步
            </button>
          )}
          {!isLast ? (
            <button
              onClick={() => setStep(p => p + 1)}
              className="flex-1 bg-[#3b82f6] hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-sm transition-colors"
            >
              下一步
            </button>
          ) : (
            <Link
              href="/dashboard/backtest"
              onClick={dismiss}
              className="flex-1 text-center bg-[#3b82f6] hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-sm transition-colors"
            >
              開始回測 →
            </Link>
          )}
          <button onClick={dismiss} className="text-xs text-slate-600 hover:text-slate-400 transition-colors shrink-0">
            跳過
          </button>
        </div>
      </div>
    </div>
  )
}
