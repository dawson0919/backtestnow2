/**
 * market-updater.ts
 * Shared logic for fetching latest OHLCV candles and upserting into Supabase.
 * Used by both the cron API route (Vercel) and instrumentation.ts (Railway).
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface OHLCV {
  timestamp: number; open: number; high: number; low: number; close: number; volume: number
}

// ─── Binance ──────────────────────────────────────────────────────────────────
const BINANCE_IV: Record<string, string> = { '1H': '1h', '4H': '4h', '1D': '1d' }

async function fetchBinance(symbol: string, interval: string, limit = 6): Promise<OHLCV[]> {
  const iv  = BINANCE_IV[interval] || '1d'
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${iv}&limit=${limit}`)
  if (!res.ok) throw new Error(`Binance ${symbol} ${interval}: ${res.status}`)
  const raw = await res.json() as unknown[][]
  return raw.map(k => ({
    timestamp: Number(k[0]),
    open:   parseFloat(k[1] as string),
    high:   parseFloat(k[2] as string),
    low:    parseFloat(k[3] as string),
    close:  parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }))
}

// ─── Yahoo Finance ────────────────────────────────────────────────────────────
const YAHOO_SYMBOL: Record<string, string> = {
  'GC!': 'GC=F', 'ES!': 'ES=F', 'NQ!': 'NQ=F', 'SIL!': 'SI=F', 'YM!': 'YM=F',
}

async function fetchYahoo(symbol: string, interval: string, days = 5): Promise<OHLCV[]> {
  const ys  = YAHOO_SYMBOL[symbol] || symbol
  const yi  = interval === '1H' ? '60m' : interval === '1D' ? '1d' : '1wk'
  const now  = Math.floor(Date.now() / 1000)
  const from = now - days * 86400
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${ys}?period1=${from}&period2=${now}&interval=${yi}`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${interval}: ${res.status}`)
  interface YC { chart: { result: Array<{ timestamp: number[]; indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> } }> } }
  const json = await res.json() as YC
  const r    = json?.chart?.result?.[0]
  if (!r) return []
  const q    = r.indicators.quote[0]
  return r.timestamp
    .map((ts, i) => ({ timestamp: ts * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 }))
    .filter(d => d.close != null && !isNaN(d.close))
}

function aggregate4H(bars1H: OHLCV[]): OHLCV[] {
  const map = new Map<number, OHLCV[]>()
  for (const b of bars1H) {
    const key = Math.floor(b.timestamp / 14400000) * 14400000
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(b)
  }
  return Array.from(map.entries()).map(([ts, g]) => ({
    timestamp: ts,
    open:   g[0].open,
    high:   Math.max(...g.map(b => b.high)),
    low:    Math.min(...g.map(b => b.low)),
    close:  g[g.length - 1].close,
    volume: g.reduce((s, b) => s + b.volume, 0),
  })).sort((a, b) => a.timestamp - b.timestamp)
}

async function upsert(assetId: number, timeframe: string, bars: OHLCV[]) {
  if (bars.length === 0) return
  const rows = bars.map(b => ({
    asset_id: assetId, timeframe,
    timestamp: b.timestamp,
    open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }))
  const { error } = await supabase
    .from('historical_data')
    .upsert(rows, { onConflict: 'asset_id,timeframe,timestamp' })
  if (error) throw new Error(`Upsert error: ${error.message}`)
}

// ─── Public: update all assets ────────────────────────────────────────────────
export interface UpdateResult {
  updated: string
  log:     string[]
  errors:  string[]
}

export async function updateAllAssets(): Promise<UpdateResult> {
  const log: string[]    = []
  const errors: string[] = []

  // Crypto (Binance)
  for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']) {
    const { data: asset } = await supabase.from('assets').select('id').eq('symbol', symbol).single()
    if (!asset) { errors.push(`Not found: ${symbol}`); continue }

    for (const tf of ['1H', '4H', '1D'] as const) {
      try {
        const bars = await fetchBinance(symbol, tf, 6)
        await upsert(asset.id, tf, bars)
        log.push(`${symbol} ${tf}: +${bars.length}`)
      } catch (e) { errors.push(`${symbol} ${tf}: ${e}`) }
    }
  }

  // Futures (Yahoo Finance)
  for (const symbol of ['GC!', 'ES!', 'NQ!', 'SIL!', 'YM!']) {
    const { data: asset } = await supabase.from('assets').select('id').eq('symbol', symbol).single()
    if (!asset) { errors.push(`Not found: ${symbol}`); continue }

    // 1H + derive 4H
    try {
      const bars1H = await fetchYahoo(symbol, '1H', 5)
      await upsert(asset.id, '1H', bars1H)
      const bars4H = aggregate4H(bars1H)
      await upsert(asset.id, '4H', bars4H)
      log.push(`${symbol} 1H/4H: +${bars1H.length}/${bars4H.length}`)
    } catch (e) { errors.push(`${symbol} 1H/4H: ${e}`) }

    // 1D
    try {
      const bars1D = await fetchYahoo(symbol, '1D', 5)
      await upsert(asset.id, '1D', bars1D)
      log.push(`${symbol} 1D: +${bars1D.length}`)
    } catch (e) { errors.push(`${symbol} 1D: ${e}`) }
  }

  return { updated: new Date().toISOString(), log, errors }
}
