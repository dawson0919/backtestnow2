'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { parsePineScript, generateUpdatedCode, DUAL_MA_EXAMPLE } from '@/lib/pinescript-parser'
import { buildParamRangesFromParsed, estimateCombinations, ParamRange } from '@/lib/optimization'
import { BacktestResult } from '@/lib/backtest-engine'
import { cn, formatPercent } from '@/lib/utils'

const ASSETS = [
  { symbol: 'BTCUSDT', label: 'BTC/USDT', type: 'crypto' },
  { symbol: 'ETHUSDT', label: 'ETH/USDT', type: 'crypto' },
  { symbol: 'SOLUSDT', label: 'SOL/USDT', type: 'crypto' },
  { symbol: 'BNBUSDT', label: 'BNB/USDT', type: 'crypto' },
  { symbol: 'GC!',     label: 'GC (Gold)',   type: 'futures' },
  { symbol: 'NQ!',     label: 'NQ (Nasdaq)', type: 'futures' },
  { symbol: 'ES!',     label: 'ES (S&P 500)', type: 'futures' },
  { symbol: 'SIL!',    label: 'SIL (Silver)', type: 'futures' },
]

const TIMEFRAMES = ['1D', '4H', '1H', '30m', '15m', '1W']

const SORT_OPTIONS = [
  { value: 'totalReturnPct', label: 'Net Return %' },
  { value: 'sharpeRatio',    label: 'Sharpe Ratio' },
  { value: 'profitFactor',   label: 'Profit Factor' },
  { value: 'winRate',        label: 'Win Rate %' },
]

interface OptResult {
  rank: number
  result: BacktestResult
  score: number
}

function BacktestContent() {
  const { user } = useUser()
  const searchParams = useSearchParams()

  const [code, setCode]           = useState(DUAL_MA_EXAMPLE)
  const [asset, setAsset]         = useState(searchParams.get('asset') || 'BTCUSDT')
  const [timeframe, setTimeframe] = useState('1D')
  const [barsBack, setBarsBack]   = useState(500)
  const [maxCombos, setMaxCombos] = useState(1000)
  const [sortBy, setSortBy]       = useState('totalReturnPct')
  const [paramRanges, setParamRanges] = useState<ParamRange[]>([])
  const [results, setResults]     = useState<OptResult[]>([])
  const [running, setRunning]     = useState(false)
  const [progress, setProgress]   = useState(0)
  const [logs, setLogs]           = useState<string[]>([])
  const [selectedResult, setSelectedResult] = useState<OptResult | null>(null)
  const [tab, setTab]             = useState<'editor' | 'results'>('editor')
  const [exportedCode, setExportedCode] = useState('')
  const [showExport, setShowExport] = useState(false)
  const logsRef = useRef<HTMLDivElement>(null)

  const estimatedCombos = estimateCombinations(paramRanges)

  useEffect(() => {
    if (searchParams.get('template') === 'dual_ma') {
      setCode(DUAL_MA_EXAMPLE)
    }
    parseCode(code)
  }, [])

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [logs])

  function parseCode(src: string) {
    const parsed = parsePineScript(src)
    const ranges = buildParamRangesFromParsed(parsed.params)
    setParamRanges(ranges)
  }

  function addLog(msg: string) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs(prev => [...prev, `[${time}] ${msg}`])
  }

  async function runOptimization() {
    if (!code.trim()) return
    setRunning(true)
    setResults([])
    setProgress(0)
    setLogs([])
    setTab('results')

    const parsed = parsePineScript(code)
    addLog(`Parsed strategy: "${parsed.strategyName}"`)
    addLog(`Detected logic: ${parsed.detectedLogic}`)
    addLog(`Found ${parsed.params.length} parameters`)
    addLog(`Fetching ${asset} ${timeframe} data (${barsBack} bars)...`)

    // Fake progress animation
    const progressInterval = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 8, 90))
    }, 400)

    try {
      addLog(`Starting optimization: ${Math.min(estimatedCombos, maxCombos)} combinations...`)

      const fixedParams: Record<string, string | number | boolean> = {}
      parsed.params.forEach(p => {
        if (p.type === 'string' || p.type === 'bool') {
          fixedParams[p.varName] = p.defaultValue
        }
      })

      const enabledRanges = paramRanges.filter(r => r.enabled)
      addLog(`Optimizing ${enabledRanges.length} parameters: ${enabledRanges.map(r => r.varName).join(', ')}`)

      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: asset,
          interval: timeframe,
          barsBack,
          config: {
            strategyType: parsed.detectedLogic,
            paramRanges,
            fixedParams,
            maxCombinations: Math.min(maxCombos, 10000),
            sortBy,
            topN: 50,
          },
        }),
      })

      const data = await res.json()

      clearInterval(progressInterval)
      setProgress(100)

      if (!res.ok) throw new Error(data.error || 'Optimization failed')

      setResults(data.results || [])
      if (data.results?.length > 0) {
        setSelectedResult(data.results[0])
        const best = data.results[0].result
        addLog(`✅ Optimization complete! Tested ${data.totalResults} valid sets.`)
        addLog(`🏆 Best result: Return ${formatPercent(best.totalReturnPct)}, Sharpe ${best.sharpeRatio}`)

        // Auto-save to Supabase
        if (user?.id) {
          await fetch('/api/save-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset,
              timeframe,
              code,
              netProfitPct: best.totalReturnPct.toFixed(2),
              topParams: best.params,
            }),
          })
          addLog('💾 Result saved to history.')
        }
      } else {
        addLog('⚠️  No valid results found. Try widening parameter ranges.')
      }
    } catch (err) {
      clearInterval(progressInterval)
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setProgress(0)
    } finally {
      setRunning(false)
    }
  }

  function applyParams(result: OptResult) {
    const params = result.result.params
    const newCode = generateUpdatedCode(code, parsePineScript(code).params, params as Record<string, number | string | boolean>)
    setExportedCode(newCode)
    setShowExport(true)
  }

  function updateRange(idx: number, field: keyof ParamRange, value: number | boolean) {
    setParamRanges(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-[#2d3439] bg-[#0a0d0f] shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-400 text-[18px]">tune</span>
            Strategy Optimizer
          </h2>
          <div className="flex items-center gap-1 text-slate-500 text-xs">
            <span>PineScript v5</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1.5 bg-[#161b1e] border border-[#2d3439] text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#1e2227] transition-colors"
            onClick={() => { setCode(DUAL_MA_EXAMPLE); parseCode(DUAL_MA_EXAMPLE) }}
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
            範例策略
          </button>
        </div>
      </header>

      {/* Main workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Icon sidebar */}
        <aside className="w-12 border-r border-[#2d3439] bg-[#0a0d0f] flex flex-col items-center py-3 gap-4 shrink-0">
          {[
            { icon: 'code',        tip: 'Editor',     t: 'editor' },
            { icon: 'bar_chart',   tip: 'Results',    t: 'results' },
          ].map(b => (
            <button
              key={b.t}
              title={b.tip}
              onClick={() => setTab(b.t as 'editor' | 'results')}
              className={cn(
                'p-2 rounded-lg transition-colors',
                tab === b.t ? 'text-blue-400 bg-blue-600/10' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              <span className="material-symbols-outlined text-[22px]">{b.icon}</span>
            </button>
          ))}
        </aside>

        {/* Code Editor */}
        <section className={cn('flex-1 flex flex-col min-w-0', tab !== 'editor' && 'hidden md:flex')}>
          <div className="flex items-center bg-[#0d1117] border-b border-[#2d3439] px-4 h-9 gap-2 shrink-0">
            <span className="material-symbols-outlined text-[12px] text-orange-400">javascript</span>
            <span className="text-xs text-slate-300 font-medium">strategy.pine</span>
          </div>
          <div className="flex-1 relative overflow-hidden">
            <textarea
              className="w-full h-full bg-[#0d1117] text-slate-300 font-mono text-[13px] leading-6 p-4 resize-none focus:outline-none border-none"
              value={code}
              onChange={e => { setCode(e.target.value); parseCode(e.target.value) }}
              spellCheck={false}
              placeholder="在此貼上您的 PineScript v5 策略代碼..."
            />
          </div>
        </section>

        {/* Results panel */}
        {tab === 'results' && (
          <section className="flex-1 flex flex-col overflow-hidden bg-[#080a0c]">
            <div className="p-4 border-b border-[#2d3439] shrink-0">
              <h3 className="text-sm font-bold text-white mb-3">優化結果排行</h3>
              {running && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Processing...</span>
                    <span className="text-blue-400 font-bold">{Math.round(progress)}%</span>
                  </div>
                  <div className="h-2 bg-[#161b1e] rounded-full overflow-hidden border border-[#2d3439]">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {results.length > 0 ? (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0a0d0f]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-slate-500 font-medium border-b border-[#2d3439]">Rank</th>
                      {Object.keys(results[0].result.params).map(k => (
                        <th key={k} className="px-3 py-2.5 text-left text-slate-500 font-medium border-b border-[#2d3439]">{k}</th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-slate-500 font-medium border-b border-[#2d3439]">Return</th>
                      <th className="px-3 py-2.5 text-right text-slate-500 font-medium border-b border-[#2d3439]">Sharpe</th>
                      <th className="px-3 py-2.5 text-right text-slate-500 font-medium border-b border-[#2d3439]">Win%</th>
                      <th className="px-3 py-2.5 text-right text-slate-500 font-medium border-b border-[#2d3439]">DD%</th>
                      <th className="px-3 py-2.5 border-b border-[#2d3439]" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2227]">
                    {results.map(r => (
                      <tr
                        key={r.rank}
                        className={cn(
                          'hover:bg-[#1e2227] cursor-pointer transition-colors',
                          selectedResult?.rank === r.rank && 'bg-blue-600/10'
                        )}
                        onClick={() => setSelectedResult(r)}
                      >
                        <td className="px-3 py-2.5 text-slate-500">#{r.rank}</td>
                        {Object.values(r.result.params).map((v, i) => (
                          <td key={i} className="px-3 py-2.5 text-white font-medium">{String(v)}</td>
                        ))}
                        <td className={cn('px-3 py-2.5 text-right font-bold', r.result.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {formatPercent(r.result.totalReturnPct)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-blue-400">{r.result.sharpeRatio}</td>
                        <td className="px-3 py-2.5 text-right text-slate-300">{r.result.winRate.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right text-red-400">{r.result.maxDrawdownPct.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={e => { e.stopPropagation(); applyParams(r) }}
                            className="text-blue-400 hover:underline text-xs font-semibold"
                          >
                            Apply
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm flex-col gap-2">
                <span className="material-symbols-outlined text-4xl">analytics</span>
                <p>執行優化後結果會顯示在這裡</p>
              </div>
            )}
          </section>
        )}

        {/* Right control panel */}
        <section className="w-96 flex flex-col border-l border-[#2d3439] bg-[#0a0d0f] overflow-y-auto shrink-0">
          {/* Asset selection */}
          <div className="p-4 border-b border-[#2d3439]">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3">目標資產</h3>
            <div className="flex flex-wrap gap-2">
              {ASSETS.map(a => (
                <button
                  key={a.symbol}
                  onClick={() => setAsset(a.symbol)}
                  className={cn(
                    'px-2.5 py-1.5 rounded text-xs font-bold transition-colors',
                    asset === a.symbol
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#161b1e] border border-[#2d3439] text-slate-300 hover:border-blue-500/40'
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Timeframe & Settings */}
          <div className="p-4 border-b border-[#2d3439] grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">週期</label>
              <select
                value={timeframe}
                onChange={e => setTimeframe(e.target.value)}
                className="w-full bg-[#161b1e] border border-[#2d3439] rounded text-xs text-slate-200 py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">K棒數量</label>
              <input
                type="number"
                value={barsBack}
                onChange={e => setBarsBack(Number(e.target.value))}
                min={100} max={1500}
                className="w-full bg-[#161b1e] border border-[#2d3439] rounded text-xs text-slate-200 py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">最大組合數</label>
              <select
                value={maxCombos}
                onChange={e => setMaxCombos(Number(e.target.value))}
                className="w-full bg-[#161b1e] border border-[#2d3439] rounded text-xs text-slate-200 py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={1000}>1,000</option>
                <option value={2000}>2,000</option>
                <option value={5000}>5,000</option>
                <option value={10000}>10,000</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">排序依據</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="w-full bg-[#161b1e] border border-[#2d3439] rounded text-xs text-slate-200 py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Parameter Ranges */}
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500">變量範圍</h3>
              <span className="text-[10px] text-blue-400 font-semibold">
                ~{estimatedCombos > 10000 ? '10,000+' : estimatedCombos.toLocaleString()} 組合
              </span>
            </div>

            {paramRanges.length === 0 ? (
              <p className="text-slate-500 text-xs text-center py-8">貼上 PineScript 代碼後自動解析參數</p>
            ) : (
              <div className="space-y-3">
                {paramRanges.map((range, idx) => (
                  <div
                    key={range.varName}
                    className={cn(
                      'bg-[#161b1e] p-3 rounded border transition-colors',
                      range.enabled ? 'border-[#2d3439] hover:border-slate-500' : 'border-[#2d3439] opacity-50'
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-sm font-semibold text-slate-200">{range.varName}</span>
                        <span className="text-[10px] text-slate-500 ml-2">{range.title}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={range.enabled}
                        onChange={e => updateRange(idx, 'enabled', e.target.checked)}
                        className="rounded border-slate-600 text-blue-500 focus:ring-blue-500 bg-[#0a0d0f]"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(['min', 'max', 'step'] as const).map(field => (
                        <div key={field}>
                          <label className="text-[10px] text-slate-500 uppercase block mb-1">
                            {field === 'min' ? 'Start' : field === 'max' ? 'End' : 'Step'}
                          </label>
                          <input
                            type="number"
                            value={range[field]}
                            onChange={e => updateRange(idx, field, Number(e.target.value))}
                            disabled={!range.enabled}
                            step={range.type === 'float' ? 0.1 : 1}
                            className="w-full bg-[#0a0d0f] border border-[#2d3439] rounded text-xs text-slate-200 py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Run button */}
          <div className="p-4 border-t border-[#2d3439] bg-[#161b1e]">
            {running && (
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Optimization Progress</span>
                  <span className="text-blue-400 font-bold">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 bg-[#0a0d0f] rounded-full overflow-hidden border border-[#2d3439]">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
            <button
              onClick={runOptimization}
              disabled={running || !code.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">{running ? 'sync' : 'bolt'}</span>
              {running ? '優化中...' : '執行優化'}
            </button>
            {!running && (
              <p className="text-[10px] text-slate-500 text-center mt-2">
                將測試最多 {Math.min(estimatedCombos, maxCombos).toLocaleString()} 組參數組合
              </p>
            )}
          </div>
        </section>
      </main>

      {/* Bottom: Live Logs + Best stats */}
      <footer className="h-52 border-t border-[#2d3439] bg-[#0a0d0f] flex overflow-hidden shrink-0">
        {/* Quick stats */}
        {selectedResult && (
          <div className="w-80 border-r border-[#2d3439] p-4 flex flex-col shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3">
              Best Result #{selectedResult.rank}
            </h3>
            <div className="grid grid-cols-2 gap-2 flex-1">
              {[
                { label: 'Net Return', value: formatPercent(selectedResult.result.totalReturnPct), color: selectedResult.result.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: 'Win Rate', value: `${selectedResult.result.winRate.toFixed(1)}%`, color: 'text-white' },
                { label: 'Max Drawdown', value: `${selectedResult.result.maxDrawdownPct.toFixed(1)}%`, color: 'text-red-400' },
                { label: 'Sharpe Ratio', value: String(selectedResult.result.sharpeRatio), color: 'text-blue-400' },
                { label: 'Profit Factor', value: String(selectedResult.result.profitFactor), color: 'text-emerald-400' },
                { label: 'Trades', value: String(selectedResult.result.totalTrades), color: 'text-slate-300' },
              ].map(m => (
                <div key={m.label} className="bg-[#161b1e] p-2 rounded border border-[#2d3439] flex flex-col justify-center">
                  <span className="text-[9px] text-slate-500 uppercase">{m.label}</span>
                  <span className={`text-base font-bold ${m.color}`}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Logs */}
        <div className="flex-1 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500">Live Logs</h3>
            {running && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-dot" />}
          </div>
          <div
            ref={logsRef}
            className="flex-1 font-mono text-[11px] text-slate-400 overflow-auto space-y-0.5"
          >
            {logs.length === 0 ? (
              <p className="text-slate-600">執行優化後日誌將顯示在這裡...</p>
            ) : (
              logs.map((log, i) => (
                <p key={i} className={log.includes('✅') ? 'text-emerald-400' : log.includes('❌') ? 'text-red-400' : log.includes('⚠️') ? 'text-yellow-400' : ''}>
                  {log}
                </p>
              ))
            )}
          </div>
        </div>
      </footer>

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b1e] border border-[#2d3439] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#2d3439]">
              <div>
                <h3 className="font-bold text-white">匯出優化後代碼</h3>
                <p className="text-xs text-slate-400 mt-0.5">複製以下代碼並貼入 TradingView Pine Script 編輯器</p>
              </div>
              <button onClick={() => setShowExport(false)} className="text-slate-500 hover:text-slate-300">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="bg-[#0d1117] rounded-lg p-4 text-[12px] font-mono text-slate-300 whitespace-pre-wrap overflow-auto">
                {exportedCode}
              </pre>
            </div>
            <div className="p-4 border-t border-[#2d3439] flex gap-3">
              <button
                onClick={() => { navigator.clipboard.writeText(exportedCode) }}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                複製代碼
              </button>
              <button
                onClick={() => setShowExport(false)}
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

export default function BacktestPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-500">Loading...</div>}>
      <BacktestContent />
    </Suspense>
  )
}
