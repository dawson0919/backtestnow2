export interface OHLCV {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Trade {
  entryIndex: number
  exitIndex: number
  entryPrice: number
  exitPrice: number
  direction: 'long' | 'short'
  pnlPct: number
}

export interface BacktestMetrics {
  totalReturnPct: number
  annualizedReturnPct: number
  maxDrawdownPct: number
  sharpeRatio: number
  winRate: number
  totalTrades: number
  profitFactor: number
  avgTradePct: number
}

export interface BacktestResult extends BacktestMetrics {
  params: Record<string, number | string | boolean>
  trades: Trade[]
  equityCurve: number[]
}

// ─── Indicator calculations ──────────────────────────────────────────────────

export function calcSMA(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i]
    if (i >= period) sum -= prices[i - period]
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

export function calcEMA(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN)
  const k = 2 / (period + 1)
  let ema = prices[0]
  result[0] = ema
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k)
    result[i] = ema
  }
  return result
}

export function calcWMA(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN)
  const denom = (period * (period + 1)) / 2
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += prices[i - j] * (period - j)
    }
    result[i] = sum / denom
  }
  return result
}

export function calcRSI(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN)
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) avgGain += diff
    else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

function getMA(prices: number[], period: number, type: string): number[] {
  switch (type) {
    case 'EMA': return calcEMA(prices, period)
    case 'WMA': return calcWMA(prices, period)
    default: return calcSMA(prices, period)
  }
}

// ─── Metrics calculation ──────────────────────────────────────────────────────

export function calcMetrics(trades: Trade[], equityCurve: number[], ohlcv: OHLCV[]): BacktestMetrics {
  if (trades.length === 0) {
    return {
      totalReturnPct: 0,
      annualizedReturnPct: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      winRate: 0,
      totalTrades: 0,
      profitFactor: 0,
      avgTradePct: 0,
    }
  }

  const totalReturnPct = equityCurve[equityCurve.length - 1] - 100

  // Annualized return
  const daysHeld = (ohlcv[ohlcv.length - 1].timestamp - ohlcv[0].timestamp) / (1000 * 60 * 60 * 24)
  const years = Math.max(daysHeld / 365, 0.01)
  const finalEquity = equityCurve[equityCurve.length - 1] / 100
  const annualizedReturnPct = (Math.pow(finalEquity, 1 / years) - 1) * 100

  // Max drawdown
  let peak = equityCurve[0]
  let maxDD = 0
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak * 100
    if (dd > maxDD) maxDD = dd
  }

  // Win rate & profit factor
  let wins = 0, losses = 0, grossProfit = 0, grossLoss = 0
  for (const t of trades) {
    if (t.pnlPct > 0) {
      wins++; grossProfit += t.pnlPct
    } else {
      losses++; grossLoss += Math.abs(t.pnlPct)
    }
  }
  const winRate = (wins / trades.length) * 100
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 999 : 0) : grossProfit / grossLoss

  // Sharpe ratio (daily returns)
  const dailyReturns: number[] = []
  for (let i = 1; i < equityCurve.length; i++) {
    dailyReturns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1])
  }
  const meanReturn = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / dailyReturns.length
  const stdReturn = Math.sqrt(variance)
  const sharpeRatio = stdReturn === 0 ? 0 : (meanReturn / stdReturn) * Math.sqrt(252)

  return {
    totalReturnPct: parseFloat(totalReturnPct.toFixed(2)),
    annualizedReturnPct: parseFloat(annualizedReturnPct.toFixed(2)),
    maxDrawdownPct: parseFloat(maxDD.toFixed(2)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(3)),
    winRate: parseFloat(winRate.toFixed(2)),
    totalTrades: trades.length,
    profitFactor: parseFloat(profitFactor.toFixed(3)),
    avgTradePct: parseFloat((trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length).toFixed(3)),
  }
}

// ─── Dual MA Crossover strategy ───────────────────────────────────────────────

export function backtestDualMA(
  ohlcv: OHLCV[],
  fastPeriod: number,
  slowPeriod: number,
  maType: string = 'EMA'
): BacktestResult {
  const closes = ohlcv.map(c => c.close)
  const fastMA = getMA(closes, Math.round(fastPeriod), maType)
  const slowMA = getMA(closes, Math.round(slowPeriod), maType)

  const trades: Trade[] = []
  let equity = 100
  const equityCurve: number[] = [100]
  let position: { entryIndex: number; entryPrice: number } | null = null

  const start = Math.max(fastPeriod, slowPeriod)

  for (let i = start; i < ohlcv.length; i++) {
    if (isNaN(fastMA[i]) || isNaN(slowMA[i]) || isNaN(fastMA[i - 1]) || isNaN(slowMA[i - 1])) {
      equityCurve.push(equity)
      continue
    }

    const crossOver = fastMA[i - 1] < slowMA[i - 1] && fastMA[i] >= slowMA[i]
    const crossUnder = fastMA[i - 1] > slowMA[i - 1] && fastMA[i] <= slowMA[i]

    if (crossOver && !position) {
      position = { entryIndex: i, entryPrice: ohlcv[i].close }
    } else if (crossUnder && position) {
      const pnlPct = (ohlcv[i].close - position.entryPrice) / position.entryPrice * 100
      trades.push({
        entryIndex: position.entryIndex,
        exitIndex: i,
        entryPrice: position.entryPrice,
        exitPrice: ohlcv[i].close,
        direction: 'long',
        pnlPct,
      })
      equity *= (1 + pnlPct / 100)
      position = null
    }

    equityCurve.push(equity)
  }

  // Close open position at last bar
  if (position) {
    const lastIdx = ohlcv.length - 1
    const pnlPct = (ohlcv[lastIdx].close - position.entryPrice) / position.entryPrice * 100
    trades.push({
      entryIndex: position.entryIndex,
      exitIndex: lastIdx,
      entryPrice: position.entryPrice,
      exitPrice: ohlcv[lastIdx].close,
      direction: 'long',
      pnlPct,
    })
    equity *= (1 + pnlPct / 100)
  }

  const metrics = calcMetrics(trades, equityCurve, ohlcv)

  return {
    ...metrics,
    params: { fastLength: fastPeriod, slowLength: slowPeriod, maType },
    trades,
    equityCurve,
  }
}

// ─── RSI Strategy ─────────────────────────────────────────────────────────────

export function backtestRSI(
  ohlcv: OHLCV[],
  period: number,
  oversold: number,
  overbought: number
): BacktestResult {
  const closes = ohlcv.map(c => c.close)
  const rsi = calcRSI(closes, period)

  const trades: Trade[] = []
  let equity = 100
  const equityCurve: number[] = [100]
  let position: { entryIndex: number; entryPrice: number } | null = null

  for (let i = period + 1; i < ohlcv.length; i++) {
    if (isNaN(rsi[i]) || isNaN(rsi[i - 1])) {
      equityCurve.push(equity)
      continue
    }

    if (rsi[i - 1] < oversold && rsi[i] >= oversold && !position) {
      position = { entryIndex: i, entryPrice: ohlcv[i].close }
    } else if (rsi[i - 1] > overbought && rsi[i] <= overbought && position) {
      const pnlPct = (ohlcv[i].close - position.entryPrice) / position.entryPrice * 100
      trades.push({
        entryIndex: position.entryIndex,
        exitIndex: i,
        entryPrice: position.entryPrice,
        exitPrice: ohlcv[i].close,
        direction: 'long',
        pnlPct,
      })
      equity *= (1 + pnlPct / 100)
      position = null
    }

    equityCurve.push(equity)
  }

  const metrics = calcMetrics(trades, equityCurve, ohlcv)

  return {
    ...metrics,
    params: { rsiPeriod: period, oversold, overbought },
    trades,
    equityCurve,
  }
}

// ─── Generic strategy dispatcher ─────────────────────────────────────────────

export function runBacktest(
  ohlcv: OHLCV[],
  strategyType: string,
  params: Record<string, number | string | boolean>
): BacktestResult {
  switch (strategyType) {
    case 'dual_ma':
      return backtestDualMA(
        ohlcv,
        Number(params.fastLength ?? 9),
        Number(params.slowLength ?? 21),
        String(params.maType ?? 'EMA')
      )
    case 'rsi':
      return backtestRSI(
        ohlcv,
        Number(params.rsiPeriod ?? 14),
        Number(params.oversold ?? 30),
        Number(params.overbought ?? 70)
      )
    default:
      return backtestDualMA(
        ohlcv,
        Number(params.fastLength ?? 9),
        Number(params.slowLength ?? 21),
        String(params.maType ?? 'EMA')
      )
  }
}
