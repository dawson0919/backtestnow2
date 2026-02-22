import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { optimize, OptimizationConfig } from '@/lib/optimization'
import { OHLCV } from '@/lib/backtest-engine'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

async function fetchMarketData(symbol: string, interval: string, limit: number): Promise<OHLCV[]> {
  const isCrypto = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].includes(symbol)
  const endpoint = isCrypto
    ? `/api/market-data/binance?symbol=${symbol}&interval=${interval}&limit=${limit}`
    : `/api/market-data/yahoo?symbol=${symbol}&interval=${interval}&limit=${limit}`

  const url = `${BASE_URL}${endpoint}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch data for ${symbol}`)
  const json = await res.json() as { data: OHLCV[] }
  return json.data
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as {
      symbol: string
      interval: string
      barsBack: number
      config: OptimizationConfig
    }

    const { symbol, interval, barsBack = 500, config } = body

    if (!symbol || !config) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Fetch market data
    const ohlcv = await fetchMarketData(symbol, interval, barsBack)

    if (ohlcv.length < 50) {
      return NextResponse.json({ error: 'Insufficient market data' }, { status: 422 })
    }

    // Clamp maxCombinations to allowed range
    const clampedConfig: OptimizationConfig = {
      ...config,
      maxCombinations: Math.min(Math.max(config.maxCombinations, 100), 10000),
      topN: Math.min(config.topN || 20, 100),
    }

    // Run optimization
    const results = optimize(ohlcv, clampedConfig)

    return NextResponse.json({
      success: true,
      symbol,
      interval,
      barsCount: ohlcv.length,
      totalResults: results.length,
      results,
    })
  } catch (err) {
    console.error('Optimization error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Optimization failed' },
      { status: 500 }
    )
  }
}
