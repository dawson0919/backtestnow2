import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { optimize, OptimizationConfig } from '@/lib/optimization'
import { OHLCV } from '@/lib/backtest-engine'

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
      deadlineMs:      Date.now() + 50_000,   // 50s hard deadline — return partial results instead of timing out
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
