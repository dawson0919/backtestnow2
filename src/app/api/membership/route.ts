/**
 * GET /api/membership
 * Returns current user's role, usage count, and monthly limit.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const ADMIN_EMAIL = 'nbamoment@gmail.com'
const FREE_LIMIT  = 30
const ADV_LIMIT   = 100

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null
function sb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  return _sb
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const month = new Date().toISOString().substring(0, 7)

  // Get role
  const { data: roleRow } = await sb()
    .from('user_roles')
    .select('role, email, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  // Determine effective role
  let role: 'admin' | 'advanced' | 'free' = 'free'
  if (roleRow?.email === ADMIN_EMAIL || roleRow?.role === 'admin') {
    role = 'admin'
  } else if (roleRow?.role === 'advanced') {
    // Check if still valid
    if (!roleRow.expires_at || new Date(roleRow.expires_at) > new Date()) {
      role = 'advanced'
    }
  }

  // Get usage
  const { data: usage } = await sb()
    .from('usage_tracking')
    .select('count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle()

  const count = usage?.count ?? 0
  const limit = role === 'admin' ? 999999 : role === 'advanced' ? ADV_LIMIT : FREE_LIMIT

  // Check pending application
  const { data: pending } = await sb()
    .from('vip_applications')
    .select('id, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ role, count, limit, remaining: Math.max(0, limit - count), pending: pending ?? null })
}
