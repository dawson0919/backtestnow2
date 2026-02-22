import { OHLCV, BacktestResult, AssetConfig, runBacktest } from './backtest-engine'
import { runPineScriptBacktest } from './pinescript-runtime'
import { PineScriptParam } from './pinescript-parser'

export interface ParamRange {
  varName:  string
  title:    string
  type:     'int' | 'float'
  min:      number
  max:      number
  step:     number
  enabled:  boolean
}

export interface OptimizationConfig {
  strategyType:    string
  pineCode?:       string   // When present, use PineScript runtime instead of preset strategies
  paramRanges:     ParamRange[]
  fixedParams:     Record<string, number | string | boolean>
  maxCombinations: number
  sortBy:          'totalReturnPct' | 'sharpeRatio' | 'profitFactor' | 'winRate'
  topN:            number
  assetConfig?:    AssetConfig
  deadlineMs?:     number   // Unix ms — stop iterating after this timestamp (returns partial results)
}

export interface OptimizationResult {
  rank:     number
  result:   BacktestResult
  score:    number
}

export interface OptimizationSummary {
  results:      OptimizationResult[]
  testedCount:  number
  timedOut:     boolean
}

function* iterateCombinations(
  axes:            { name: string; values: number[] }[],
  maxCombinations: number
): Generator<Record<string, number>> {
  const total      = axes.reduce((acc, a) => acc * a.values.length, 1)
  const useSampling = total > maxCombinations

  if (!useSampling) {
    function* recurse(idx: number, current: Record<string, number>): Generator<Record<string, number>> {
      if (idx === axes.length) { yield { ...current }; return }
      for (const v of axes[idx].values) {
        current[axes[idx].name] = v
        yield* recurse(idx + 1, current)
      }
    }
    yield* recurse(0, {})
  } else {
    const seen = new Set<string>()
    let count  = 0
    while (count < maxCombinations) {
      const combo: Record<string, number> = {}
      for (const ax of axes) {
        combo[ax.name] = ax.values[Math.floor(Math.random() * ax.values.length)]
      }
      const key = JSON.stringify(combo)
      if (!seen.has(key)) { seen.add(key); yield combo; count++ }
    }
  }
}

export function optimize(
  ohlcv:  OHLCV[],
  config: OptimizationConfig
): OptimizationSummary {
  const assetConfig = config.assetConfig ?? { type: 'crypto' as const, pointValue: 1 }
  const enabled     = config.paramRanges.filter(r => r.enabled)

  // Helper: run one backtest with given params, using PineScript runtime if code is provided
  function runOne(params: Record<string, number | string | boolean>): BacktestResult {
    if (config.pineCode) {
      return runPineScriptBacktest(config.pineCode, params, ohlcv, assetConfig)
    }
    return runBacktest(ohlcv, config.strategyType, params, assetConfig)
  }

  if (enabled.length === 0) {
    const result = runOne(config.fixedParams)
    return { results: [{ rank: 1, result, score: result[config.sortBy] }], testedCount: 1, timedOut: false }
  }

  const axes: { name: string; values: number[] }[] = enabled.map(r => {
    const values: number[] = []
    const step = r.step > 0 ? r.step : 1
    for (let v = r.min; v <= r.max + 1e-10; v += step) {
      values.push(parseFloat(v.toFixed(8)))
    }
    return { name: r.varName, values }
  })

  const backResults: BacktestResult[] = []
  let testedCount = 0
  let timedOut = false
  // Check deadline every N combos to avoid Date.now() overhead in tight loop
  const DEADLINE_CHECK_INTERVAL = 50

  for (const combo of iterateCombinations(axes, config.maxCombinations)) {
    // Deadline guard: stop early and return partial results
    if (config.deadlineMs && testedCount % DEADLINE_CHECK_INTERVAL === 0 && Date.now() > config.deadlineMs) {
      timedOut = true
      break
    }

    const params: Record<string, number | string | boolean> = {
      ...config.fixedParams,
      ...combo,
    }

    // Skip invalid dual-MA / MACD combos where fast >= slow
    if (config.strategyType === 'dual_ma' || config.strategyType === 'macd' || config.strategyType === '') {
      const fast = params.fastLength ?? params.fast_len ?? params.fast ?? params.fastPeriod ?? params.macdFast
      const slow = params.slowLength ?? params.slow_len ?? params.slow ?? params.slowPeriod ?? params.macdSlow
      if (fast !== undefined && slow !== undefined && Number(fast) >= Number(slow)) continue
    }
    // Skip invalid triple-MA combos where fast >= mid or mid >= slow
    if (config.strategyType === 'triple_ma') {
      const fast = params.fast_len ?? params.fastLength ?? params.fast ?? params.fastPeriod
      const mid  = params.mid_len  ?? params.midLength  ?? params.mid  ?? params.midPeriod
      const slow = params.slow_len ?? params.slowLength ?? params.slow ?? params.slowPeriod
      if (fast !== undefined && mid !== undefined && Number(fast) >= Number(mid)) continue
      if (mid  !== undefined && slow !== undefined && Number(mid)  >= Number(slow)) continue
    }

    try {
      const result = runOne(params)
      // Overwrite result.params with the user's actual varNames (from combo + fixedParams)
      // so that generateUpdatedCode can find and replace them in the original PineScript.
      result.params = params
      if (result.totalTrades > 0) backResults.push(result)
    } catch { /* skip failed */ }
    testedCount++
  }

  backResults.sort((a, b) => b[config.sortBy] - a[config.sortBy])

  return {
    results: backResults.slice(0, config.topN).map((result, i) => ({
      rank:  i + 1,
      result,
      score: result[config.sortBy],
    })),
    testedCount,
    timedOut,
  }
}

export function buildParamRangesFromParsed(params: PineScriptParam[]): ParamRange[] {
  return params
    .filter(p => p.type === 'int' || p.type === 'float')
    .map(p => {
      const defVal  = Number(p.defaultValue)
      const isFloat = p.type === 'float'
      const step    = p.step ?? (isFloat ? 0.5 : 1)
      const minVal  = p.minVal ?? Math.max(1, Math.round(defVal * 0.3))
      const maxVal  = p.maxVal ?? Math.round(defVal * 3)
      return {
        varName: p.varName,
        title:   p.title,
        type:    p.type as 'int' | 'float',
        min:     minVal,
        max:     maxVal,
        step,
        enabled: true,
      }
    })
}

export function estimateCombinations(ranges: ParamRange[]): number {
  const enabled = ranges.filter(r => r.enabled)
  if (enabled.length === 0) return 1
  return enabled.reduce((acc, r) => {
    const steps = Math.floor((r.max - r.min) / r.step) + 1
    return acc * steps
  }, 1)
}
