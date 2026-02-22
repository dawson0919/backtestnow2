import { OHLCV, BacktestResult, runBacktest } from './backtest-engine'
import { PineScriptParam } from './pinescript-parser'

export interface ParamRange {
  varName: string
  title: string
  type: 'int' | 'float'
  min: number
  max: number
  step: number
  enabled: boolean
}

export interface OptimizationConfig {
  strategyType: string
  paramRanges: ParamRange[]
  fixedParams: Record<string, number | string | boolean>
  maxCombinations: number
  sortBy: 'totalReturnPct' | 'sharpeRatio' | 'profitFactor' | 'winRate'
  topN: number
}

export interface OptimizationResult {
  rank: number
  result: BacktestResult
  score: number
}

function generateCombinations(ranges: ParamRange[]): Record<string, number>[] {
  const enabled = ranges.filter(r => r.enabled)
  if (enabled.length === 0) return [{}]

  const axes: { name: string; values: number[] }[] = enabled.map(r => {
    const values: number[] = []
    const step = r.step > 0 ? r.step : 1
    for (let v = r.min; v <= r.max + 1e-10; v += step) {
      values.push(parseFloat(v.toFixed(8)))
    }
    return { name: r.varName, values }
  })

  // Calculate total combinations
  const total = axes.reduce((acc, a) => acc * a.values.length, 1)
  return { total, axes } as unknown as Record<string, number>[]
}

function* iterateCombinations(
  axes: { name: string; values: number[] }[],
  maxCombinations: number
): Generator<Record<string, number>> {
  const total = axes.reduce((acc, a) => acc * a.values.length, 1)
  const sampleRate = total > maxCombinations ? maxCombinations / total : 1
  const useSampling = sampleRate < 1

  if (!useSampling) {
    // Full grid search
    function* recurse(idx: number, current: Record<string, number>): Generator<Record<string, number>> {
      if (idx === axes.length) {
        yield { ...current }
        return
      }
      for (const v of axes[idx].values) {
        current[axes[idx].name] = v
        yield* recurse(idx + 1, current)
      }
    }
    yield* recurse(0, {})
  } else {
    // Random sampling
    const seen = new Set<string>()
    let count = 0
    while (count < maxCombinations) {
      const combo: Record<string, number> = {}
      for (const ax of axes) {
        const idx = Math.floor(Math.random() * ax.values.length)
        combo[ax.name] = ax.values[idx]
      }
      const key = JSON.stringify(combo)
      if (!seen.has(key)) {
        seen.add(key)
        yield combo
        count++
      }
    }
  }
}

export function optimize(
  ohlcv: OHLCV[],
  config: OptimizationConfig
): OptimizationResult[] {
  const enabled = config.paramRanges.filter(r => r.enabled)

  if (enabled.length === 0) {
    const result = runBacktest(ohlcv, config.strategyType, config.fixedParams)
    return [{ rank: 1, result, score: result[config.sortBy] }]
  }

  const axes: { name: string; values: number[] }[] = enabled.map(r => {
    const values: number[] = []
    const step = r.step > 0 ? r.step : 1
    for (let v = r.min; v <= r.max + 1e-10; v += step) {
      values.push(parseFloat(v.toFixed(8)))
    }
    return { name: r.varName, values }
  })

  const results: BacktestResult[] = []

  for (const combo of iterateCombinations(axes, config.maxCombinations)) {
    const params: Record<string, number | string | boolean> = {
      ...config.fixedParams,
      ...combo,
    }

    // Skip invalid MA combinations (fast >= slow)
    if (
      config.strategyType === 'dual_ma' &&
      params.fastLength !== undefined &&
      params.slowLength !== undefined &&
      Number(params.fastLength) >= Number(params.slowLength)
    ) {
      continue
    }

    try {
      const result = runBacktest(ohlcv, config.strategyType, params)
      if (result.totalTrades > 0) {
        results.push(result)
      }
    } catch {
      // Skip failed backtests
    }
  }

  // Sort results
  results.sort((a, b) => b[config.sortBy] - a[config.sortBy])

  return results.slice(0, config.topN).map((result, i) => ({
    rank: i + 1,
    result,
    score: result[config.sortBy],
  }))
}

export function buildParamRangesFromParsed(params: PineScriptParam[]): ParamRange[] {
  return params
    .filter(p => p.type === 'int' || p.type === 'float')
    .map(p => {
      const defVal = Number(p.defaultValue)
      const isFloat = p.type === 'float'
      const step = p.step ?? (isFloat ? 0.5 : 1)
      const minVal = p.minVal ?? Math.max(1, Math.round(defVal * 0.3))
      const maxVal = p.maxVal ?? Math.round(defVal * 3)

      return {
        varName: p.varName,
        title: p.title,
        type: p.type as 'int' | 'float',
        min: minVal,
        max: maxVal,
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
