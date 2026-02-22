/**
 * POST /api/upgrade-request
 * Submit a VIP upgrade application.
 * Body: { platformAccount: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null
function sb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  return _sb
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { platformAccount } = await req.json() as { platformAccount: string }
  if (!platformAccount?.trim()) {
    return NextResponse.json({ error: '請填寫交易平台帳號' }, { status: 400 })
  }

  // Get user email from Clerk
  const clerkUser = await currentUser()
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''
  const name  = clerkUser?.fullName ?? clerkUser?.username ?? ''

  // Check for existing pending application
  const { data: existing } = await sb()
    .from('vip_applications')
    .select('id, status')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: '已有待審核的申請，請等待管理員審核' }, { status: 409 })
  }

  const { data, error } = await sb()
    .from('vip_applications')
    .insert({
      user_id:          userId,
      user_email:       email,
      user_name:        name,
      platform_account: platformAccount.trim(),
      screenshot_url:   '',
      status:           'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id })
}
