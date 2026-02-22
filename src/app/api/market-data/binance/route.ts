import { NextRequest, NextResponse } from 'next/server'

const BINANCE_BASE = 'https://api.binance.com/api/v3'

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w',
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol') || 'BTCUSDT'
  const interval = searchParams.get('interval') || '1D'
  const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 1000)

  const binanceInterval = INTERVAL_MAP[interval] || '1d'

  try {
    const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
    const res = await fetch(url, { next: { revalidate: 300 } })

    if (!res.ok) {
      return NextResponse.json({ error: 'Binance API error', status: res.status }, { status: 502 })
    }

    const raw = await res.json() as unknown[][]

    const ohlcv = raw.map(k => ({
      timestamp: Number(k[0]),
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }))

    return NextResponse.json({ symbol, interval, data: ohlcv })
  } catch (err) {
    console.error('Binance fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch Binance data' }, { status: 500 })
  }
}
