/**
 * Admin: manage VIP upgrade applications
 * GET  /api/admin/applications        — list all
 * POST /api/admin/applications        — approve or reject { id, action: 'approve'|'reject', note? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const ADMIN_EMAIL = 'nbamoment@gmail.com'
const ADV_MONTHS  = 3 // months of advanced access granted

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null
function sb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  return _sb
}

async function checkAdmin(): Promise<boolean> {
  const clerkUser = await currentUser()
  return clerkUser?.emailAddresses?.some(e => e.emailAddress === ADMIN_EMAIL) ?? false
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { data, error } = await sb()
    .from('vip_applications')
    .select('id, user_id, user_email, user_name, platform_account, status, admin_note, created_at, reviewed_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ applications: data })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { id, action, note } = await req.json() as { id: string; action: 'approve' | 'reject'; note?: string }
  if (!id || !action) return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })

  // Update application status
  const { data: app, error: appErr } = await sb()
    .from('vip_applications')
    .update({ status: action === 'approve' ? 'approved' : 'rejected', admin_note: note ?? '', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('user_id')
    .single()

  if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 })

  if (action === 'approve' && app?.user_id) {
    // Grant advanced membership for 3 months
    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + ADV_MONTHS)

    await sb()
      .from('user_roles')
      .upsert({
        user_id:    app.user_id,
        role:       'advanced',
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
  }

  return NextResponse.json({ success: true })
}
