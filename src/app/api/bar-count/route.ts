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
  const timeframe = searchParams.get('timeframe') || '1H'
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  const { data: asset } = await supabase
    .from('assets')
    .select('id')
    .eq('symbol', symbol)
    .single()

  if (!asset) return NextResponse.json({ count: 0 })

  const { count } = await supabase
    .from('historical_data')
    .select('*', { count: 'exact', head: true })
    .eq('asset_id', asset.id)
    .eq('timeframe', timeframe)

  return NextResponse.json({ count: count ?? 0 })
}
