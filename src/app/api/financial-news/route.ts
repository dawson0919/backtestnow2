/**
 * GET /api/financial-news
 *
 * Returns aggregated daily financial news for major futures instruments.
 * Uses yahoo-finance2 search to pull news for GC=F, CL=F, NQ=F, ES=F.
 * Results are cached in memory for 30 minutes to reduce API calls.
 */
import { NextResponse } from 'next/server'
import yahooFinance from 'yahoo-finance2'

export const dynamic = 'force-dynamic'

export interface NewsItem {
  uuid: string
  title: string
  publisher: string
  link: string
  providerPublishTime: number
  type: string
  relatedSymbols: string[]
}

// ── In-memory cache ───────────────────────────────────────────────────────────
let cache: { items: NewsItem[]; fetchedAt: number } | null = null
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

const SYMBOLS = [
  { symbol: 'GC=F',  label: 'Gold' },
  { symbol: 'CL=F',  label: 'Crude Oil' },
  { symbol: 'NQ=F',  label: 'Nasdaq 100' },
  { symbol: 'ES=F',  label: 'S&P 500' },
  { symbol: '^GSPC', label: 'Market' },
  { symbol: 'SPY',   label: 'Market' },
]

async function fetchNews(): Promise<NewsItem[]> {
  const seen = new Map<string, NewsItem>()

  await Promise.allSettled(
    SYMBOLS.map(async ({ symbol, label }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (yahooFinance as any).search(symbol, {
          newsCount: 8,
          quotesCount: 0,
          enableFuzzyQuery: false,
        })
        const newsArr: {
          uuid?: string
          title?: string
          publisher?: string
          link?: string
          providerPublishTime?: number
          type?: string
        }[] = result?.news ?? []

        for (const item of newsArr) {
          if (!item.uuid || !item.title) continue
          if (seen.has(item.uuid)) {
            seen.get(item.uuid)!.relatedSymbols.push(label)
          } else {
            seen.set(item.uuid, {
              uuid: item.uuid,
              title: item.title,
              publisher: item.publisher ?? '',
              link: item.link ?? '#',
              providerPublishTime: item.providerPublishTime ?? Date.now() / 1000,
              type: item.type ?? 'STORY',
              relatedSymbols: [label],
            })
          }
        }
      } catch {
        // silently skip failed symbol lookups
      }
    })
  )

  // Sort newest first
  return Array.from(seen.values()).sort(
    (a, b) => b.providerPublishTime - a.providerPublishTime
  )
}

export async function GET() {
  try {
    const now = Date.now()

    // Return cached data if fresh
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        items: cache.items,
        fetchedAt: cache.fetchedAt,
        cached: true,
      })
    }

    const items = await fetchNews()
    cache = { items, fetchedAt: now }

    return NextResponse.json({ items, fetchedAt: now, cached: false })
  } catch (err) {
    console.error('[financial-news] error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch financial news', items: [] },
      { status: 500 }
    )
  }
}
