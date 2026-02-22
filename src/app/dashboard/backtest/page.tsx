'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { parsePineScript, generateUpdatedCode, DUAL_MA_EXAMPLE } from '@/lib/pinescript-parser'
import { buildParamRangesFromParsed, estimateCombinations, ParamRange } from '@/lib/optimization'
import { BacktestResult } from '@/lib/backtest-engine'
import { cn, formatPercent } from '@/lib/utils'

const ASSETS = [
  { symbol: 'BTCUSDT', label: 'BTC/USD'  },
  { symbol: 'ETHUSDT', label: 'ETH/USD'  },
  { symbol: 'SOLUSDT', label: 'SOL/USD'  },
  { symbol: 'BNBUSDT', label: 'BNB/USD'  },
  { symbol: 'GC!',     label: 'GC (Gold)'},
  { symbol: 'NQ!',     label: 'NQ1!'     },
  { symbol: 'ES!',     label: 'ES1!'     },
  { symbol: 'SIL!',    label: 'SIL (Silver)' },
]

// Only timeframes that exist in the database
const TIMEFRAMES = [
  { v: '1H', l: '1H' }, { v: '4H', l: '4H' }, { v: '1D', l: '1D' },
]

const SORT_OPTIONS = [
  { value: 'totalReturnPct', label: '淨報酬率 %'  },
  { value: 'sharpeRatio',    label: '夏普比率'    },
  { value: 'profitFactor',   label: '獲利因子'    },
  { value: 'winRate',        label: '勝率 %'      },
]

interface OptResult { rank: number; result: BacktestResult; score: number }

function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const lines = value.split('\n')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const numbersRef  = useRef<HTMLDivElement>(null)

  function syncScroll() {
    if (textareaRef.current && numbersRef.current) {
      numbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden font-mono text-[13px] leading-6">
      {/* Line numbers */}
      <div
        ref={numbersRef}
        className="select-none text-right text-slate-600 bg-[#0d1117] px-3 pt-4 pb-4 overflow-hidden shrink-0 w-10"
        style={{ lineHeight: '1.5rem' }}
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      {/* Code area */}
      <textarea
        ref={textareaRef}
        className="flex-1 bg-[#0d1117] text-slate-300 resize-none focus:outline-none p-4 overflow-auto"
        style={{ lineHeight: '1.5rem' }}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        placeholder="// 在此貼上您的 PineScript v5 策略..."
      />
    </div>
  )
}

function BacktestContent() {
  const { user }       = useUser()
  const searchParams   = useSearchParams()
  const [code, setCode]               = useState(DUAL_MA_EXAMPLE)
  const [asset, setAsset]             = useState(searchParams.get('asset') || 'BTCUSDT')
  const [timeframe, setTimeframe]     = useState('1H')
  const [maxCombos, setMaxCombos]     = useState(1000)
  const [sortBy, setSortBy]           = useState('totalReturnPct')
  const [paramRanges, setParamRanges] = useState<ParamRange[]>([])
  const [results, setResults]         = useState<OptResult[]>([])
  const [running, setRunning]         = useState(false)
  const [progress, setProgress]       = useState(0)
  const [logs, setLogs]               = useState<string[]>([])
  const [selectedResult, setSelectedResult] = useState<OptResult | null>(null)
  const [detailResult, setDetailResult]     = useState<OptResult | null>(null)
  const [showExport, setShowExport]   = useState(false)
  const [exportedCode, setExportedCode] = useState('')
  const [activeTab, setActiveTab]     = useState<'editor'|'results'>('editor')
  const [projectName, setProjectName] = useState('')
  const [showHelp, setShowHelp]       = useState(false)
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiReasons, setAiReasons]     = useState<{varName:string;reason:string}[]>([])
  const [barCount, setBarCount]       = useState<number | null>(null)
  const [barCountLoading, setBarCountLoading] = useState(false)

  // Strategy save / load
  const [showStrategies, setShowStrategies] = useState(false)
  const [strategyName, setStrategyName]     = useState('')
  const [savedStrategies, setSavedStrategies] = useState<{id:string;project_name:string;strategy_name:string;updated_at:string}[]>([])
  const [loadingStrategies, setLoadingStrategies] = useState(false)
  const [savingStrategy, setSavingStrategy] = useState(false)
  const [saveMsg, setSaveMsg]               = useState('')

  const logsRef = useRef<HTMLDivElement>(null)
  const estimatedCombos = estimateCombinations(paramRanges)

  // Fetch bar count when asset or timeframe changes
  useEffect(() => {
    setBarCount(null)
    setBarCountLoading(true)
    fetch(`/api/bar-count?symbol=${encodeURIComponent(asset)}&timeframe=${encodeURIComponent(timeframe)}`)
      .then(r => r.json())
      .then(d => setBarCount(d.count ?? null))
      .catch(() => setBarCount(null))
      .finally(() => setBarCountLoading(false))
  }, [asset, timeframe])

  // Auto-load strategy from ?strategy=id URL param
  useEffect(() => {
    const stratId = searchParams.get('strategy')
    if (stratId) {
      fetch(`/api/strategies/${stratId}`)
        .then(r => r.json())
        .then(data => {
          if (data.strategy) {
            const s = data.strategy
            setCode(s.code)
            parseCode(s.code)
            setStrategyName(s.strategy_name)
            setProjectName(s.project_name)
          } else {
            parseCode(DUAL_MA_EXAMPLE)
          }
        })
        .catch(() => parseCode(DUAL_MA_EXAMPLE))
    } else {
      parseCode(DUAL_MA_EXAMPLE)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  function parseCode(src: string) {
    setParamRanges(buildParamRangesFromParsed(parsePineScript(src).params))
  }
  function handleCodeChange(v: string) { setCode(v); parseCode(v) }

  function addLog(msg: string) {
    const t = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setLogs(p => [...p, `[${t}] ${msg}`])
  }

  async function runOptimization() {
    if (!code.trim() || running) return
    setRunning(true); setResults([]); setProgress(0); setLogs([]); setActiveTab('results')
    const parsed = parsePineScript(code)
    addLog(`Fetching ${asset} ${timeframe} data (all available bars)...`)
    const iv = setInterval(() => setProgress(p => Math.min(p + Math.random() * 7, 90)), 350)
    const enabledCount = paramRanges.filter(r => r.enabled).length
    addLog(`Starting ${Math.min(estimatedCombos, maxCombos).toLocaleString()} combinations over ${enabledCount} parameters...`)
    try {
      // Pre-store ALL parsed varNames with their defaults so result.params always
      // contains every variable name from the user's code. Enabled int/float params
      // will be overridden by the optimizer combo; disabled ones keep their default.
      const fixedParams: Record<string, string|number|boolean> = {}
      parsed.params.forEach(p => { fixedParams[p.varName] = p.defaultValue })
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: asset, interval: timeframe, pineCode: code, config: { strategyType: parsed.detectedLogic, paramRanges, fixedParams, maxCombinations: Math.min(maxCombos, 10000), sortBy, topN: 50 } }),
      })
      clearInterval(iv); setProgress(100)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data.results || [])
      if (data.results?.length > 0) {
        setSelectedResult(data.results[0])
        const b = data.results[0].result
        addLog(`✅ Done! Tested ${data.testedCount ?? data.totalResults} sets on ${data.barsCount} bars.`)
        if (data.timedOut) addLog(`⚠️  Timeout: returned partial results (${data.totalResults} found before 50s limit).`)
        addLog(`🏆 Best: Return ${formatPercent(b.totalReturnPct)}, Sharpe ${b.sharpeRatio}, WinRate ${b.winRate.toFixed(1)}%`)
        if (user?.id) {
          await fetch('/api/save-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset, timeframe, code,
              projectName:     projectName.trim() || `${asset} ${timeframe}`,
              netProfitPct:    b.totalReturnPct.toFixed(2),
              topParams:       b.params,
              assetType:       data.assetType,
              pointValue:      data.pointValue,
              totalReturnPct:  b.totalReturnPct,
              maxDrawdownPct:  b.maxDrawdownPct,
              sharpeRatio:     b.sharpeRatio,
              winRate:         b.winRate,
              profitFactor:    b.profitFactor,
              totalTrades:     b.totalTrades,
              totalDollarPnL:  b.totalDollarPnL,
              monthlyPnL:      b.monthlyPnL,
              tradesSummary:   b.trades?.map((t: { entryTimestamp: number; exitTimestamp: number; pnlPct: number; pnlDollars: number; entryPrice: number; exitPrice: number; direction: string }) => ({
                entryTs: t.entryTimestamp, exitTs: t.exitTimestamp,
                pnlPct: t.pnlPct, pnlDollars: t.pnlDollars,
                entry: t.entryPrice, exit: t.exitPrice,
                direction: t.direction ?? 'long',
              })),
            }),
          })
          addLog('💾 Saved to history.')
        }
      } else {
        addLog('⚠️  No valid results. Try widening parameter ranges.')
      }
    } catch (err) {
      clearInterval(iv); setProgress(0)
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally { setRunning(false) }
  }

  function applyResult(r: OptResult) {
    const updated = generateUpdatedCode(code, parsePineScript(code).params, r.result.params as Record<string, number|string|boolean>)
    setExportedCode(updated); setShowExport(true)
  }

  function updateRange(idx: number, field: keyof ParamRange, value: number|boolean) {
    setParamRanges(prev => prev.map((r,i) => i === idx ? { ...r, [field]: value } : r))
  }

  async function aiSuggestRanges() {
    if (!code.trim() || paramRanges.length === 0 || aiLoading) return
    setAiLoading(true)
    setAiReasons([])
    try {
      const res = await fetch('/api/ai-suggest-ranges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: paramRanges }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setParamRanges(data.updatedRanges)
      setAiReasons(data.reasons || [])
    } catch (err) {
      addLog(`❌ AI建議失敗: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally {
      setAiLoading(false)
    }
  }

  async function openStrategyBrowser() {
    setShowStrategies(true)
    setLoadingStrategies(true)
    try {
      const res = await fetch('/api/strategies')
      const data = await res.json()
      setSavedStrategies(data.strategies || [])
    } catch { /* ignore */ }
    finally { setLoadingStrategies(false) }
  }

  async function saveStrategy() {
    if (!code.trim() || !strategyName.trim() || savingStrategy) return
    setSavingStrategy(true); setSaveMsg('')
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: projectName.trim() || '未命名專案', strategyName: strategyName.trim(), code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSaveMsg('✅ 策略已儲存！')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (err) {
      setSaveMsg(`❌ ${err instanceof Error ? err.message : '儲存失敗'}`)
    } finally { setSavingStrategy(false) }
  }

  async function loadStrategy(id: string) {
    try {
      const res = await fetch(`/api/strategies/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const s = data.strategy
      setCode(s.code); parseCode(s.code)
      setStrategyName(s.strategy_name)
      setProjectName(s.project_name)
      setShowStrategies(false)
      addLog(`📂 已載入策略：${s.strategy_name}`)
    } catch (err) {
      addLog(`❌ 載入失敗: ${err instanceof Error ? err.message : ''}`)
    }
  }

  async function deleteStrategy(id: string) {
    if (!confirm('確定要刪除此策略嗎？')) return
    await fetch(`/api/strategies?id=${id}`, { method: 'DELETE' })
    setSavedStrategies(prev => prev.filter(s => s.id !== id))
  }

  const best = selectedResult?.result

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0a0d0f]" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ── Top header ────────────────────────────────────────── */}
      <header className="h-11 flex items-center justify-between px-5 border-b border-[#2d3439] bg-[#0a0d0f] shrink-0">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-[#3b82f6] text-[18px]">query_stats</span>
          <h2 className="text-sm font-bold text-white">策略優化器</h2>
          <div className="flex items-center gap-1 text-slate-500 text-xs">
            <span>專案</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-slate-300">{parsePineScript(code).strategyName || 'Untitled'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-[14px]">search</span>
            <input className="bg-[#161b1e] border border-[#2d3439] rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#3b82f6] w-44" placeholder="搜尋策略、資產..." />
          </div>
          <button
            onClick={openStrategyBrowser}
            className="flex items-center gap-1.5 bg-[#161b1e] border border-[#2d3439] text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#1e2227] transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">folder_open</span>
            我的策略
          </button>
          <button
            onClick={() => setShowHelp(h => !h)}
            className="flex items-center gap-1.5 bg-[#161b1e] border border-[#2d3439] text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#1e2227] transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">help_outline</span>
            使用說明
          </button>
          <button
            onClick={() => { setCode(DUAL_MA_EXAMPLE); parseCode(DUAL_MA_EXAMPLE) }}
            className="flex items-center gap-1.5 bg-[#161b1e] border border-[#2d3439] text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#1e2227] transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">save</span>
            載入範例
          </button>
        </div>
      </header>

      {/* ── Help Panel ────────────────────────────────────────── */}
      {showHelp && (
        <div className="border-b border-[#2d3439] bg-[#0d1117] px-6 py-4 shrink-0 overflow-y-auto max-h-72">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-[#3b82f6] text-[16px]">menu_book</span>
                策略優化器 — 詳細使用說明
              </h3>
              <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-slate-300">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400">
              <div className="bg-[#161b1e] border border-[#2d3439] rounded-lg p-3 space-y-2">
                <p className="text-white font-semibold flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-blue-600/20 text-blue-400 rounded flex items-center justify-center text-[10px] font-black">1</span>
                  貼上 PineScript 程式碼
                </p>
                <p>在左側編輯器貼上您的 TradingView PineScript v5 策略。系統會自動偵測所有 <code className="text-blue-300">input.*</code> 參數（例如 MA 週期、RSI 閾值）。</p>
                <p className="text-slate-500">💡 點擊「載入範例」可快速載入雙均線範例策略進行測試。</p>
              </div>
              <div className="bg-[#161b1e] border border-[#2d3439] rounded-lg p-3 space-y-2">
                <p className="text-white font-semibold flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-blue-600/20 text-blue-400 rounded flex items-center justify-center text-[10px] font-black">2</span>
                  設定參數範圍與資產
                </p>
                <p>在右側面板選擇目標資產（BTC/ETH/Gold…）與時間週期（1H / 4H）。</p>
                <p>在「參數範圍設定」中調整每個變數的最小值、最大值與步長。</p>
                <p>點擊「✨ AI 建議回測範圍」可自動產生適合的範圍建議。</p>
                <p className="text-slate-500">💡 勾選/取消勾選右側核取框可啟用或停用個別參數優化。</p>
              </div>
              <div className="bg-[#161b1e] border border-[#2d3439] rounded-lg p-3 space-y-2">
                <p className="text-white font-semibold flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-blue-600/20 text-blue-400 rounded flex items-center justify-center text-[10px] font-black">3</span>
                  執行優化 & 匯出結果
                </p>
                <p>填寫「專案名稱」後點擊「⚡ 執行優化」。系統會在雲端跑完所有參數組合（最多 10,000 組）。</p>
                <p>完成後在「優化結果」頁籤查看排行榜，選擇最佳組合後點擊「套用」即可匯出含新參數的 PineScript。</p>
                <p className="text-slate-500">💡 排序依據可切換為：淨報酬率 / 夏普比率 / 獲利因子 / 勝率。</p>
              </div>
            </div>
            <div className="mt-3 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg text-[11px] text-amber-300">
              ⚠️ 注意：若出現「Insufficient data」錯誤，請至儀表板點擊「補充歷史資料」按鈕以填補所需 K 棒數據（約需 30 秒）。
            </div>
          </div>
        </div>
      )}

      {/* ── Main workspace ────────────────────────────────────── */}
      <main className="flex flex-1 overflow-hidden">

        {/* Icon sidebar */}
        <aside className="w-14 border-r border-[#2d3439] bg-[#0a0d0f] flex flex-col items-center py-3 gap-3 shrink-0">
          {[
            { icon: 'code',      tab: 'editor'  as const, tip: '程式碼編輯器' },
            { icon: 'bar_chart', tab: 'results' as const, tip: '優化結果'    },
          ].map(b => (
            <button key={b.tab} title={b.tip} onClick={() => setActiveTab(b.tab)}
              className={cn('p-2.5 rounded-lg transition-colors', activeTab===b.tab ? 'text-[#3b82f6] bg-blue-600/10' : 'text-slate-500 hover:text-slate-300 hover:bg-[#161b1e]')}>
              <span className="material-symbols-outlined text-[22px]">{b.icon}</span>
            </button>
          ))}
          <button title="設定" className="mt-auto p-2.5 text-slate-600 hover:text-slate-300 transition-colors">
            <span className="material-symbols-outlined text-[22px]">settings</span>
          </button>
        </aside>

        {/* Code editor */}
        <section className={cn('flex-1 flex flex-col bg-[#0a0d0f] min-w-0', activeTab !== 'editor' && 'hidden md:flex')}>
          {/* File tab */}
          <div className="flex items-center bg-[#161b1e] border-b border-[#2d3439] px-4 h-9 gap-1 shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1 border-b-2 border-[#3b82f6]">
              <span className="material-symbols-outlined text-[12px] text-orange-400">javascript</span>
              <span className="text-xs text-white font-medium">strategy.pine</span>
            </div>
          </div>
          <CodeEditor value={code} onChange={handleCodeChange} />
        </section>

        {/* Results panel (md breakpoint) */}
        {activeTab === 'results' && (
          <section className="flex-1 flex flex-col bg-[#080a0c] min-w-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#2d3439] flex items-center justify-between shrink-0">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">優化結果</h3>
              {results.length > 0 && <span className="text-[10px] text-slate-500">{results.length} 筆結果</span>}
            </div>
            {results.length > 0 ? (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0a0d0f]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-slate-500 font-medium border-b border-[#2d3439]">#</th>
                      {Object.keys(results[0].result.params).map(k => (
                        <th key={k} className="px-3 py-2.5 text-left text-slate-500 font-medium border-b border-[#2d3439] capitalize">{k}</th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-slate-500 font-medium border-b border-[#2d3439]">淨利潤</th>
                      <th className="px-3 py-2.5 text-right text-slate-500 font-medium border-b border-[#2d3439]">最大回撤</th>
                      <th className="px-3 py-2.5 text-right text-slate-500 font-medium border-b border-[#2d3439]">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2227]">
                    {results.map(r => (
                      <tr key={r.rank}
                        onClick={() => { setSelectedResult(r); setDetailResult(r) }}
                        className={cn('hover:bg-[#1e2227] cursor-pointer transition-colors group', selectedResult?.rank===r.rank && 'bg-blue-600/10')}>
                        <td className="px-3 py-2.5 text-slate-500">#{r.rank}</td>
                        {Object.values(r.result.params).map((v,i) => (
                          <td key={i} className="px-3 py-2.5 text-white font-medium">{String(v)}</td>
                        ))}
                        <td className={cn('px-3 py-2.5 text-right font-bold', r.result.totalReturnPct>=0 ? 'text-emerald-400' : 'text-red-400')}>
                          {formatPercent(r.result.totalReturnPct)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-red-400">{r.result.maxDrawdownPct.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right">
                          <button onClick={e => { e.stopPropagation(); applyResult(r) }}
                            className="text-[#3b82f6] opacity-0 group-hover:opacity-100 font-semibold hover:underline transition-opacity">套用</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-sm gap-2">
                <span className="material-symbols-outlined text-5xl">bar_chart</span>
                <p>執行優化後顯示結果</p>
              </div>
            )}
          </section>
        )}

        {/* ── Right control panel ─────────────────────────────── */}
        <section className="w-[400px] flex flex-col border-l border-[#2d3439] bg-[#0a0d0f] shrink-0 overflow-y-auto">

          {/* Target Assets */}
          <div className="p-4 border-b border-[#2d3439]">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3">目標資產</h3>
            <div className="flex flex-wrap gap-2">
              {ASSETS.map(a => (
                <button key={a.symbol} onClick={() => setAsset(a.symbol)}
                  className={cn('px-3 py-1.5 rounded text-xs font-bold transition-colors',
                    asset === a.symbol
                      ? 'bg-[#3b82f6] text-white'
                      : 'bg-[#161b1e] border border-[#2d3439] text-slate-300 hover:border-[#3b82f6]/40')}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Timeframe + settings */}
          <div className="p-4 border-b border-[#2d3439]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500">時間週期</h3>
              <span className="text-[10px] text-slate-500">
                {barCountLoading
                  ? <span className="animate-pulse text-slate-600">計算中...</span>
                  : barCount !== null
                    ? <span className={barCount === 0 ? 'text-red-400' : 'text-emerald-400'}>
                        {barCount === 0 ? '無資料' : `${barCount.toLocaleString()} 筆 K 棒可用`}
                      </span>
                    : null
                }
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {TIMEFRAMES.map(tf => (
                <button key={tf.v} onClick={() => setTimeframe(tf.v)}
                  className={cn('py-1.5 rounded text-xs font-bold transition-colors border',
                    timeframe === tf.v
                      ? 'bg-[#3b82f6] border-[#3b82f6] text-white'
                      : 'bg-[#161b1e] border-[#2d3439] text-slate-400 hover:border-slate-500')}>
                  {tf.l}
                </button>
              ))}
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">排序依據</label>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                className="w-full bg-[#161b1e] border border-[#2d3439] rounded text-xs text-slate-200 py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Variables Range */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500">參數範圍設定</h3>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-[#3b82f6] font-semibold">
                  ~{Math.min(estimatedCombos, maxCombos).toLocaleString()} 組合
                </span>
                <button onClick={() => { parseCode(code); setAiReasons([]) }} className="text-[10px] text-slate-500 hover:text-slate-300 hover:underline">重置</button>
              </div>
            </div>

            {/* AI Suggest Button */}
            <button
              onClick={aiSuggestRanges}
              disabled={aiLoading || paramRanges.length === 0}
              className="w-full mb-3 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600/20 to-blue-600/20 border border-violet-500/30 hover:border-violet-400/60 disabled:opacity-50 disabled:cursor-not-allowed text-violet-300 hover:text-violet-200 text-xs font-semibold py-2 rounded-lg transition-all"
            >
              <span className={cn('material-symbols-outlined text-[15px]', aiLoading && 'animate-spin')}>
                {aiLoading ? 'sync' : 'auto_awesome'}
              </span>
              {aiLoading ? 'AI 分析中...' : 'AI 建議回測範圍'}
            </button>

            {/* AI Reasons */}
            {aiReasons.length > 0 && (
              <div className="mb-3 bg-violet-900/10 border border-violet-500/20 rounded-lg p-2.5 space-y-1">
                {aiReasons.map(r => (
                  <div key={r.varName} className="flex gap-1.5 text-[10px]">
                    <span className="text-violet-400 font-semibold shrink-0">{r.varName}:</span>
                    <span className="text-slate-400">{r.reason}</span>
                  </div>
                ))}
              </div>
            )}

            {paramRanges.length === 0
              ? <p className="text-slate-600 text-xs text-center py-6">貼上 PineScript 程式碼以自動偵測參數</p>
              : (
                <div className="space-y-3">
                  {paramRanges.map((r, idx) => (
                    <div key={r.varName} className={cn('bg-[#161b1e] p-3 rounded border transition-colors group', r.enabled ? 'border-[#2d3439] hover:border-slate-500' : 'border-[#2d3439] opacity-40')}>
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-sm font-semibold text-slate-200">{r.varName}</span>
                        <input type="checkbox" checked={r.enabled} onChange={e => updateRange(idx,'enabled',e.target.checked)}
                          className="rounded border-slate-600 bg-[#0a0d0f] text-[#3b82f6] focus:ring-[#3b82f6] w-4 h-4" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['min','max','step'] as const).map(field => (
                          <div key={field}>
                            <label className="text-[9px] text-slate-500 uppercase block mb-1">{field==='min'?'最小值':field==='max'?'最大值':'步長'}</label>
                            <input type="number" value={r[field]} step={r.type==='float'?0.1:1}
                              disabled={!r.enabled}
                              onChange={e => updateRange(idx, field, Number(e.target.value))}
                              className="w-full bg-[#0a0d0f] border border-[#2d3439] rounded text-xs text-slate-200 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>

          {/* Max combos + Run button */}
          <div className="mt-auto p-4 bg-[#161b1e] border-t border-[#2d3439]">
            {/* Strategy save section */}
            <div className="mb-3 p-3 bg-[#0a0d0f] border border-[#2d3439] rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">儲存策略</label>
                {saveMsg && (
                  <span className={`text-[10px] font-semibold ${saveMsg.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="專案名稱"
                  className="bg-[#161b1e] border border-[#2d3439] rounded text-xs text-slate-200 py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-[#3b82f6] placeholder:text-slate-600"
                />
                <input
                  type="text"
                  value={strategyName}
                  onChange={e => setStrategyName(e.target.value)}
                  placeholder="策略名稱（必填）"
                  className="bg-[#161b1e] border border-[#2d3439] rounded text-xs text-slate-200 py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-[#3b82f6] placeholder:text-slate-600"
                />
              </div>
              <button
                onClick={saveStrategy}
                disabled={savingStrategy || !strategyName.trim()}
                className="w-full flex items-center justify-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-300 text-xs font-semibold py-1.5 rounded-lg transition-all"
              >
                <span className={`material-symbols-outlined text-[14px] ${savingStrategy ? 'animate-spin' : ''}`}>{savingStrategy ? 'sync' : 'save'}</span>
                {savingStrategy ? '儲存中...' : '儲存此策略'}
              </button>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">最大組合數</label>
              <select value={maxCombos} onChange={e => setMaxCombos(Number(e.target.value))}
                className="ml-auto bg-[#0a0d0f] border border-[#2d3439] rounded text-xs text-slate-200 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]">
                {[1000,2000,5000,10000].map(v => <option key={v} value={v}>{v.toLocaleString()}</option>)}
              </select>
            </div>
            {running && (
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">優化進度</span>
                  <span className="text-[#3b82f6] font-bold">{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-[#0a0d0f] rounded-full h-2 overflow-hidden border border-[#2d3439]">
                  <div className="bg-[#3b82f6] h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(59,130,246,0.5)]" style={{ width:`${progress}%` }} />
                </div>
              </div>
            )}
            <button onClick={runOptimization} disabled={running || !code.trim()}
              className="w-full bg-[#3b82f6] hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30 transition-all">
              <span className={cn('material-symbols-outlined text-[18px]', running && 'animate-spin')}>{running ? 'sync' : 'bolt'}</span>
              {running ? '優化中...' : '執行優化'}
            </button>
            {!running && (
              <p className="text-[10px] text-slate-500 text-center mt-2">
                預估時間：{Math.ceil(Math.min(estimatedCombos,maxCombos) / 800)}–{Math.ceil(Math.min(estimatedCombos,maxCombos) / 400)} 秒
              </p>
            )}
          </div>
        </section>
      </main>

      {/* ── Bottom panel ──────────────────────────────────────── */}
      <footer className="h-56 border-t border-[#2d3439] flex overflow-hidden shrink-0 bg-[#0a0d0f]">

        {/* Quick Stats */}
        <div className="w-72 border-r border-[#2d3439] p-4 flex flex-col shrink-0">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3">
            快速統計 {best ? `(#${selectedResult!.rank})` : '(最佳結果)'}
          </h3>
          <div className="grid grid-cols-2 gap-2 flex-1">
            {[
              { label:'獲利因子', value: best ? String(best.profitFactor)              : '—', color:'text-emerald-400' },
              { label:'勝率',    value: best ? `${best.winRate.toFixed(1)}%`           : '—', color:'text-white'       },
              { label:'最大回撤', value: best ? `${best.maxDrawdownPct.toFixed(1)}%`   : '—', color:'text-red-400'     },
              { label:'夏普比率', value: best ? String(best.sharpeRatio)               : '—', color:'text-[#3b82f6]'   },
            ].map(m => (
              <div key={m.label} className="bg-[#161b1e] p-2.5 rounded border border-[#2d3439] flex flex-col justify-center">
                <span className="text-[9px] text-slate-500 uppercase tracking-wide">{m.label}</span>
                <span className={`text-xl font-bold ${m.color} mt-0.5`}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Performance History */}
        <div className="flex-1 p-4 flex flex-col overflow-hidden">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3">最佳績效歷史</h3>
          <div className="flex-1 overflow-auto rounded border border-[#2d3439] bg-[#161b1e]">
            {results.length === 0
              ? <div className="h-full flex items-center justify-center text-slate-600 text-xs">執行優化後顯示結果</div>
              : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0a0d0f] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-medium text-slate-500 border-b border-[#2d3439]">編號</th>
                      {Object.keys(results[0].result.params).map(k => (
                        <th key={k} className="px-3 py-2 font-medium text-slate-500 border-b border-[#2d3439] capitalize">{k}</th>
                      ))}
                      <th className="px-3 py-2 font-medium text-slate-500 border-b border-[#2d3439]">淨利潤</th>
                      <th className="px-3 py-2 font-medium text-slate-500 border-b border-[#2d3439]">最大回撤</th>
                      <th className="px-3 py-2 font-medium text-slate-500 border-b border-[#2d3439] text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2d3439]">
                    {results.slice(0,8).map(r => (
                      <tr key={r.rank} className="hover:bg-[#1e2227] transition-colors group">
                        <td className="px-3 py-2 text-slate-500">#{r.rank}</td>
                        {Object.values(r.result.params).map((v,i) => (
                          <td key={i} className="px-3 py-2 text-white font-medium">{String(v)}</td>
                        ))}
                        <td className={cn('px-3 py-2 font-bold', r.result.totalReturnPct>=0 ? 'text-emerald-400' : 'text-red-400')}>
                          {formatPercent(r.result.totalReturnPct)}
                        </td>
                        <td className="px-3 py-2 text-red-400">{r.result.maxDrawdownPct.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => applyResult(r)}
                            className="text-[#3b82f6] opacity-0 group-hover:opacity-100 font-semibold transition-opacity hover:underline">
                            套用
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>

        {/* Live Logs */}
        <div className="w-64 border-l border-[#2d3439] p-4 flex flex-col shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500">即時日誌</h3>
            {running && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          <div ref={logsRef} className="flex-1 font-mono text-[10px] text-slate-500 overflow-auto space-y-0.5">
            {logs.length === 0
              ? <p className="text-slate-700">等待優化中...</p>
              : logs.map((l, i) => (
                  <p key={i} className={l.includes('✅')||l.includes('💾') ? 'text-emerald-400' : l.includes('❌') ? 'text-red-400' : l.includes('⚠️') ? 'text-yellow-400' : l.includes('🏆') ? 'text-amber-400' : ''}>
                    {l}
                  </p>
                ))
            }
          </div>
        </div>
      </footer>

      {/* ── KPI Detail Modal ──────────────────────────────────── */}
      {detailResult && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4" onClick={() => setDetailResult(null)}>
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-lg flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[#2d3439]">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#3b82f6] text-[18px]">analytics</span>
                  #{detailResult.rank} 詳細 KPI
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {Object.entries(detailResult.result.params).map(([k,v]) => `${k}: ${v}`).join('  |  ')}
                </p>
              </div>
              <button onClick={() => setDetailResult(null)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* KPI Grid */}
            <div className="p-5 grid grid-cols-2 gap-3">
              {[
                { label: '淨利潤',   value: `${detailResult.result.totalReturnPct >= 0 ? '+' : ''}${detailResult.result.totalReturnPct.toFixed(2)}%`, color: detailResult.result.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: '年化報酬', value: `${detailResult.result.annualizedReturnPct >= 0 ? '+' : ''}${detailResult.result.annualizedReturnPct.toFixed(2)}%`, color: detailResult.result.annualizedReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: '最大回撤', value: `${detailResult.result.maxDrawdownPct.toFixed(2)}%`, color: 'text-red-400' },
                { label: '夏普比率', value: String(detailResult.result.sharpeRatio), color: 'text-[#3b82f6]' },
                { label: '勝率',     value: `${detailResult.result.winRate.toFixed(2)}%`, color: 'text-white' },
                { label: '總交易數', value: String(detailResult.result.totalTrades), color: 'text-white' },
                { label: '獲利因子', value: String(detailResult.result.profitFactor), color: 'text-emerald-400' },
                { label: '平均每筆', value: `${detailResult.result.avgTradePct >= 0 ? '+' : ''}${detailResult.result.avgTradePct.toFixed(3)}%`, color: detailResult.result.avgTradePct >= 0 ? 'text-emerald-400' : 'text-red-400' },
              ].map(m => (
                <div key={m.label} className="bg-[#0a0d0f] rounded-xl p-4 border border-[#2d3439]">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{m.label}</span>
                  <div className={`text-2xl font-bold mt-1 ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Footer buttons */}
            <div className="p-5 border-t border-[#2d3439] flex gap-3">
              <button
                onClick={() => { setDetailResult(null); applyResult(detailResult) }}
                className="flex-1 bg-[#3b82f6] hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/30">
                <span className="material-symbols-outlined text-[16px]">code</span>
                套用並匯出腳本
              </button>
              <button onClick={() => setDetailResult(null)}
                className="px-5 bg-[#0a0d0f] border border-[#2d3439] text-slate-300 rounded-xl text-sm hover:bg-[#1e2227] transition-colors">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export Modal ──────────────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#2d3439]">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#3b82f6] text-[18px]">terminal</span>
                  匯出優化腳本
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">複製並貼上至 TradingView Pine Script 編輯器</p>
              </div>
              <button onClick={() => setShowExport(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="bg-[#0d1117] rounded-xl p-4 text-[12px] font-mono text-slate-300 whitespace-pre-wrap leading-6">{exportedCode}</pre>
            </div>
            <div className="p-4 border-t border-[#2d3439] flex gap-3">
              <button onClick={() => navigator.clipboard.writeText(exportedCode)}
                className="flex-1 bg-[#3b82f6] hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/30">
                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                複製程式碼
              </button>
              <button onClick={() => setShowExport(false)}
                className="px-5 bg-[#0a0d0f] border border-[#2d3439] text-slate-300 rounded-xl text-sm hover:bg-[#1e2227] transition-colors">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Strategy Browser Modal ────────────────────────────── */}
      {showStrategies && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#2d3439]">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#3b82f6] text-[18px]">folder_open</span>
                  我的策略
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">選擇一個策略載入到編輯器</p>
              </div>
              <button onClick={() => setShowStrategies(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loadingStrategies ? (
                <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
                  <span className="material-symbols-outlined animate-spin mr-2 text-[18px]">sync</span>
                  載入中...
                </div>
              ) : savedStrategies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-600 text-sm gap-2">
                  <span className="material-symbols-outlined text-4xl">folder_open</span>
                  <p>尚無已儲存的策略</p>
                  <p className="text-xs">在優化器右下角填寫策略名稱後點擊「儲存此策略」</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(
                    savedStrategies.reduce((acc, s) => {
                      const p = s.project_name || '未命名專案'
                      if (!acc[p]) acc[p] = []
                      acc[p].push(s)
                      return acc
                    }, {} as Record<string, typeof savedStrategies>)
                  ).map(([project, strategies]) => (
                    <div key={project}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="material-symbols-outlined text-slate-500 text-[14px]">folder</span>
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{project}</span>
                      </div>
                      <div className="space-y-1 pl-5">
                        {strategies.map(s => (
                          <div key={s.id} className="flex items-center justify-between bg-[#0a0d0f] border border-[#2d3439] hover:border-[#3b82f6]/40 rounded-lg px-3 py-2.5 group transition-colors">
                            <div>
                              <p className="text-sm text-white font-medium">{s.strategy_name}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {new Date(s.updated_at).toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => loadStrategy(s.id)}
                                className="text-xs font-semibold text-[#3b82f6] hover:underline px-2 py-1 rounded hover:bg-blue-600/10 transition-colors"
                              >
                                載入
                              </button>
                              <button
                                onClick={() => deleteStrategy(s.id)}
                                className="text-xs text-red-400 hover:text-red-300 hover:bg-red-600/10 px-2 py-1 rounded transition-colors"
                              >
                                <span className="material-symbols-outlined text-[14px]">delete</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-[#2d3439]">
              <button onClick={() => setShowStrategies(false)}
                className="w-full bg-[#0a0d0f] border border-[#2d3439] text-slate-300 rounded-xl text-sm py-2.5 hover:bg-[#1e2227] transition-colors">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function BacktestPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-500 text-sm">載入優化器...</div>}>
      <BacktestContent />
    </Suspense>
  )
}
