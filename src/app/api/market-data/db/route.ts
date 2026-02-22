/**
 * GET /api/market-data/db?symbol=BTCUSDT&limit=30
 * Reads the last N 1D candles from Supabase historical_data.
 * No auth required — only public OHLCV data is returned.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol    = searchParams.get('symbol') || 'BTCUSDT'
  const timeframe = searchParams.get('interval') || '1D'
  const limit     = Math.min(parseInt(searchParams.get('limit') || '30'), 200)

  // Look up asset_id
  const { data: asset, error: ae } = await supabase
    .from('assets')
    .select('id')
    .eq('symbol', symbol)
    .single()

  if (ae || !asset) {
    return NextResponse.json({ error: `Asset ${symbol} not found` }, { status: 404 })
  }

  // Fetch last N candles ordered by timestamp DESC then reverse
  const { data, error } = await supabase
    .from('historical_data')
    .select('timestamp, open, high, low, close, volume')
    .eq('asset_id', asset.id)
    .eq('timeframe', timeframe)
    .order('timestamp', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Return in ascending order (oldest first)
  const sorted = (data ?? []).reverse()

  return NextResponse.json({ symbol, interval: timeframe, data: sorted })
}
