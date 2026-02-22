/**
 * /api/market-data/prices
 * Returns current price + 24h change for all 8 supported assets.
 * Public endpoint — no auth required.
 */
import { NextResponse } from 'next/server'

interface PriceResult {
  symbol: string
  price: number | null
  change: number | null   // 24h % change
  closed?: boolean        // true when market is not in regular session
  error?: string
}

async function fetchBinanceTickers(symbols: string[]): Promise<Map<string, { price: number; change: number }>> {
  const list = JSON.stringify(symbols)
  const url  = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(list)}`
  const res  = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) })
  const map  = new Map<string, { price: number; change: number }>()
  if (!res.ok) return map
  const data = await res.json() as { symbol: string; lastPrice: string; priceChangePercent: string }[]
  for (const d of data) {
    map.set(d.symbol, {
      price:  parseFloat(d.lastPrice),
      change: parseFloat(d.priceChangePercent),
    })
  }
  return map
}

async function fetchYahooQuote(yahooSymbol: string): Promise<{ price: number; change: number; closed: boolean } | null> {
  try {
    // yahoo-finance2 v3 requires instantiation via `new YF()`
    const YF = (await import('yahoo-finance2')).default
    const yf = new (YF as unknown as new (opts?: Record<string, unknown>) => {
      quote: (symbol: string, fields?: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<unknown>
    })({ suppressNotices: ['yahooSurvey'] })

    const q = await yf.quote(yahooSymbol, {}, { validateResult: false }) as {
      regularMarketPrice?: number | null
      regularMarketChangePercent?: number | null
      regularMarketPreviousClose?: number | null
      previousClose?: number | null
      marketState?: string | null
    } | null

    // Use regularMarketPrice first; fall back to previous close when market is shut
    const price = q?.regularMarketPrice
      ?? q?.regularMarketPreviousClose
      ?? q?.previousClose
    if (!q || price == null) return null

    // marketState is 'REGULAR' during open hours; anything else = closed/pre/post
    const closed = !q.marketState || !['REGULAR', 'PRE', 'PREPRE', 'POST', 'POSTPOST'].includes(q.marketState)

    return {
      price,
      change: q.regularMarketChangePercent ?? 0,
      closed,
    }
  } catch {
    return null
  }
}

const YAHOO_MAP: Record<string, string> = {
  'GC!': 'GC=F', 'NQ!': 'NQ=F', 'ES!': 'ES=F', 'SIL!': 'SI=F',
}

export async function GET() {
  const cryptoSymbols  = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
  const futuresSymbols = ['GC!', 'NQ!', 'ES!', 'SIL!']

  // Fetch all in parallel
  const [binanceMap, ...futuresPrices] = await Promise.all([
    fetchBinanceTickers(cryptoSymbols),
    ...futuresSymbols.map(s => fetchYahooQuote(YAHOO_MAP[s])),
  ])

  const results: PriceResult[] = [
    ...cryptoSymbols.map(sym => {
      const d = binanceMap.get(sym)
      return { symbol: sym, price: d?.price ?? null, change: d?.change ?? null }
    }),
    ...futuresSymbols.map((sym, i) => {
      const d = futuresPrices[i] as { price: number; change: number; closed: boolean } | null
      return { symbol: sym, price: d?.price ?? null, change: d?.change ?? null, closed: d?.closed }
    }),
  ]

  return NextResponse.json({ results, updatedAt: Date.now() })
}
