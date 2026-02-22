/**
 * /api/cron/update-data
 * Can be called by Vercel Cron (vercel.json), Railway Cron, or any external cron.
 * Auth: Authorization: Bearer <CRON_SECRET>
 * On Railway, the actual cron is driven by instrumentation.ts (node-cron),
 * so this route is mainly kept as a manual trigger endpoint.
 */
import { NextRequest, NextResponse } from 'next/server'
import { updateAllAssets } from '@/lib/market-updater'

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await updateAllAssets()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET for manual dev trigger (no auth in development)
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Use POST' }, { status: 405 })
  }
  return POST(req)
}
