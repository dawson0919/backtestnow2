import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as {
      asset: string
      timeframe: string
      code: string
      netProfitPct: string
      topParams: Record<string, unknown>
    }

    const { asset, timeframe, code, netProfitPct, topParams } = body

    const { data, error } = await supabase
      .from('optimization_history')
      .insert({
        user_id: userId,
        asset,
        timeframe,
        code,
        net_profit_pct: netProfitPct,
        top_params: topParams,
      })
      .select()
      .single()

    if (error) throw error

    // Track usage (best-effort)
    try {
      const month = new Date().toISOString().substring(0, 7)
      await supabase.rpc('increment_usage', { p_user_id: userId, p_month: month })
    } catch {
      // Ignore if RPC doesn't exist
    }

    return NextResponse.json({ success: true, id: data?.id })
  } catch (err) {
    console.error('Save result error:', err)
    return NextResponse.json({ error: 'Failed to save result' }, { status: 500 })
  }
}
