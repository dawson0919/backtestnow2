import { NextRequest, NextResponse } from 'next/server'

// Map TradingView symbols → Yahoo Finance symbols
const SYMBOL_MAP: Record<string, string> = {
  'GC!': 'GC=F', 'GC': 'GC=F',
  'ES!': 'ES=F', 'ES': 'ES=F',
  'NQ!': 'NQ=F', 'NQ': 'NQ=F',
  'SIL!': 'SI=F', 'SIL': 'SI=F',
  'YM!': 'YM=F', 'YM': 'YM=F',
  'CL!': 'CL=F', 'CL': 'CL=F',
}

const INTERVAL_MAP: Record<string, '1d' | '1wk' | '1mo'> = {
  '1D': '1d', '1W': '1wk', '1M': '1mo',
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawSymbol = searchParams.get('symbol') || 'GC!'
  const interval = searchParams.get('interval') || '1D'
  const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 1500)

  const yahooSymbol = SYMBOL_MAP[rawSymbol] || rawSymbol
  const yahooInterval = INTERVAL_MAP[interval] || '1d'

  const now = new Date()
  const daysBack = interval === '1W' ? limit * 7 : interval === '1M' ? limit * 30 : limit
  const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)

  try {
    // Dynamic import to avoid SSR issues
    const yahooFinance = (await import('yahoo-finance2')).default

    type QuoteResult = {
      date: Date
      open?: number | null
      high?: number | null
      low?: number | null
      close?: number | null
      volume?: number | null
    }

    const quotes: QuoteResult[] = await yahooFinance.historical(yahooSymbol, {
      period1: startDate,
      period2: now,
      interval: yahooInterval,
    })

    const ohlcv = quotes
      .filter((q): q is QuoteResult & { open: number; high: number; low: number; close: number } =>
        q.open != null && q.high != null && q.low != null && q.close != null
      )
      .map(q => ({
        timestamp: q.date.getTime(),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume ?? 0,
      }))

    return NextResponse.json({ symbol: rawSymbol, yahooSymbol, interval, data: ohlcv })
  } catch (err) {
    console.error('Yahoo Finance fetch error:', err)
    return NextResponse.json({ error: `Failed to fetch data for ${rawSymbol}` }, { status: 500 })
  }
}
