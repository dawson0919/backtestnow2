import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0d0f] text-slate-100 overflow-x-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Top Banner */}
      <div className="flex justify-center pt-6 px-4">
        <div className="inline-flex items-center gap-2 bg-[#1e2227] border border-[#31363a] rounded-full px-4 py-2 text-xs font-semibold text-slate-300">
          <span className="text-blue-400">✦</span>
          2024 AI 策略優化引擎全新進化
        </div>
      </div>

      {/* Hero Section */}
      <section className="flex flex-col items-center text-center px-6 pt-12 pb-16 max-w-4xl mx-auto">
        <h1 className="text-5xl sm:text-6xl font-black leading-tight tracking-tight">
          <span className="text-white">BacktestNow</span>
          <br />
          <span className="gradient-text">AI 強力驅動回測</span>
        </h1>
        <p className="mt-6 text-lg text-slate-400 max-w-2xl leading-relaxed">
          將您的 TradingView PineScript 策略優化至極致。運用自動化參數掃描與深度數據分析，助您在多變市場中精準點擊，奪得交易先機。
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 px-8 rounded-xl text-base transition-all shadow-lg shadow-blue-900/30"
          >
            立即啟動優化 <span className="text-lg">→</span>
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 bg-[#1e2227] hover:bg-[#252b33] border border-[#31363a] text-slate-200 font-semibold py-3.5 px-8 rounded-xl text-base transition-all"
          >
            登入
          </Link>
        </div>
      </section>

      {/* Core Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-black text-center mb-10">網站核心功能</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {[
            {
              icon: '⚡',
              title: 'AI 參數自動遍歷',
              desc: '告別手動調整！AI 引擎自動執行數千次迭代，精確找出各種市場狀況下的最佳參數範圍。',
              color: 'text-blue-400',
              border: 'border-blue-500/20',
            },
            {
              icon: '🗄️',
              title: '深度歷史數據整合',
              desc: '整合幣安 (Binance) 等主流交易所的深度 Tick 級數據，確保回測結果最接近真實市場反應。',
              color: 'text-emerald-400',
              border: 'border-emerald-500/20',
            },
            {
              icon: '📊',
              title: '全方位績效分析',
              desc: '自動計算 Sharpe Ratio、最大回撤、勝率、利潤因子等核心指標，一鍵掌握策略優劣。',
              color: 'text-purple-400',
              border: 'border-purple-500/20',
            },
            {
              icon: '🔁',
              title: '一鍵匯出最佳代碼',
              desc: '找到最佳參數後，系統自動生成含新參數的 PineScript 代碼，直接貼回 TradingView 即可使用。',
              color: 'text-amber-400',
              border: 'border-amber-500/20',
            },
          ].map(f => (
            <div
              key={f.title}
              className={`card-hover bg-[#161b1e] border ${f.border} rounded-2xl p-6`}
            >
              <div className={`text-3xl mb-3 ${f.color}`}>{f.icon}</div>
              <h3 className={`text-lg font-bold mb-2 ${f.color}`}>{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Supported Assets */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-black text-center mb-8">支援資產</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'BTC/USDT', sub: '比特幣', type: 'crypto', color: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
            { label: 'ETH/USDT', sub: '以太坊', type: 'crypto', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
            { label: 'SOL/USDT', sub: 'Solana', type: 'crypto', color: 'bg-purple-500/10 border-purple-500/30 text-purple-400' },
            { label: 'BNB/USDT', sub: 'Binance Coin', type: 'crypto', color: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' },
            { label: 'GC (Gold)', sub: '黃金期貨', type: 'futures', color: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' },
            { label: 'NQ (Nasdaq)', sub: '納指期貨', type: 'futures', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
            { label: 'ES (S&P 500)', sub: '標普期貨', type: 'futures', color: 'bg-green-500/10 border-green-500/30 text-green-400' },
            { label: 'SIL (Silver)', sub: '白銀期貨', type: 'futures', color: 'bg-slate-400/10 border-slate-400/30 text-slate-300' },
          ].map(a => (
            <div
              key={a.label}
              className={`card-hover border rounded-xl p-4 text-center ${a.color}`}
            >
              <div className="font-bold text-sm">{a.label}</div>
              <div className="text-xs text-slate-500 mt-1">{a.sub}</div>
              <div className="text-[10px] mt-1 opacity-60 uppercase tracking-wide">{a.type}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow Steps */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <h2 className="text-2xl font-black text-center mb-10">三步驟完成最佳化</h2>
        <div className="relative">
          <div className="hidden sm:block absolute top-8 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#31363a] to-transparent" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { step: '01', title: '上傳 PineScript', desc: '貼上您的策略代碼，系統自動擷取所有可調整參數。' },
              { step: '02', title: '設定優化範圍', desc: '自訂每個參數的最小值、最大值與間距，或讓 AI 自動決定（1,000〜10,000 組合）。' },
              { step: '03', title: '匯出最佳代碼', desc: '查看排行榜，選擇最佳參數組合，一鍵生成新的 PineScript 代碼。' },
            ].map(s => (
              <div key={s.step} className="flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-2xl font-black text-blue-400 mb-4">
                  {s.step}
                </div>
                <h3 className="text-base font-bold mb-2">{s.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Bottom */}
      <section className="text-center pb-24 px-6">
        <div className="inline-flex flex-col items-center gap-4 bg-[#161b1e] border border-[#31363a] rounded-3xl p-10 max-w-xl mx-auto">
          <span className="text-4xl">🚀</span>
          <h2 className="text-2xl font-black">立即開始免費優化</h2>
          <p className="text-slate-400 text-sm">無需信用卡，立即體驗 AI 策略優化引擎</p>
          <Link
            href="/sign-up"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/30"
          >
            免費建立帳號
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1e2227] py-8 px-6 text-center text-xs text-slate-500">
        <p>© 2024 BacktestNow. All rights reserved. 資料僅供參考，不構成投資建議。</p>
      </footer>
    </div>
  )
}
