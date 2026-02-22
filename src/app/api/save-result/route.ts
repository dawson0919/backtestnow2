import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { MonthlyPnL } from '@/lib/backtest-engine'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      asset:           string
      timeframe:       string
      code:            string
      netProfitPct:    string
      topParams:       Record<string, unknown>
      projectName?:    string
      assetType?:      'crypto' | 'futures'
      pointValue?:     number
      totalReturnPct?:  number
      maxDrawdownPct?:  number
      sharpeRatio?:     number
      winRate?:         number
      profitFactor?:    number
      totalTrades?:     number
      totalDollarPnL?:  number
      monthlyPnL?:      MonthlyPnL[]
      tradesSummary?:   unknown[]
    }

    const {
      asset, timeframe, code, netProfitPct, topParams,
      projectName,
      assetType, pointValue,
      totalReturnPct, maxDrawdownPct, sharpeRatio, winRate, profitFactor, totalTrades, totalDollarPnL,
      monthlyPnL, tradesSummary,
    } = body

    const { data, error } = await supabase
      .from('optimization_history')
      .insert({
        user_id:          userId,
        asset,
        timeframe,
        code,
        net_profit_pct:   netProfitPct,
        top_params:       topParams,
        project_name:     projectName || '未命名專案',
        asset_type:       assetType ?? 'crypto',
        point_value:      pointValue ?? 1,
        total_return_pct: totalReturnPct,
        max_drawdown_pct: maxDrawdownPct,
        sharpe_ratio:     sharpeRatio,
        win_rate:         winRate,
        profit_factor:    profitFactor,
        total_trades:     totalTrades,
        total_dollar_pnl: totalDollarPnL,
        monthly_pnl:      monthlyPnL,
        trades_summary:   tradesSummary,
      })
      .select()
      .single()

    if (error) throw error

    // Track usage (best-effort)
    try {
      const month = new Date().toISOString().substring(0, 7)
      await supabase.rpc('increment_usage', { p_user_id: userId, p_month: month })
    } catch { /* ignore if RPC doesn't exist */ }

    return NextResponse.json({ success: true, id: data?.id })
  } catch (err) {
    console.error('Save result error:', err)
    return NextResponse.json({ error: 'Failed to save result' }, { status: 500 })
  }
}

// GET: single record by ?id=, or list for current user
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id) {
    const { data, error } = await supabase
      .from('optimization_history')
      .select(`
        id, asset, timeframe, code, net_profit_pct, asset_type, point_value,
        total_return_pct, max_drawdown_pct, sharpe_ratio, win_rate,
        profit_factor, total_trades, total_dollar_pnl, monthly_pnl,
        trades_summary, top_params, project_name, created_at
      `)
      .eq('id', id)
      .eq('user_id', userId)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json({ record: data })
  }

  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
  const { data, error } = await supabase
    .from('optimization_history')
    .select(`
      id, asset, timeframe, code, net_profit_pct, asset_type, point_value,
      total_return_pct, max_drawdown_pct, sharpe_ratio, win_rate,
      profit_factor, total_trades, total_dollar_pnl, monthly_pnl,
      trades_summary, top_params, project_name, created_at
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ records: data })
}

// DELETE /api/save-result?id=... ??delete one optimization record
export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase
    .from('optimization_history')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
