import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { optimize, OptimizationConfig } from '@/lib/optimization'
import { OHLCV } from '@/lib/backtest-engine'

export const dynamic = 'force-dynamic'

const ADMIN_EMAIL = 'nbamoment@gmail.com'
const FREE_LIMIT  = 30
const ADV_LIMIT   = 100

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function fetchFromDB(
  symbol:    string,
  timeframe: string,
): Promise<{ ohlcv: OHLCV[]; assetType: 'crypto' | 'futures'; pointValue: number }> {
  const { data: asset, error: ae } = await supabase
    .from('assets')
    .select('id, type, pip_value')
    .eq('symbol', symbol)
    .single()

  if (ae || !asset) throw new Error(`Asset not found: ${symbol}`)

  // Paginate in chunks of 1000 to bypass Supabase default row limit
  const PAGE = 1000
  const allRows: OHLCV[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('historical_data')
      .select('timestamp, open, high, low, close, volume')
      .eq('asset_id', asset.id)
      .eq('timeframe', timeframe)
      .order('timestamp', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`DB error: ${error.message}`)
    if (!data || data.length === 0) break

    allRows.push(...(data as OHLCV[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  if (allRows.length < 50)
    throw new Error(`Insufficient data for ${symbol} ${timeframe} (${allRows.length} bars). Run data update first.`)

  return {
    ohlcv:      allRows,
    assetType:  asset.type as 'crypto' | 'futures',
    pointValue: asset.pip_value ?? 1,
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Usage limit check ──────────────────────────────────────
  const clerkUser = await currentUser()
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''
  const isAdmin = email === ADMIN_EMAIL

  if (!isAdmin) {
    const month = new Date().toISOString().substring(0, 7)

    const { data: roleRow } = await supabase
      .from('user_roles').select('role, expires_at').eq('user_id', userId).maybeSingle()

    let limit = FREE_LIMIT
    if (roleRow?.role === 'advanced') {
      const expired = roleRow.expires_at && new Date(roleRow.expires_at) <= new Date()
      if (!expired) limit = ADV_LIMIT
    }

    const { data: usage } = await supabase
      .from('usage_tracking').select('count').eq('user_id', userId).eq('month', month).maybeSingle()

    const count = usage?.count ?? 0
    if (count >= limit) {
      return NextResponse.json({
        error:     limit === FREE_LIMIT ? `已達本月免費回測上限（${FREE_LIMIT} 次）。請申請進階會員以獲得更多使用次數。` : `已達本月回測上限（${ADV_LIMIT} 次）。`,
        limitReached: true,
        count, limit,
      }, { status: 429 })
    }
  }
  // ──────────────────────────────────────────────────────────

  try {
    const { symbol, interval, pineCode, config } = await req.json() as {
      symbol:   string
      interval: string
      pineCode?: string
      config:   OptimizationConfig
    }

    if (!symbol || !config) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    // Always fetch all available bars from the database (paginated)
    const { ohlcv, assetType, pointValue } = await fetchFromDB(symbol, interval)

    const fullConfig: OptimizationConfig = {
      ...config,
      pineCode:        pineCode || config.pineCode,
      maxCombinations: Math.min(Math.max(config.maxCombinations, 100), 10000),
      topN:            Math.min(config.topN || 50, 100),
      assetConfig:     { type: assetType, pointValue },
      deadlineMs:      Date.now() + 50_000,   // 50s hard deadline ??return partial results instead of timing out
    }

    const { results, testedCount, timedOut } = optimize(ohlcv, fullConfig)

    return NextResponse.json({
      success:      true,
      symbol,
      interval,
      assetType,
      pointValue,
      barsCount:    ohlcv.length,
      testedCount,
      timedOut,
      totalResults: results.length,
      results,
    })
  } catch (err) {
    console.error('Optimize error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
