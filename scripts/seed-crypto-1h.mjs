/**
 * scripts/seed-crypto-1h.mjs
 * Fetches all available 1H Binance klines for crypto assets and upserts into Supabase.
 * Run: node scripts/seed-crypto-1h.mjs
 */

const SUPABASE_URL = 'https://wzcpqinqnkayqxwidhwj.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6Y3BxaW5xbmtheXF4d2lkaHdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDY4NjIsImV4cCI6MjA4NzI4Mjg2Mn0.ZeZRYGxBe_0_syXQ2jB9uy-f8lzN7JmyFl8fWemAYQw'

const ASSETS = [
  { symbol: 'BTCUSDT', assetId: 1 },
  { symbol: 'ETHUSDT', assetId: 2 },
  { symbol: 'SOLUSDT', assetId: 3 },
  { symbol: 'BNBUSDT', assetId: 4 },
]

const PAGE = 1000
const DELAY_MS = 300  // respect Binance rate limit

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function fetchPage(symbol, endTime) {
  const params = new URLSearchParams({ symbol, interval: '1h', limit: String(PAGE) })
  if (endTime) params.set('endTime', String(endTime))
  const url = `https://api.binance.com/api/v3/klines?${params}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol}`)
  const raw = await res.json()
  return raw.map(k => ({
    timestamp: Number(k[0]),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }))
}

async function fetchAll(symbol) {
  const all = []
  let endTime = undefined
  let page = 0
  process.stdout.write(`  Fetching ${symbol}: `)

  while (true) {
    const bars = await fetchPage(symbol, endTime)
    if (bars.length === 0) break

    all.unshift(...bars)  // prepend older bars
    page++
    process.stdout.write(`${page * PAGE}...`)

    if (bars.length < PAGE) break
    endTime = bars[0].timestamp - 1
    await sleep(DELAY_MS)
  }

  // Deduplicate and sort
  const map = new Map()
  for (const b of all) map.set(b.timestamp, b)
  const sorted = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
  console.log(` → ${sorted.length} 筆`)
  return sorted
}

async function upsert(assetId, bars) {
  const rows = bars.map(b => ({
    asset_id:  assetId,
    timeframe: '1H',
    timestamp: b.timestamp,
    open:      b.open,
    high:      b.high,
    low:       b.low,
    close:     b.close,
    volume:    b.volume,
  }))

  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/historical_data?on_conflict=asset_id%2Ctimeframe%2Ctimestamp`,
      {
        method: 'POST',
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Supabase upsert error: ${err}`)
    }
    inserted += chunk.length
    process.stdout.write(`\r  寫入 ${inserted}/${rows.length} 筆...`)
  }
  console.log(`\r  ✅ 寫入完成：${inserted} 筆                    `)
}

async function main() {
  console.log('=== Crypto 1H 補資料腳本 ===\n')

  for (const { symbol, assetId } of ASSETS) {
    console.log(`\n[${symbol}]`)
    try {
      const bars = await fetchAll(symbol)
      await upsert(assetId, bars)
    } catch (e) {
      console.error(`  ❌ 錯誤: ${e.message}`)
    }
  }

  console.log('\n=== 完成 ===')

  // 顯示最終統計
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/historical_data?select=asset_id,timestamp&timeframe=eq.1H`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  )
  const data = await res.json()
  const counts = {}
  for (const r of data) counts[r.asset_id] = (counts[r.asset_id] || 0) + 1
  const nameMap = { 1: 'BTCUSDT', 2: 'ETHUSDT', 3: 'SOLUSDT', 4: 'BNBUSDT' }
  console.log('\n最終 1H 筆數：')
  for (const [id, cnt] of Object.entries(counts)) {
    if (nameMap[id]) console.log(`  ${nameMap[id]}: ${cnt} 筆`)
  }
}

main().catch(console.error)
