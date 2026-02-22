import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Asset = {
  id: number
  symbol: string
  type: 'crypto' | 'futures'
  name: string
  base_currency: string
  quote_currency: string
  pip_value: number
  contract_size: number
  active: boolean
}

export type OptimizationHistory = {
  id: string
  user_id: string
  asset: string
  timeframe: string
  code: string
  net_profit_pct: string
  top_params: Record<string, unknown>
  created_at: string
}
