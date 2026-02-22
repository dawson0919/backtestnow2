/**
 * /api/admin/seed-history
 * One-time endpoint to back-fill historical OHLCV data.
 * Fetches up to 1000 candles per asset/timeframe from Binance (crypto)
 * and Yahoo Finance (futures), then upserts into historical_data.
 *
 * Only callable by authenticated admin users.
 * GET = dry-run status, POST = run seeding
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null
// eslint-disable-next-line @typescript-eslint/no-unsafe-return
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  return _supabase
}

interface OHLCV {
  timestamp: number; open: number; high: number; low: number; close: number; volume: number
}

// --- Binance ---
const BINANCE_IV: Record<string, string> = { '1H':'1h', '4H':'4h', '1D':'1d' }

async function fetchBinancePage(symbol: string, iv: string, limit: number, endTime?: number): Promise<OHLCV[]> {
  const params = new URLSearchParams({ symbol, interval: iv, limit: String(Math.min(limit, 1000)) })
  if (endTime) params.set('endTime', String(endTime))
  const res = await fetch(`https://api.binance.com/api/v3/klines?${params}`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Binance ${res.status}: ${symbol} ${iv}`)
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

/** Paginated fetch — supports totalLimit > 1000 by walking backwards through history */
async function fetchBinance(symbol: string, interval: string, totalLimit = 1000): Promise<OHLCV[]> {
  const iv = BINANCE_IV[interval] || '1d'
  const allBars: OHLCV[] = []
  let endTime: number | undefined = undefined
  const PAGE = 1000

  while (allBars.length < totalLimit) {
    const need = totalLimit - allBars.length
    const page = await fetchBinancePage(symbol, iv, Math.min(need, PAGE), endTime)
    if (page.length === 0) break
    allBars.unshift(...page)
    if (page.length < PAGE) break
    endTime = page[0].timestamp - 1
    await new Promise(r => setTimeout(r, 250)) // rate-limit guard
  }

  const map = new Map<number, OHLCV>()
  for (const b of allBars) map.set(b.timestamp, b)
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
}

// --- Yahoo Finance ---
const YAHOO_SYMBOL: Record<string, string> = {
  'GC!':'GC=F', 'ES!':'ES=F', 'NQ!':'NQ=F', 'SIL!':'SI=F', 'YM!':'YM=F',
}

async function fetchYahoo(symbol: string, interval: string, days: number): Promise<OHLCV[]> {
  const ys   = YAHOO_SYMBOL[symbol] || symbol
  const yi   = interval === '1H' ? '60m' : interval === '1D' ? '1d' : '1wk'
  const now  = Math.floor(Date.now() / 1000)
  const from = now - days * 86400
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${ys}?period1=${from}&period2=${now}&interval=${yi}`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Yahoo ${res.status}`)

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
  return Array.from(map.entries())
    .map(([ts, group]) => ({
      timestamp: ts,
      open:      group[0].open,
      high:      Math.max(...group.map(b => b.high)),
      low:       Math.min(...group.map(b => b.low)),
      close:     group[group.length - 1].close,
      volume:    group.reduce((s, b) => s + b.volume, 0),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

async function upsertBatch(assetId: number, timeframe: string, bars: OHLCV[], log: string[], errors: string[]) {
  if (bars.length === 0) return
  // Supabase has a row limit per request; batch in chunks of 500
  const CHUNK = 500
  for (let i = 0; i < bars.length; i += CHUNK) {
    const chunk = bars.slice(i, i + CHUNK).map(b => ({
      asset_id: assetId, timeframe,
      timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }))
    const { error } = await getSupabase()
      .from('historical_data')
      .upsert(chunk, { onConflict: 'asset_id,timeframe,timestamp' })
    if (error) { errors.push(`upsert ${timeframe} chunk ${i}: ${error.message}`); return }
  }
  log.push(`  ${timeframe}: ${bars.length} bars inserted/updated`)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check admin role
  const { data: role } = await getSupabase().from('user_roles').select('role').eq('user_id', userId).single()
  if (!role || role.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const log: string[] = []
  const errors: string[] = []

  // --- Crypto: BTC, ETH, SOL, BNB ---
  const cryptoSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']

  for (const symbol of cryptoSymbols) {
    const { data: asset } = await getSupabase().from('assets').select('id').eq('symbol', symbol).single()
    if (!asset) { errors.push(`Asset not found: ${symbol}`); continue }
    log.push(`=== ${symbol} ===`)

    // 1D: 3650 bars ~10 years (paginated)
    try {
      const bars = await fetchBinance(symbol, '1D', 3650)
      await upsertBatch(asset.id, '1D', bars, log, errors)
    } catch (e) { errors.push(`${symbol} 1D: ${e}`) }

    // 4H: 1000 bars ~167 days
    try {
      const bars = await fetchBinance(symbol, '4H', 1000)
      await upsertBatch(asset.id, '4H', bars, log, errors)
    } catch (e) { errors.push(`${symbol} 4H: ${e}`) }

    // 1H: 1000 bars ~42 days
    try {
      const bars = await fetchBinance(symbol, '1H', 1000)
      await upsertBatch(asset.id, '1H', bars, log, errors)
    } catch (e) { errors.push(`${symbol} 1H: ${e}`) }
  }

  // --- Futures: refresh last 30 days ---
  const futuresSymbols = ['GC!', 'ES!', 'NQ!', 'SIL!', 'YM!']

  for (const symbol of futuresSymbols) {
    const { data: asset } = await getSupabase().from('assets').select('id').eq('symbol', symbol).single()
    if (!asset) { errors.push(`Asset not found: ${symbol}`); continue }
    log.push(`=== ${symbol} ===`)

    // 1H: last 730 days (Yahoo max for 60m)
    try {
      const bars1H = await fetchYahoo(symbol, '1H', 730)
      await upsertBatch(asset.id, '1H', bars1H, log, errors)

      // Re-derive 4H from all 1H bars we just got
      const bars4H = aggregate4H(bars1H)
      await upsertBatch(asset.id, '4H', bars4H, log, errors)
    } catch (e) { errors.push(`${symbol} 1H/4H: ${e}`) }

    // 1D: last 5 years
    try {
      const bars1D = await fetchYahoo(symbol, '1D', 365 * 5)
      await upsertBatch(asset.id, '1D', bars1D, log, errors)
    } catch (e) { errors.push(`${symbol} 1D: ${e}`) }
  }

  return NextResponse.json({
    success: true,
    seeded:  new Date().toISOString(),
    log,
    errors,
  })
}

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await getSupabase()
    .from('historical_data')
    .select('asset_id, timeframe, count:id.count()')

  return NextResponse.json({ status: 'ready', summary: data })
}
