'use client'

import { useEffect, useState } from 'react'

interface AssetPrice {
  symbol:  string
  label:   string
  sub:     string
  price:   number | null
  change:  number | null
  color:   string
  type:    'crypto' | 'futures'
  closed?: boolean
  failed?: boolean
}

const ASSETS: Omit<AssetPrice, 'price' | 'change' | 'failed'>[] = [
  { symbol: 'BTCUSDT', label: 'BTC/USDT', sub: '比特幣',       color: 'bg-amber-500/10 border-amber-500/30 text-amber-400',    type: 'crypto'  },
  { symbol: 'ETHUSDT', label: 'ETH/USDT', sub: '以太坊',       color: 'bg-blue-500/10 border-blue-500/30 text-blue-400',       type: 'crypto'  },
  { symbol: 'SOLUSDT', label: 'SOL/USDT', sub: 'Solana',       color: 'bg-purple-500/10 border-purple-500/30 text-purple-400', type: 'crypto'  },
  { symbol: 'BNBUSDT', label: 'BNB/USDT', sub: 'Binance Coin', color: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400', type: 'crypto'  },
  { symbol: 'GC!',     label: 'GC',       sub: '黃金期貨',     color: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400', type: 'futures' },
  { symbol: 'NQ!',     label: 'NQ',       sub: '納指期貨',     color: 'bg-blue-500/10 border-blue-500/30 text-blue-400',       type: 'futures' },
  { symbol: 'ES!',     label: 'ES',       sub: '標普期貨',     color: 'bg-green-500/10 border-green-500/30 text-green-400',    type: 'futures' },
  { symbol: 'SIL!',    label: 'SIL',      sub: '白銀期貨',     color: 'bg-slate-400/10 border-slate-400/30 text-slate-300',    type: 'futures' },
]

export default function LiveAssetTicker() {
  const [prices, setPrices] = useState<AssetPrice[]>(
    ASSETS.map(a => ({ ...a, price: null, change: null, failed: false }))
  )
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  async function fetchAll() {
    try {
      const res = await fetch('/api/market-data/prices', {
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) throw new Error('API error')
      const json = await res.json() as {
        results: { symbol: string; price: number | null; change: number | null; closed?: boolean }[]
        updatedAt: number
      }

      const resultMap = new Map(json.results.map(r => [r.symbol, r]))

      setPrices(ASSETS.map(a => {
        const r = resultMap.get(a.symbol)
        return {
          ...a,
          price:  r?.price  ?? null,
          change: r?.change ?? null,
          closed: r?.closed ?? false,
          failed: r ? r.price === null : true,
        }
      }))
      setLastUpdated(json.updatedAt)
    } catch {
      // Mark all as failed if the entire request fails
      setPrices(prev => prev.map(a => ({ ...a, failed: true })))
    }
  }

  useEffect(() => {
    fetchAll()
    const timer = setInterval(fetchAll, 60_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {prices.map(a => (
          <div key={a.symbol} className={`card-hover border rounded-xl p-4 text-center ${a.color}`}>
            <div className="font-bold text-sm">{a.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{a.sub}</div>
            {a.price != null ? (
              <>
                <div className="text-base font-black mt-2 text-white">
                  {a.type === 'crypto'
                    ? `$${a.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                    : `$${a.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  }
                </div>
                {a.closed ? (
                  <div className="flex items-center justify-center gap-1 mt-0.5">
                    <span className="text-[10px] text-slate-500 font-semibold">休市</span>
                    <span className="text-[11px] text-slate-500">
                      {(a.change ?? 0) >= 0 ? '+' : ''}{(a.change ?? 0).toFixed(2)}%
                    </span>
                  </div>
                ) : (
                  <div className={`text-[11px] font-bold mt-0.5 ${(a.change ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(a.change ?? 0) >= 0 ? '+' : ''}{(a.change ?? 0).toFixed(2)}%
                  </div>
                )}
              </>
            ) : a.failed ? (
              <div className="text-slate-600 text-xs mt-2">無法取得</div>
            ) : (
              <div className="text-slate-600 text-xs mt-2 animate-pulse">載入中...</div>
            )}
            <div className="text-[10px] mt-1 opacity-60 uppercase tracking-wide">{a.type}</div>
          </div>
        ))}
      </div>
      {lastUpdated && (
        <p className="text-center text-[11px] text-slate-600 mt-3">
          更新於 {new Date(lastUpdated).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} · 每 60 秒自動刷新
        </p>
      )}
    </div>
  )
}
