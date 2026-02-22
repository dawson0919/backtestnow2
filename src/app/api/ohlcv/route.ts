import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const symbol    = searchParams.get('symbol')
  const timeframe = searchParams.get('timeframe') || '1D'
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  // Look up asset_id
  const { data: asset } = await supabase
    .from('assets')
    .select('id, type, pip_value, contract_size')
    .eq('symbol', symbol)
    .single()

  if (!asset) return NextResponse.json({ error: `Asset ${symbol} not found` }, { status: 404 })

  // Paginate in chunks of 1000 to bypass Supabase default row limit
  const PAGE = 1000
  const allRows: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('historical_data')
      .select('timestamp, open, high, low, close, volume')
      .eq('asset_id', asset.id)
      .eq('timeframe', timeframe)
      .order('timestamp', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  const ohlcv = allRows

  return NextResponse.json({
    symbol,
    timeframe,
    assetType:   asset.type,
    pointValue:  asset.pip_value ?? 1,
    count:       ohlcv.length,
    ohlcv,
  })
}
