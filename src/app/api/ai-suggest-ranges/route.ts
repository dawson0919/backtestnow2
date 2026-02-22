import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { ParamRange } from '@/lib/optimization'

interface Suggestion {
  varName: string
  min:     number
  max:     number
  step:    number
  reason:  string
}

/**
 * Rule-based smart range suggestion — no API call needed.
 * Analyzes parameter name patterns to infer purpose and suggest sensible ranges.
 */
function suggestRange(p: ParamRange): Suggestion {
  const name   = p.varName.toLowerCase()
  const defVal = Math.round((p.min + p.max) / 2) || 1

  // ── Fast / short MA ─────────────────────────────────────────────────────────
  if (/fast|quick|short|ema_f|ma_f|f_len|f_period/.test(name)) {
    return { varName: p.varName, min: 3, max: 30, step: 1, reason: '快速均線：避免雜訊，範圍 3~30' }
  }

  // ── Slow / long MA ──────────────────────────────────────────────────────────
  if (/slow|long|ema_s|ma_s|s_len|s_period/.test(name)) {
    const base = Math.max(defVal, 30)
    return { varName: p.varName, min: Math.round(base * 0.5), max: Math.round(base * 2.5), step: 2, reason: '慢速均線：趨勢追蹤，範圍較寬' }
  }

  // ── Mid / middle MA ─────────────────────────────────────────────────────────
  if (/mid|middle|medium/.test(name)) {
    return { varName: p.varName, min: 10, max: 80, step: 2, reason: '中線均線：介於快慢MA之間' }
  }

  // ── RSI / momentum period ───────────────────────────────────────────────────
  if (/rsi|momentum|mom/.test(name)) {
    return { varName: p.varName, min: 7, max: 30, step: 1, reason: 'RSI週期：7~30 為常用範圍' }
  }

  // ── RSI oversold ────────────────────────────────────────────────────────────
  if (/oversold|ob_low|rsi_low|lower/.test(name)) {
    return { varName: p.varName, min: 20, max: 40, step: 2, reason: 'RSI 超賣線：通常 20~40' }
  }

  // ── RSI overbought ──────────────────────────────────────────────────────────
  if (/overbought|ob_high|rsi_high|upper/.test(name)) {
    return { varName: p.varName, min: 60, max: 80, step: 2, reason: 'RSI 超買線：通常 60~80' }
  }

  // ── ATR period ──────────────────────────────────────────────────────────────
  if (/atr/.test(name) && /period|len|length/.test(name)) {
    return { varName: p.varName, min: 7, max: 28, step: 1, reason: 'ATR週期：7~28' }
  }

  // ── ATR multiplier ──────────────────────────────────────────────────────────
  if (/atr/.test(name) && /mult|factor|coef/.test(name)) {
    return { varName: p.varName, min: 1, max: 4, step: p.type === 'float' ? 0.5 : 1, reason: 'ATR 倍數：1~4' }
  }

  // ── Stop loss / Take profit % ───────────────────────────────────────────────
  if (/stop|sl|stoploss|stop_loss/.test(name)) {
    const base = defVal || 2
    return { varName: p.varName, min: Math.max(0.5, Math.round(base * 0.5 * 10) / 10), max: Math.round(base * 2.5 * 10) / 10, step: p.type === 'float' ? 0.5 : 1, reason: '停損比例：以預設值為中心±倍數擴展' }
  }

  if (/take|tp|profit|takeprofit|take_profit/.test(name)) {
    const base = defVal || 4
    return { varName: p.varName, min: Math.max(0.5, Math.round(base * 0.5 * 10) / 10), max: Math.round(base * 3 * 10) / 10, step: p.type === 'float' ? 0.5 : 1, reason: '止盈比例：以預設值為中心擴展' }
  }

  // ── Bollinger / standard deviation period ──────────────────────────────────
  if (/bb|boll|band/.test(name) && /len|period|length/.test(name)) {
    return { varName: p.varName, min: 10, max: 50, step: 2, reason: '布林帶週期：10~50' }
  }

  if (/dev|std|mult|deviation/.test(name)) {
    return { varName: p.varName, min: 1, max: 3, step: 0.5, reason: '標準差倍數：1~3' }
  }

  // ── MACD fast/slow/signal ───────────────────────────────────────────────────
  if (/macd/.test(name) && /fast/.test(name)) {
    return { varName: p.varName, min: 6, max: 20, step: 1, reason: 'MACD 快線' }
  }
  if (/macd/.test(name) && /slow/.test(name)) {
    return { varName: p.varName, min: 20, max: 60, step: 2, reason: 'MACD 慢線' }
  }
  if (/signal|sig/.test(name)) {
    return { varName: p.varName, min: 5, max: 15, step: 1, reason: 'MACD 訊號線' }
  }

  // ── Generic period / length ─────────────────────────────────────────────────
  if (/period|length|len/.test(name)) {
    const base = Math.max(defVal, 5)
    const lo   = Math.max(2, Math.round(base * 0.3))
    const hi   = Math.round(base * 3)
    const step = hi - lo > 30 ? 2 : 1
    return { varName: p.varName, min: lo, max: hi, step, reason: `週期參數：以預設值為中心 ${lo}~${hi}` }
  }

  // ── Fallback: expand ±60% around current midpoint ──────────────────────────
  const lo   = Math.max(1, Math.round(defVal * 0.4))
  const hi   = Math.round(defVal * 2.5)
  const step = hi - lo > 30 ? 2 : 1
  return { varName: p.varName, min: lo, max: hi, step, reason: `根據預設值自動推算範圍 ${lo}~${hi}` }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { params } = await req.json() as { params: ParamRange[] }
    if (!params?.length) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

    const suggestions = params.map(suggestRange)

    const updatedRanges: ParamRange[] = params.map(p => {
      const s = suggestions.find(sg => sg.varName === p.varName)!
      return { ...p, min: s.min, max: s.max, step: s.step }
    })

    return NextResponse.json({
      success:      true,
      updatedRanges,
      reasons:      suggestions.map(s => ({ varName: s.varName, reason: s.reason })),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
