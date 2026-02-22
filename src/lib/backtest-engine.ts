export interface OHLCV {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface AssetConfig {
  type: 'crypto' | 'futures'
  /** USD value of 1 full unit price move per contract.
   *  Crypto: 1 (P&L is % based). Futures: e.g. ES!=50, NQ!=20, GC!=100, SIL!=5000, YM!=5 */
  pointValue: number
}

export interface Trade {
  entryIndex:     number
  exitIndex:      number
  entryTimestamp: number   // ms epoch
  exitTimestamp:  number   // ms epoch
  entryPrice:     number
  exitPrice:      number
  direction:      'long' | 'short'
  /** % price move = (exit-entry)/entry*100 */
  pnlPct:         number
  /** Absolute price move = exitPrice - entryPrice */
  pointsMove:     number
  /** Dollar P&L per contract.
   *  Futures: pointsMove * pointValue. Crypto: 0 (use pnlPct instead). */
  pnlDollars:     number
}

export interface MonthlyPnL {
  year:       number
  month:      number
  key:        string  // 'YYYY-MM'
  trades:     number
  winTrades:  number
  /** % sum of pnlPct for all trades closing in this month */
  pnlPct:     number
  /** Futures: sum of pnlDollars; Crypto: 0 */
  pnlDollars: number
  /** Sum of pointsMove */
  pointsMove: number
}

export interface BacktestMetrics {
  totalReturnPct:      number
  annualizedReturnPct: number
  maxDrawdownPct:      number
  sharpeRatio:         number
  winRate:             number
  totalTrades:         number
  profitFactor:        number
  avgTradePct:         number
  /** Futures: cumulative dollar P&L; Crypto: 0 */
  totalDollarPnL:      number
  /** Futures: cumulative points move */
  totalPointsMove:     number
}

export interface BacktestResult extends BacktestMetrics {
  params:      Record<string, number | string | boolean>
  trades:      Trade[]
  equityCurve: number[]
  monthlyPnL:  MonthlyPnL[]
}

// ─── Indicator calculations ───────────────────────────────────────────────────

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
    for (let j = 0; j < period; j++) sum += prices[i - j] * (period - j)
    result[i] = sum / denom
  }
  return result
}

export function calcRSI(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) avgGain += diff; else avgLoss -= diff
  }
  avgGain /= period; avgLoss /= period
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
    default:    return calcSMA(prices, period)
  }
}

// ─── Position / Trade helpers ─────────────────────────────────────────────────

interface OpenPosition {
  entryIndex: number
  entryPrice: number
  direction:  'long' | 'short'
}

/** Build a closed Trade from an open position and exit info. */
function closeTrade(
  pos:        OpenPosition,
  exitIndex:  number,
  exitPrice:  number,
  ohlcv:      OHLCV[],
  aType:      string,
  pointValue: number
): Trade {
  const pointsMove = exitPrice - pos.entryPrice
  const pnlPct     = pos.direction === 'long'
    ? (exitPrice - pos.entryPrice) / pos.entryPrice * 100
    : (pos.entryPrice - exitPrice) / pos.entryPrice * 100
  const pnlDollars = aType === 'futures'
    ? (pos.direction === 'long' ? pointsMove : -pointsMove) * pointValue
    : 0
  return {
    entryIndex:     pos.entryIndex,
    exitIndex,
    entryTimestamp: ohlcv[pos.entryIndex].timestamp,
    exitTimestamp:  ohlcv[exitIndex].timestamp,
    entryPrice:     pos.entryPrice,
    exitPrice,
    direction:      pos.direction,
    pnlPct,
    pointsMove,
    pnlDollars,
  }
}

// ─── Monthly P&L breakdown ────────────────────────────────────────────────────

export function calcMonthlyPnL(trades: Trade[]): MonthlyPnL[] {
  const map = new Map<string, MonthlyPnL>()
  for (const t of trades) {
    const d   = new Date(t.exitTimestamp)
    const yr  = d.getUTCFullYear()
    const mo  = d.getUTCMonth() + 1
    const key = `${yr}-${String(mo).padStart(2, '0')}`
    if (!map.has(key)) {
      map.set(key, { year: yr, month: mo, key, trades: 0, winTrades: 0, pnlPct: 0, pnlDollars: 0, pointsMove: 0 })
    }
    const m = map.get(key)!
    m.trades++
    if (t.pnlPct > 0) m.winTrades++
    m.pnlPct     += t.pnlPct
    m.pnlDollars += t.pnlDollars
    m.pointsMove += t.pointsMove
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key))
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export function calcMetrics(trades: Trade[], equityCurve: number[], ohlcv: OHLCV[]): BacktestMetrics {
  if (trades.length === 0) {
    return {
      totalReturnPct: 0, annualizedReturnPct: 0, maxDrawdownPct: 0,
      sharpeRatio: 0, winRate: 0, totalTrades: 0, profitFactor: 0,
      avgTradePct: 0, totalDollarPnL: 0, totalPointsMove: 0,
    }
  }

  const totalReturnPct = equityCurve[equityCurve.length - 1] - 100

  // Annualized return
  const daysHeld = (ohlcv[ohlcv.length - 1].timestamp - ohlcv[0].timestamp) / 86400000
  const years    = Math.max(daysHeld / 365, 0.01)
  const annualizedReturnPct = (Math.pow(equityCurve[equityCurve.length - 1] / 100, 1 / years) - 1) * 100

  // Max drawdown
  let peak = equityCurve[0], maxDD = 0
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak * 100
    if (dd > maxDD) maxDD = dd
  }

  // Win rate & profit factor
  let wins = 0, grossProfit = 0, grossLoss = 0
  for (const t of trades) {
    if (t.pnlPct > 0) { wins++; grossProfit += t.pnlPct }
    else               { grossLoss += Math.abs(t.pnlPct) }
  }
  const winRate      = (wins / trades.length) * 100
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 999 : 0) : grossProfit / grossLoss

  // Sharpe ratio
  const dailyReturns: number[] = []
  for (let i = 1; i < equityCurve.length; i++) {
    dailyReturns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1])
  }
  const meanR    = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / dailyReturns.length
  const sharpeRatio = Math.sqrt(variance) === 0 ? 0 : (meanR / Math.sqrt(variance)) * Math.sqrt(252)

  const totalDollarPnL  = trades.reduce((s, t) => s + t.pnlDollars, 0)
  const totalPointsMove = trades.reduce((s, t) => s + t.pointsMove, 0)

  return {
    totalReturnPct:      parseFloat(totalReturnPct.toFixed(2)),
    annualizedReturnPct: parseFloat(annualizedReturnPct.toFixed(2)),
    maxDrawdownPct:      parseFloat(maxDD.toFixed(2)),
    sharpeRatio:         parseFloat(sharpeRatio.toFixed(3)),
    winRate:             parseFloat(winRate.toFixed(2)),
    totalTrades:         trades.length,
    profitFactor:        parseFloat(profitFactor.toFixed(3)),
    avgTradePct:         parseFloat((trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length).toFixed(3)),
    totalDollarPnL:      parseFloat(totalDollarPnL.toFixed(2)),
    totalPointsMove:     parseFloat(totalPointsMove.toFixed(4)),
  }
}

// ─── Dual MA Crossover ────────────────────────────────────────────────────────

export function backtestDualMA(
  ohlcv:       OHLCV[],
  fastPeriod:  number,
  slowPeriod:  number,
  maType:      string     = 'EMA',
  assetConfig: AssetConfig = { type: 'crypto', pointValue: 1 }
): BacktestResult {
  const closes  = ohlcv.map(c => c.close)
  const fastMA  = getMA(closes, Math.round(fastPeriod), maType)
  const slowMA  = getMA(closes, Math.round(slowPeriod), maType)
  const { type: aType, pointValue } = assetConfig

  const trades: Trade[] = []
  let equity = 100
  const equityCurve: number[] = [100]
  let position: OpenPosition | null = null

  const start = Math.max(fastPeriod, slowPeriod)

  for (let i = start; i < ohlcv.length; i++) {
    if (isNaN(fastMA[i]) || isNaN(slowMA[i]) || isNaN(fastMA[i-1]) || isNaN(slowMA[i-1])) {
      equityCurve.push(equity); continue
    }

    const crossOver  = fastMA[i-1] < slowMA[i-1] && fastMA[i] >= slowMA[i]
    const crossUnder = fastMA[i-1] > slowMA[i-1] && fastMA[i] <= slowMA[i]

    // crossOver → close any short, open long
    if (crossOver && position?.direction !== 'long') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'long' }
    }
    // crossUnder → close any long, open short
    else if (crossUnder && position?.direction !== 'short') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'short' }
    }

    equityCurve.push(equity)
  }

  // Close open position at last bar
  if (position) {
    const t = closeTrade(position, ohlcv.length - 1, ohlcv[ohlcv.length - 1].close, ohlcv, aType, pointValue)
    trades.push(t); equity *= (1 + t.pnlPct / 100)
  }

  return {
    ...calcMetrics(trades, equityCurve, ohlcv),
    params:      { fastLength: fastPeriod, slowLength: slowPeriod, maType },
    trades,
    equityCurve,
    monthlyPnL: calcMonthlyPnL(trades),
  }
}

// ─── Triple MA Alignment ──────────────────────────────────────────────────────

export function backtestTripleMA(
  ohlcv:       OHLCV[],
  fastPeriod:  number,
  midPeriod:   number,
  slowPeriod:  number,
  maType:      string      = 'EMA',
  assetConfig: AssetConfig = { type: 'crypto', pointValue: 1 }
): BacktestResult {
  const closes = ohlcv.map(c => c.close)
  const fastMA = getMA(closes, Math.round(fastPeriod), maType)
  const midMA  = getMA(closes, Math.round(midPeriod),  maType)
  const slowMA = getMA(closes, Math.round(slowPeriod), maType)
  const { type: aType, pointValue } = assetConfig

  const trades: Trade[] = []
  let equity = 100
  const equityCurve: number[] = [100]
  let position: OpenPosition | null = null

  const start = Math.max(fastPeriod, midPeriod, slowPeriod)

  for (let i = start; i < ohlcv.length; i++) {
    if (
      isNaN(fastMA[i]) || isNaN(midMA[i]) || isNaN(slowMA[i]) ||
      isNaN(fastMA[i-1]) || isNaN(midMA[i-1]) || isNaN(slowMA[i-1])
    ) {
      equityCurve.push(equity); continue
    }

    const bullishNow  = fastMA[i]   > midMA[i]   && midMA[i]   > slowMA[i]
    const bullishPrev = fastMA[i-1] > midMA[i-1] && midMA[i-1] > slowMA[i-1]
    const bearishNow  = fastMA[i]   < midMA[i]   && midMA[i]   < slowMA[i]
    const bearishPrev = fastMA[i-1] < midMA[i-1] && midMA[i-1] < slowMA[i-1]

    // Bullish alignment starts → close any short, open long
    if (bullishNow && !bullishPrev && position?.direction !== 'long') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'long' }
    }
    // Bearish alignment starts → close any long, open short
    else if (bearishNow && !bearishPrev && position?.direction !== 'short') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'short' }
    }
    // Neutral (neither bullish nor bearish) → close any open position
    else if (!bullishNow && !bearishNow && position) {
      const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
      trades.push(t); equity *= (1 + t.pnlPct / 100)
      position = null
    }

    equityCurve.push(equity)
  }

  // Close open position at last bar
  if (position) {
    const t = closeTrade(position, ohlcv.length - 1, ohlcv[ohlcv.length - 1].close, ohlcv, aType, pointValue)
    trades.push(t); equity *= (1 + t.pnlPct / 100)
  }

  return {
    ...calcMetrics(trades, equityCurve, ohlcv),
    params:      { fastLength: fastPeriod, midLength: midPeriod, slowLength: slowPeriod, maType },
    trades,
    equityCurve,
    monthlyPnL: calcMonthlyPnL(trades),
  }
}

// ─── RSI Strategy ─────────────────────────────────────────────────────────────

export function backtestRSI(
  ohlcv:       OHLCV[],
  period:      number,
  oversold:    number,
  overbought:  number,
  assetConfig: AssetConfig = { type: 'crypto', pointValue: 1 }
): BacktestResult {
  const closes = ohlcv.map(c => c.close)
  const rsi    = calcRSI(closes, period)
  const { type: aType, pointValue } = assetConfig

  const trades: Trade[] = []
  let equity = 100
  const equityCurve: number[] = [100]
  let position: OpenPosition | null = null

  for (let i = period + 1; i < ohlcv.length; i++) {
    if (isNaN(rsi[i]) || isNaN(rsi[i-1])) {
      equityCurve.push(equity); continue
    }

    const crossOversold   = rsi[i-1] < oversold   && rsi[i] >= oversold   // RSI rises above oversold → long
    const crossOverbought = rsi[i-1] > overbought  && rsi[i] <= overbought // RSI falls below overbought → short

    if (crossOversold && position?.direction !== 'long') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'long' }
    } else if (crossOverbought && position?.direction !== 'short') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'short' }
    }

    equityCurve.push(equity)
  }

  // Close open position at last bar
  if (position) {
    const t = closeTrade(position, ohlcv.length - 1, ohlcv[ohlcv.length - 1].close, ohlcv, aType, pointValue)
    trades.push(t); equity *= (1 + t.pnlPct / 100)
  }

  const metrics    = calcMetrics(trades, equityCurve, ohlcv)
  const monthlyPnL = calcMonthlyPnL(trades)

  return {
    ...metrics,
    params:      { rsiPeriod: period, oversold, overbought },
    trades,
    equityCurve,
    monthlyPnL,
  }
}

// ─── MACD Strategy ────────────────────────────────────────────────────────────

export function backtestMACD(
  ohlcv:        OHLCV[],
  fastLength:   number      = 12,
  slowLength:   number      = 26,
  signalLength: number      = 9,
  assetConfig:  AssetConfig = { type: 'crypto', pointValue: 1 }
): BacktestResult {
  const closes = ohlcv.map(c => c.close)
  const fastEMA  = calcEMA(closes, Math.round(fastLength))
  const slowEMA  = calcEMA(closes, Math.round(slowLength))
  const { type: aType, pointValue } = assetConfig

  // MACD line
  const macdLine = fastEMA.map((f, i) => isNaN(f) || isNaN(slowEMA[i]) ? NaN : f - slowEMA[i])

  // Signal = EMA of MACD line (skip leading NaNs)
  const firstValid = macdLine.findIndex(v => !isNaN(v))
  const signalLine = new Array(macdLine.length).fill(NaN)
  if (firstValid >= 0) {
    const validMacd = macdLine.slice(firstValid)
    const sigEMA    = calcEMA(validMacd, Math.round(signalLength))
    for (let i = 0; i < sigEMA.length; i++) signalLine[firstValid + i] = sigEMA[i]
  }

  const trades: Trade[] = []
  let equity = 100
  const equityCurve: number[] = [100]
  let position: OpenPosition | null = null

  const start = Math.max(slowLength + signalLength, 2)
  for (let i = start; i < ohlcv.length; i++) {
    if (isNaN(macdLine[i]) || isNaN(macdLine[i-1]) || isNaN(signalLine[i]) || isNaN(signalLine[i-1])) {
      equityCurve.push(equity); continue
    }

    const crossOver  = macdLine[i-1] < signalLine[i-1] && macdLine[i] >= signalLine[i]
    const crossUnder = macdLine[i-1] > signalLine[i-1] && macdLine[i] <= signalLine[i]

    if (crossOver && position?.direction !== 'long') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'long' }
    } else if (crossUnder && position?.direction !== 'short') {
      if (position) {
        const t = closeTrade(position, i, ohlcv[i].close, ohlcv, aType, pointValue)
        trades.push(t); equity *= (1 + t.pnlPct / 100)
      }
      position = { entryIndex: i, entryPrice: ohlcv[i].close, direction: 'short' }
    }

    equityCurve.push(equity)
  }

  // Close open position at last bar
  if (position) {
    const t = closeTrade(position, ohlcv.length - 1, ohlcv[ohlcv.length - 1].close, ohlcv, aType, pointValue)
    trades.push(t); equity *= (1 + t.pnlPct / 100)
  }

  return {
    ...calcMetrics(trades, equityCurve, ohlcv),
    params: { fastLength, slowLength, signalLength },
    trades,
    equityCurve,
    monthlyPnL: calcMonthlyPnL(trades),
  }
}

// ─── Bollinger Bands Strategy (Mean Reversion) ────────────────────────────────

function calcStdDev(prices: number[], period: number, sma: number[]): number[] {
  const result = new Array(prices.length).fill(NaN)
  for (let i = period - 1; i < prices.length; i++) {
    let sumSq = 0
    for (let j = 0; j < period; j++) sumSq += (prices[i - j] - sma[i]) ** 2
    result[i] = Math.sqrt(sumSq / period)
  }
  return result
}

export function backtestBollingerBands(
  ohlcv:       OHLCV[],
  period:      number      = 20,
  multiplier:  number      = 2.0,
  assetConfig: AssetConfig = { type: 'crypto', pointValue: 1 }
): BacktestResult {
  const closes = ohlcv.map(c => c.close)
  const mid    = calcSMA(closes, Math.round(period))
  const std    = calcStdDev(closes, Math.round(period), mid)
  const { type: aType, pointValue } = assetConfig

  const upper = mid.map((m, i) => isNaN(m) ? NaN : m + multiplier * std[i])
  const lower = mid.map((m, i) => isNaN(m) ? NaN : m - multiplier * std[i])

  const trades: Trade[] = []
  let equity = 100
  const equityCurve: number[] = [100]
  let position: OpenPosition | null = null

  for (let i = period; i < ohlcv.length; i++) {
    if (isNaN(mid[i]) || isNaN(lower[i]) || isNaN(upper[i])) {
      equityCurve.push(equity); continue
    }

    const close = ohlcv[i].close

    if (!position) {
      // Touch lower band → enter long (mean reversion from oversold)
      if (close <= lower[i]) {
        position = { entryIndex: i, entryPrice: close, direction: 'long' }
      }
      // Touch upper band → enter short (mean reversion from overbought)
      else if (close >= upper[i]) {
        position = { entryIndex: i, entryPrice: close, direction: 'short' }
      }
    } else if (position.direction === 'long' && close >= mid[i]) {
      // Long: exit when price returns to middle band
      const t = closeTrade(position, i, close, ohlcv, aType, pointValue)
      trades.push(t); equity *= (1 + t.pnlPct / 100); position = null
    } else if (position.direction === 'short' && close <= mid[i]) {
      // Short: exit when price returns to middle band
      const t = closeTrade(position, i, close, ohlcv, aType, pointValue)
      trades.push(t); equity *= (1 + t.pnlPct / 100); position = null
    }

    equityCurve.push(equity)
  }

  // Close open position at last bar
  if (position) {
    const t = closeTrade(position, ohlcv.length - 1, ohlcv[ohlcv.length - 1].close, ohlcv, aType, pointValue)
    trades.push(t); equity *= (1 + t.pnlPct / 100)
  }

  return {
    ...calcMetrics(trades, equityCurve, ohlcv),
    params: { bbPeriod: period, bbMult: multiplier },
    trades,
    equityCurve,
    monthlyPnL: calcMonthlyPnL(trades),
  }
}

// ─── Parameter name resolver (handles snake_case & camelCase aliases) ─────────

function resolveParam(
  params: Record<string, number | string | boolean>,
  ...aliases: string[]
): number | string | boolean | undefined {
  for (const alias of aliases) {
    if (params[alias] !== undefined) return params[alias]
  }
  return undefined
}

// ─── Generic dispatcher ───────────────────────────────────────────────────────

export function runBacktest(
  ohlcv:       OHLCV[],
  strategyType: string,
  params:       Record<string, number | string | boolean>,
  assetConfig:  AssetConfig = { type: 'crypto', pointValue: 1 }
): BacktestResult {
  switch (strategyType) {
    case 'dual_ma': {
      const fast = Number(resolveParam(params, 'fastLength', 'fast_len', 'fast', 'fastPeriod', 'fast_period') ?? 9)
      const slow = Number(resolveParam(params, 'slowLength', 'slow_len', 'slow', 'slowPeriod', 'slow_period') ?? 21)
      const maT  = String(resolveParam(params, 'maType', 'ma_type', 'type') ?? 'EMA')
      return backtestDualMA(ohlcv, fast, slow, maT, assetConfig)
    }
    case 'triple_ma': {
      const fast = Number(resolveParam(params, 'fast_len', 'fastLength', 'fast', 'fastPeriod', 'fast_period') ?? 9)
      const mid  = Number(resolveParam(params, 'mid_len',  'midLength',  'mid',  'midPeriod',  'mid_period')  ?? 21)
      const slow = Number(resolveParam(params, 'slow_len', 'slowLength', 'slow', 'slowPeriod', 'slow_period') ?? 55)
      const maT  = String(resolveParam(params, 'maType', 'ma_type', 'type') ?? 'EMA')
      return backtestTripleMA(ohlcv, fast, mid, slow, maT, assetConfig)
    }
    case 'rsi':
      return backtestRSI(
        ohlcv,
        Number(resolveParam(params, 'rsiPeriod', 'rsi_period', 'period', 'rsiLength', 'rsi_length') ?? 14),
        Number(resolveParam(params, 'oversold',  'over_sold',  'ob_low',  'rsi_low')  ?? 30),
        Number(resolveParam(params, 'overbought','over_bought','ob_high', 'rsi_high') ?? 70),
        assetConfig
      )
    case 'macd':
      return backtestMACD(
        ohlcv,
        Number(resolveParam(params, 'fastLength', 'fast_len', 'fast', 'macdFast', 'fast_period') ?? 12),
        Number(resolveParam(params, 'slowLength', 'slow_len', 'slow', 'macdSlow', 'slow_period') ?? 26),
        Number(resolveParam(params, 'signalLength', 'signal_len', 'signal', 'macdSignal', 'signal_period') ?? 9),
        assetConfig
      )
    case 'bollinger': {
      const bbPeriod = Number(resolveParam(params, 'bbPeriod', 'bb_period', 'period', 'length', 'bbLength') ?? 20)
      const bbMult   = Number(resolveParam(params, 'bbMult', 'bb_mult', 'mult', 'multiplier', 'stdDev') ?? 2.0)
      return backtestBollingerBands(ohlcv, bbPeriod, bbMult, assetConfig)
    }
    default: {
      const fast = Number(resolveParam(params, 'fastLength', 'fast_len', 'fast', 'fastPeriod', 'fast_period') ?? 9)
      const slow = Number(resolveParam(params, 'slowLength', 'slow_len', 'slow', 'slowPeriod', 'slow_period') ?? 21)
      const maT  = String(resolveParam(params, 'maType', 'ma_type', 'type') ?? 'EMA')
      return backtestDualMA(ohlcv, fast, slow, maT, assetConfig)
    }
  }
}
