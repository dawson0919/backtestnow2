import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET /api/strategies — list saved strategies for current user
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectName = searchParams.get('project')

  let query = supabase
    .from('user_strategies')
    .select('id, project_name, strategy_name, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (projectName) query = query.eq('project_name', projectName)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ strategies: data })
}

// POST /api/strategies — save a new strategy (or update by id)
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    id?:           string
    projectName:   string
    strategyName:  string
    code:          string
  }

  const { id, projectName, strategyName, code } = body

  if (!strategyName?.trim() || !code?.trim()) {
    return NextResponse.json({ error: '策略名稱與程式碼不能為空' }, { status: 400 })
  }

  if (id) {
    // Update existing
    const { data, error } = await supabase
      .from('user_strategies')
      .update({
        project_name:  projectName || '未命名專案',
        strategy_name: strategyName.trim(),
        code,
        updated_at:    new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, id: data?.id })
  }

  // Insert new
  const { data, error } = await supabase
    .from('user_strategies')
    .insert({
      user_id:       userId,
      project_name:  projectName || '未命名專案',
      strategy_name: strategyName.trim(),
      code,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, id: data?.id })
}

// DELETE /api/strategies?id=... — delete a strategy
export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase
    .from('user_strategies')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
