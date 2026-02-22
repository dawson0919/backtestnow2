/**
 * Next.js Instrumentation Hook
 * Runs once when the Next.js server starts (Railway / self-hosted).
 * Sets up node-cron to update market data every 4 hours.
 * On Vercel, this file is ignored and vercel.json cron takes over.
 */
export async function register() {
  // Only run in Node.js runtime (not Edge), and only on Railway/self-hosted
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Skip if running on Vercel (use Vercel Cron instead)
  if (process.env.VERCEL) return

  try {
    const cron = (await import('node-cron')).default

    // Every 4 hours: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
    cron.schedule('0 */4 * * *', async () => {
      try {
        const { updateAllAssets } = await import('./lib/market-updater')
        const result = await updateAllAssets()
        console.log(`[Cron] Market data updated at ${result.updated}`)
        if (result.errors.length > 0) {
          console.warn('[Cron] Errors:', result.errors)
        }
      } catch (err) {
        console.error('[Cron] Update failed:', err)
      }
    }, { timezone: 'UTC' })

    console.log('[Cron] Scheduled: market data updates every 4 hours (UTC)')
  } catch (err) {
    console.error('[Cron] Failed to register cron:', err)
  }
}
