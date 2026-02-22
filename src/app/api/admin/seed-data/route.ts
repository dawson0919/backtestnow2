/**
 * /api/admin/seed-data
 * Fetch and upsert historical OHLCV data into Supabase.
 * Requires auth (no admin-role table needed).
 * POST { symbols?: string[], timeframes?: string[], limit?: number }
 * limit can exceed 1000 -- will page through Binance API automatically.
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

const BINANCE_IV: Record<string, string> = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w' }

/** Fetch a single page (max 1000) from Binance, optionally ending before endTime */
async function fetchBinancePage(symbol: string, iv: string, limit: number, endTime?: number): Promise<OHLCV[]> {
  const params = new URLSearchParams({
    symbol, interval: iv, limit: String(Math.min(limit, 1000)),
  })
  if (endTime) params.set('endTime', String(endTime))

  const res = await fetch(
    `https://api.binance.com/api/v3/klines?${params}`,
    { signal: AbortSignal.timeout(15000) }
  )
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

/** Fetch up to `totalLimit` bars from Binance by paginating backwards */
async function fetchBinance(symbol: string, interval: string, totalLimit: number): Promise<OHLCV[]> {
  const iv = BINANCE_IV[interval] || '1d'
  const allBars: OHLCV[] = []
  let endTime: number | undefined = undefined
  const PAGE = 1000

  while (allBars.length < totalLimit) {
    const need = totalLimit - allBars.length
    const page = await fetchBinancePage(symbol, iv, Math.min(need, PAGE), endTime)
    if (page.length === 0) break

    // Prepend older bars (page is in ascending order, oldest first)
    allBars.unshift(...page)

    // If fewer than PAGE bars returned, we've hit the start of history
    if (page.length < PAGE) break

    // Move endTime to just before the oldest bar in this page
    endTime = page[0].timestamp - 1

    // Avoid Binance rate-limit (1200 weight/min)
    await new Promise(r => setTimeout(r, 250))
  }

  // Deduplicate by timestamp and sort ascending
  const map = new Map<number, OHLCV>()
  for (const b of allBars) map.set(b.timestamp, b)
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
}

async function upsertBars(assetId: number, timeframe: string, bars: OHLCV[]) {
  if (!bars.length) return 0
  const rows = bars.map(b => ({
    asset_id: assetId, timeframe,
    timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }))
  // Supabase upsert in chunks of 500
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await getSupabase()
      .from('historical_data')
      .upsert(rows.slice(i, i + 500), { onConflict: 'asset_id,timeframe,timestamp' })
    if (error) throw new Error(`DB upsert error: ${error.message}`)
  }
  return bars.length
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    symbols    = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
    timeframes = ['1D', '4H', '1H'],
    limit      = 3000,
  } = (await req.json().catch(() => ({}))) as {
    symbols?: string[]
    timeframes?: string[]
    limit?: number
  }

  // Cap at 10000 to prevent runaway requests
  const safeLimit = Math.min(Math.max(limit, 1), 10000)

  const log: string[]    = []
  const errors: string[] = []

  for (const symbol of symbols) {
    const { data: asset } = await getSupabase()
      .from('assets').select('id').eq('symbol', symbol).single()
    if (!asset) { errors.push(`Asset not found: ${symbol}`); continue }

    for (const tf of timeframes) {
      try {
        const bars = await fetchBinance(symbol, tf, safeLimit)
        const n    = await upsertBars(asset.id, tf, bars)
        log.push(`[OK] ${symbol} ${tf}: ${n} bars written`)
      } catch (e) {
        errors.push(`[ERR] ${symbol} ${tf}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  return NextResponse.json({ success: true, seeded: new Date().toISOString(), log, errors })
}

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await getSupabase()
    .from('historical_data')
    .select('timeframe, asset_id')

  // Count per asset_id + timeframe
  const counts: Record<string, number> = {}
  for (const row of (data || [])) {
    const key = `${row.asset_id}_${row.timeframe}`
    counts[key] = (counts[key] || 0) + 1
  }
  return NextResponse.json({ summary: counts })
}
