/**
 * PineScript Runtime
 * Parses a user's PineScript v5 strategy and executes it against OHLCV data.
 *
 * Supported constructs:
 *   - input.* declarations (values from params)
 *   - Variable assignments: varName = ta.ema(close, len)
 *   - ta.ema / ta.sma / ta.wma / ta.rsi / ta.crossover / ta.crossunder
 *   - ta.macd / ta.bb / ta.stoch / ta.atr / ta.highest / ta.lowest
 *   - Arithmetic: + - * /
 *   - Comparison: > < >= <= == !=
 *   - Logical: and / or / not (keywords and &&/||/!)
 *   - Ternary: cond ? a : b
 *   - Series indexing: series[n]
 *   - strategy.entry(), strategy.close(), strategy.exit()
 *   - if / else if / else blocks
 */

import {
  OHLCV, Trade, AssetConfig, BacktestResult,
  calcSMA, calcEMA, calcWMA, calcRSI,
  calcMetrics, calcMonthlyPnL,
} from './backtest-engine'

type NumSeries  = number[]
type BoolSeries = boolean[]
type ScalarVal  = number | boolean | string
type AnyVal     = NumSeries | BoolSeries | ScalarVal

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split expression on a binary op, respecting parentheses and brackets. */
function splitBinary(expr: string, op: string): [string, string] | null {
  let depth = 0
  for (let i = 0; i <= expr.length - op.length; i++) {
    const ch = expr[i]
    if (ch === '(' || ch === '[') { depth++; continue }
    if (ch === ')' || ch === ']') { depth--; continue }
    if (depth !== 0) continue
    if (expr.slice(i, i + op.length) !== op) continue

    // Avoid matching >= <= != == when looking for > < = !
    const before = i > 0               ? expr[i - 1]          : ' '
    const after  = i + op.length < expr.length ? expr[i + op.length] : ' '
    if (op.length === 1 && '=<>!'.includes(after))  continue
    if (op.length === 1 && '=<>!'.includes(before)) continue

    const left  = expr.slice(0, i).trim()
    const right = expr.slice(i + op.length).trim()
    if (left && right) return [left, right]
  }
  return null
}

/** Split top-level comma-separated args, respecting nested parens. */
function splitArgs(argsStr: string): string[] {
  const args: string[] = []
  let depth = 0
  let cur   = ''
  for (const ch of argsStr) {
    if (ch === '(' || ch === '[') { depth++; cur += ch }
    else if (ch === ')' || ch === ']') { depth--; cur += ch }
    else if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = '' }
    else cur += ch
  }
  if (cur.trim()) args.push(cur.trim())
  return args
}

/** Parse funcName(args) → { name, args[] } or null */
function parseFuncCall(expr: string): { name: string; args: string[] } | null {
  const parenIdx = expr.indexOf('(')
  if (parenIdx < 0 || !expr.endsWith(')')) return null
  const name     = expr.slice(0, parenIdx).trim()
  const argsStr  = expr.slice(parenIdx + 1, -1)
  return { name, args: splitArgs(argsStr) }
}

/** Strip line comments and trailing whitespace */
function stripComment(line: string): string {
  const ci = line.indexOf('//')
  return (ci >= 0 ? line.slice(0, ci) : line).trimEnd()
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

interface StrategySignal {
  type:      'long' | 'short' | 'close_long' | 'close_short' | 'close_all'
  condName:  string   // name of the boolean series to check
  entryId?:  string
}

export class PineRuntime {
  private vars     = new Map<string, AnyVal>()
  private n:       number
  private ohlcv:   OHLCV[]
  readonly signals: StrategySignal[] = []

  constructor(ohlcv: OHLCV[], params: Record<string, number | string | boolean>) {
    this.ohlcv = ohlcv
    this.n     = ohlcv.length

    // Built-in price series
    this.vars.set('close',  ohlcv.map(b => b.close))
    this.vars.set('open',   ohlcv.map(b => b.open))
    this.vars.set('high',   ohlcv.map(b => b.high))
    this.vars.set('low',    ohlcv.map(b => b.low))
    this.vars.set('volume', ohlcv.map(b => b.volume))
    this.vars.set('hl2',    ohlcv.map(b => (b.high + b.low) / 2))
    this.vars.set('hlc3',   ohlcv.map(b => (b.high + b.low + b.close) / 3))
    this.vars.set('ohlc4',  ohlcv.map(b => (b.open + b.high + b.low + b.close) / 4))
    this.vars.set('true',   true)
    this.vars.set('false',  false)

    // User params as scalars
    for (const [k, v] of Object.entries(params)) {
      this.vars.set(k, v)
    }
  }

  // ── Series helpers ──────────────────────────────────────────────────────────

  private numSeries(name: string): NumSeries | null {
    const v = this.vars.get(name)
    return Array.isArray(v) ? (v as NumSeries) : null
  }

  private resolveNumSrc(expr: string): NumSeries | null {
    const e = expr.trim()
    const s = this.numSeries(e)
    if (s) return s
    const num = parseFloat(e)
    if (!isNaN(num)) return new Array(this.n).fill(num)
    // Try evaluating as an expression
    const val = this.evalExpr(e)
    if (Array.isArray(val)) return val as NumSeries
    if (typeof val === 'number') return new Array(this.n).fill(val)
    return null
  }

  private resolveLen(expr: string): number {
    const e = expr.trim()
    const v = this.vars.get(e)
    if (typeof v === 'number') return Math.max(1, Math.round(v))
    const n = parseFloat(e)
    return isNaN(n) ? 14 : Math.max(1, Math.round(n))
  }

  private resolveNum(expr: string, idx: number): number {
    const e   = expr.trim()
    const ser = this.numSeries(e)
    if (ser) return ser[idx] ?? NaN
    const v = this.vars.get(e)
    if (typeof v === 'number') return v
    const n = parseFloat(e)
    return isNaN(n) ? NaN : n
  }

  private resolveBool(expr: string, idx: number): boolean {
    const e   = expr.trim()
    const val = this.vars.get(e)
    if (Array.isArray(val)) return Boolean((val as BoolSeries)[idx])
    if (typeof val === 'boolean') return val
    const res = this.evalExpr(e)
    if (Array.isArray(res)) return Boolean((res as BoolSeries)[idx])
    return Boolean(res)
  }

  // ── Expression evaluator ────────────────────────────────────────────────────

  evalExpr(expr: string): AnyVal | null {
    const e = expr.trim()
    if (!e) return null

    // ── Parenthesised sub-expression ────────────────────────────────────────
    if (e.startsWith('(') && e.endsWith(')')) {
      return this.evalExpr(e.slice(1, -1))
    }

    // ── Ternary: cond ? a : b ────────────────────────────────────────────────
    const ternary = splitBinary(e, '?')
    if (ternary) {
      const colonParts = splitBinary(ternary[1], ':')
      if (colonParts) {
        const condSer  = this.evalExprAsBoolSeries(ternary[0])
        const trueSer  = this.evalExprAsNumSeries(colonParts[0])
        const falseSer = this.evalExprAsNumSeries(colonParts[1])
        if (condSer && trueSer && falseSer)
          return condSer.map((c, i) => c ? trueSer[i] : falseSer[i])
      }
    }

    // ── Logical: or ──────────────────────────────────────────────────────────
    for (const op of [' or ', '||']) {
      const parts = splitBinary(e, op)
      if (parts) {
        const a = this.evalExprAsBoolSeries(parts[0])
        const b = this.evalExprAsBoolSeries(parts[1])
        if (a && b) return a.map((v, i) => v || b[i])
      }
    }

    // ── Logical: and ─────────────────────────────────────────────────────────
    for (const op of [' and ', '&&']) {
      const parts = splitBinary(e, op)
      if (parts) {
        const a = this.evalExprAsBoolSeries(parts[0])
        const b = this.evalExprAsBoolSeries(parts[1])
        if (a && b) return a.map((v, i) => v && b[i])
      }
    }

    // ── Logical: not ─────────────────────────────────────────────────────────
    if (e.startsWith('not ') || e.startsWith('!')) {
      const inner = e.startsWith('not ') ? e.slice(4) : e.slice(1)
      const a = this.evalExprAsBoolSeries(inner)
      if (a) return a.map(v => !v)
    }

    // ── Comparisons ──────────────────────────────────────────────────────────
    for (const op of ['>=', '<=', '!=', '==', '>', '<']) {
      const parts = splitBinary(e, op)
      if (!parts) continue
      const a = this.evalExprAsNumSeries(parts[0])
      const b = this.evalExprAsNumSeries(parts[1])
      if (a && b) {
        return a.map((v, i) => {
          switch (op) {
            case '>':  return v > b[i]
            case '<':  return v < b[i]
            case '>=': return v >= b[i]
            case '<=': return v <= b[i]
            case '==': return v === b[i]
            case '!=': return v !== b[i]
            default:   return false
          }
        })
      }
      // String comparison fallback — handles maType == "EMA", etc.
      if (op === '==' || op === '!=') {
        const aVal = this.evalExpr(parts[0])
        const bVal = this.evalExpr(parts[1])
        if (aVal !== null && bVal !== null) {
          const eq = String(aVal) === String(bVal)
          return new Array(this.n).fill(op === '==' ? eq : !eq)
        }
      }
    }

    // ── Arithmetic: + - * / ───────────────────────────────────────────────────
    for (const op of ['+', '-', '*', '/']) {
      const parts = splitBinary(e, op)
      if (!parts) continue
      const a = this.evalExprAsNumSeries(parts[0])
      const b = this.evalExprAsNumSeries(parts[1])
      if (!a || !b) continue
      return a.map((v, i) => {
        switch (op) {
          case '+': return v + b[i]
          case '-': return v - b[i]
          case '*': return v * b[i]
          case '/': return b[i] === 0 ? NaN : v / b[i]
          default:  return NaN
        }
      })
    }

    // ── Series indexing: series[n] ────────────────────────────────────────────
    const idxMatch = e.match(/^(\w+)\[(\d+)\]$/)
    if (idxMatch) {
      const s = this.numSeries(idxMatch[1])
      const offset = parseInt(idxMatch[2])
      if (s) return s.map((_, i) => i >= offset ? s[i - offset] : NaN)
    }

    // ── Function calls ────────────────────────────────────────────────────────
    const fc = parseFuncCall(e)
    if (fc) {
      const r = this.evalFunc(fc.name, fc.args)
      if (r !== null) return r
    }

    // ── String literal ────────────────────────────────────────────────────────
    if ((e.startsWith('"') && e.endsWith('"')) || (e.startsWith("'") && e.endsWith("'"))) {
      return e.slice(1, -1)
    }

    // ── Literal or variable ───────────────────────────────────────────────────
    const num = parseFloat(e)
    if (!isNaN(num)) return num
    if (e === 'true')  return true
    if (e === 'false') return false
    const v = this.vars.get(e)
    if (v !== undefined) return v

    return null
  }

  private evalExprAsNumSeries(expr: string): NumSeries | null {
    const e = expr.trim()
    const s = this.numSeries(e)
    if (s) return s
    const val = this.evalExpr(e)
    if (Array.isArray(val)) return val as NumSeries
    if (typeof val === 'number') return new Array(this.n).fill(val)
    return null
  }

  private evalExprAsBoolSeries(expr: string): BoolSeries | null {
    const e = expr.trim()
    const v = this.vars.get(e)
    if (Array.isArray(v)) return v as BoolSeries
    if (typeof v === 'boolean') return new Array(this.n).fill(v)
    const val = this.evalExpr(e)
    if (Array.isArray(val)) return val as BoolSeries
    if (typeof val === 'boolean') return new Array(this.n).fill(val)
    return null
  }

  // ── Built-in function evaluation ────────────────────────────────────────────

  private evalFunc(name: string, args: string[]): AnyVal | null {
    const n = this.n

    switch (name) {
      case 'ta.sma': {
        const src = this.resolveNumSrc(args[0])
        const len = this.resolveLen(args[1])
        return src ? calcSMA(src, len) : null
      }
      case 'ta.ema': {
        const src = this.resolveNumSrc(args[0])
        const len = this.resolveLen(args[1])
        return src ? calcEMA(src, len) : null
      }
      case 'ta.wma': {
        const src = this.resolveNumSrc(args[0])
        const len = this.resolveLen(args[1])
        return src ? calcWMA(src, len) : null
      }
      case 'ta.rma': {
        // RMA = Wilder's smoothing = EMA with alpha = 1/len
        const src = this.resolveNumSrc(args[0])
        const len = this.resolveLen(args[1])
        if (!src) return null
        const result = new Array(n).fill(NaN)
        const k = 1 / len
        let rma = src[0]
        result[0] = rma
        for (let i = 1; i < n; i++) {
          rma = src[i] * k + rma * (1 - k)
          result[i] = rma
        }
        return result
      }
      case 'ta.rsi': {
        const src = this.resolveNumSrc(args[0])
        const len = this.resolveLen(args[1])
        return src ? calcRSI(src, len) : null
      }
      case 'ta.crossover': {
        const a = this.resolveNumSrc(args[0])
        const b = this.resolveNumSrc(args[1])
        if (!a || !b) return null
        return a.map((v, i) => i > 0 && a[i-1] < b[i-1] && v >= b[i]) as BoolSeries
      }
      case 'ta.crossunder': {
        const a = this.resolveNumSrc(args[0])
        const b = this.resolveNumSrc(args[1])
        if (!a || !b) return null
        return a.map((v, i) => i > 0 && a[i-1] > b[i-1] && v <= b[i]) as BoolSeries
      }
      case 'ta.highest': {
        const src = this.resolveNumSrc(args[0])
        const len = this.resolveLen(args[1])
        if (!src) return null
        return src.map((_, i) => {
          let max = -Infinity
          for (let j = Math.max(0, i - len + 1); j <= i; j++) if (!isNaN(src[j])) max = Math.max(max, src[j])
          return max === -Infinity ? NaN : max
        })
      }
      case 'ta.lowest': {
        const src = this.resolveNumSrc(args[0])
        const len = this.resolveLen(args[1])
        if (!src) return null
        return src.map((_, i) => {
          let min = Infinity
          for (let j = Math.max(0, i - len + 1); j <= i; j++) if (!isNaN(src[j])) min = Math.min(min, src[j])
          return min === Infinity ? NaN : min
        })
      }
      case 'ta.stoch': {
        // ta.stoch(src, high, low, len)
        const src  = this.resolveNumSrc(args[0])
        const high = this.resolveNumSrc(args[1] ?? 'high')
        const low  = this.resolveNumSrc(args[2] ?? 'low')
        const len  = this.resolveLen(args[3] ?? args[1] ?? '14')
        if (!src || !high || !low) return null
        return src.map((_, i) => {
          const hh = high.slice(Math.max(0, i - len + 1), i + 1).reduce((a, b) => Math.max(a, b), -Infinity)
          const ll = low.slice(Math.max(0, i - len + 1), i + 1).reduce((a, b) => Math.min(a, b), Infinity)
          return hh === ll ? 100 : (src[i] - ll) / (hh - ll) * 100
        })
      }
      case 'ta.atr': {
        const len = this.resolveLen(args[0])
        const tr  = this.ohlcv.map((b, i) => {
          if (i === 0) return b.high - b.low
          const prevClose = this.ohlcv[i-1].close
          return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose))
        })
        return calcEMA(tr, len)   // Wilder's ATR ≈ EMA of TR with period len
      }
      case 'ta.macd': {
        // Returns [macdLine, signalLine, histogram] — store as named vars
        const src    = this.resolveNumSrc(args[0] ?? 'close')
        const fast   = this.resolveLen(args[1] ?? '12')
        const slow   = this.resolveLen(args[2] ?? '26')
        const signal = this.resolveLen(args[3] ?? '9')
        if (!src) return null
        const fastEMA  = calcEMA(src, fast)
        const slowEMA  = calcEMA(src, slow)
        const macdLine = fastEMA.map((f, i) => isNaN(f) || isNaN(slowEMA[i]) ? NaN : f - slowEMA[i])
        const firstValid = macdLine.findIndex(v => !isNaN(v))
        const sigLine = new Array(n).fill(NaN)
        if (firstValid >= 0) {
          const sigEMA = calcEMA(macdLine.slice(firstValid), signal)
          for (let i = 0; i < sigEMA.length; i++) sigLine[firstValid + i] = sigEMA[i]
        }
        const hist = macdLine.map((v, i) => isNaN(v) || isNaN(sigLine[i]) ? NaN : v - sigLine[i])
        // Return the three-tuple as an array-of-arrays trick:
        // PineScript: [macdLine, signalLine, hist] = ta.macd(src, f, s, sig)
        // We handle this specially in processLine via destructure
        this.vars.set('__macd_line',   macdLine)
        this.vars.set('__macd_signal', sigLine)
        this.vars.set('__macd_hist',   hist)
        return macdLine   // default return is macdLine
      }
      case 'ta.bb': {
        // Returns [upper, basis, lower]
        const src  = this.resolveNumSrc(args[0] ?? 'close')
        const len  = this.resolveLen(args[1] ?? '20')
        const mult = parseFloat(args[2] ?? '2.0') || 2.0
        if (!src) return null
        const basis = calcSMA(src, len)
        const upper = new Array(n).fill(NaN)
        const lower = new Array(n).fill(NaN)
        for (let i = len - 1; i < n; i++) {
          let sumSq = 0
          for (let j = 0; j < len; j++) sumSq += (src[i - j] - basis[i]) ** 2
          const std = Math.sqrt(sumSq / len)
          upper[i] = basis[i] + mult * std
          lower[i] = basis[i] - mult * std
        }
        this.vars.set('__bb_upper', upper)
        this.vars.set('__bb_basis', basis)
        this.vars.set('__bb_lower', lower)
        return basis
      }
      case 'math.abs':   return this.evalExprAsNumSeries(args[0])?.map(v => Math.abs(v)) ?? null
      case 'math.max': {
        const a = this.resolveNumSrc(args[0])
        const b = this.resolveNumSrc(args[1])
        return a && b ? a.map((v, i) => Math.max(v, b[i])) : null
      }
      case 'math.min': {
        const a = this.resolveNumSrc(args[0])
        const b = this.resolveNumSrc(args[1])
        return a && b ? a.map((v, i) => Math.min(v, b[i])) : null
      }
      case 'nz': {
        const s = this.resolveNumSrc(args[0])
        const fallback = args[1] ? parseFloat(args[1]) : 0
        return s ? s.map(v => isNaN(v) || v === null ? fallback : v) : null
      }
      default:
        return null
    }
  }

  // ── Script processing ────────────────────────────────────────────────────────

  /** Process entire PineScript code, building the variables map and signal list. */
  execute(code: string): void {
    const lines = code.split('\n')
    let i = 0

    while (i < lines.length) {
      const raw  = stripComment(lines[i])
      const line = raw.trim()
      i++

      if (!line || line.startsWith('//') || line.startsWith('//@')) continue

      // ── strategy.entry / strategy.close / strategy.exit (inline) ────────────
      if (/strategy\.(entry|close|exit)\s*\(/.test(line)) {
        this.parseStrategyCall(line, 'true')
        continue
      }

      // ── if condition ─────────────────────────────────────────────────────────
      if (line.startsWith('if ') || line.startsWith('if(')) {
        // Remove 'if' keyword only; do NOT strip trailing ')' — it may belong to a function call
        let condExpr = line.replace(/^if\s*/, '').replace(/\s*then\s*$/, '').replace(/\s*[:{]?\s*$/, '').trim()
        // Strip outer parentheses only when they wrap the whole expression
        if (condExpr.startsWith('(') && condExpr.endsWith(')')) {
          let depth = 0; let allWrapped = true
          for (let ci = 0; ci < condExpr.length - 1; ci++) {
            if (condExpr[ci] === '(') depth++
            else if (condExpr[ci] === ')') { depth--; if (depth === 0) { allWrapped = false; break } }
          }
          if (allWrapped) condExpr = condExpr.slice(1, -1).trim()
        }
        // Collect indented block
        const block: string[] = []
        while (i < lines.length) {
          const nextRaw  = stripComment(lines[i])
          const nextLine = nextRaw.trim()
          if (!nextLine) { i++; continue }
          // Block ends when indentation drops (or 'else')
          const indent = nextRaw.length - nextRaw.trimStart().length
          const ifIndent = raw.length - raw.trimStart().length
          if (indent <= ifIndent && nextLine !== '') break
          block.push(nextLine); i++
        }

        // Assign condition to a temp variable name
        const condVarName = `__cond_${this.signals.length}`
        const condVal = this.evalExpr(condExpr)
        if (condVal !== null) this.vars.set(condVarName, condVal)
        else this.vars.set(condVarName, new Array(this.n).fill(false))

        for (const bline of block) {
          if (/strategy\.(entry|close|exit)\s*\(/.test(bline)) {
            this.parseStrategyCall(bline, condVarName)
          }
        }
        continue
      }

      // ── [macdLine, signalLine, hist] = ta.macd(...) ──────────────────────────
      const destructureMatch = line.match(/^\[\s*(\w+)\s*,\s*(\w+)\s*(?:,\s*(\w+))?\s*\]\s*=\s*ta\.macd\s*\((.+)\)$/)
      if (destructureMatch) {
        const args = splitArgs(destructureMatch[4])
        this.evalFunc('ta.macd', args)
        this.vars.set(destructureMatch[1], this.vars.get('__macd_line')  ?? new Array(this.n).fill(NaN))
        this.vars.set(destructureMatch[2], this.vars.get('__macd_signal') ?? new Array(this.n).fill(NaN))
        if (destructureMatch[3]) this.vars.set(destructureMatch[3], this.vars.get('__macd_hist') ?? new Array(this.n).fill(NaN))
        continue
      }

      // ── [upper, basis, lower] = ta.bb(...) ───────────────────────────────────
      const bbDestructure = line.match(/^\[\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*ta\.bb\s*\((.+)\)$/)
      if (bbDestructure) {
        const args = splitArgs(bbDestructure[4])
        this.evalFunc('ta.bb', args)
        this.vars.set(bbDestructure[1], this.vars.get('__bb_upper') ?? new Array(this.n).fill(NaN))
        this.vars.set(bbDestructure[2], this.vars.get('__bb_basis') ?? new Array(this.n).fill(NaN))
        this.vars.set(bbDestructure[3], this.vars.get('__bb_lower') ?? new Array(this.n).fill(NaN))
        continue
      }

      // ── Variable assignment: varName = expr ──────────────────────────────────
      const assignMatch = line.match(/^(?:var\s+)?(\w+)\s*(?::=|=)\s*(.+)$/)
      if (assignMatch) {
        const [, varName, rhs] = assignMatch
        if (/^input/.test(rhs.trim())) continue   // skip input declarations
        if (/^strategy\b/.test(rhs.trim())) continue // skip strategy() calls

        const val = this.evalExpr(rhs)
        if (val !== null) this.vars.set(varName, val)
      }
    }
  }

  /** Parse a strategy.entry/close/exit call and record a signal. */
  private parseStrategyCall(line: string, condVarName: string): void {
    const fc = parseFuncCall(line.replace(/^.*?(?=strategy\.)/, ''))
    if (!fc) return

    if (fc.name === 'strategy.entry') {
      const id        = (fc.args[0] ?? '').replace(/^["']|["']$/g, '')
      const dirArg    = fc.args[1] ?? ''
      const direction = dirArg.includes('strategy.short') ? 'short' : 'long'
      this.signals.push({ type: direction, condName: condVarName, entryId: id })
    } else if (fc.name === 'strategy.close') {
      // strategy.close("Long") → close long position
      const id = (fc.args[0] ?? '').replace(/^["']|["']$/g, '')
      // Detect direction from id convention: Long/long = close long
      const type = /short/i.test(id) ? 'close_short' : 'close_long'
      this.signals.push({ type, condName: condVarName })
    } else if (fc.name === 'strategy.exit') {
      this.signals.push({ type: 'close_all', condName: condVarName })
    } else if (fc.name === 'strategy.close_all') {
      this.signals.push({ type: 'close_all', condName: condVarName })
    }
  }

  /** Get a boolean series for a registered condition variable. */
  getCondAt(condVarName: string, idx: number): boolean {
    const v = this.vars.get(condVarName)
    if (Array.isArray(v)) return Boolean((v as BoolSeries)[idx])
    return Boolean(v)
  }
}

// ─── Full backtest execution ───────────────────────────────────────────────────

interface OpenPos {
  entryIndex: number
  entryPrice: number
  direction:  'long' | 'short'
}

function makeClosedTrade(
  pos:        OpenPos,
  exitIndex:  number,
  exitPrice:  number,
  ohlcv:      OHLCV[],
  aType:      string,
  pointValue: number
): Trade {
  const pointsMove = exitPrice - pos.entryPrice
  const pnlPct     = pos.direction === 'long'
    ? (exitPrice - pos.entryPrice) / pos.entryPrice * 100
    : (pos.entryPrice - exitPrice) / pos.entryPrice * 100
  const pnlDollars = aType === 'futures'
    ? (pos.direction === 'long' ? pointsMove : -pointsMove) * pointValue
    : 0
  return {
    entryIndex:     pos.entryIndex,
    exitIndex,
    entryTimestamp: ohlcv[pos.entryIndex].timestamp,
    exitTimestamp:  ohlcv[exitIndex].timestamp,
    entryPrice:     pos.entryPrice,
    exitPrice,
    direction:      pos.direction,
    pnlPct,
    pointsMove,
    pnlDollars,
  }
}

/**
 * Execute a PineScript strategy against OHLCV data and return a BacktestResult.
 * @param code - The user's PineScript v5 strategy code
 * @param params - Parameter values (from optimization combo or defaults)
 * @param ohlcv - Historical OHLCV data
 * @param assetConfig - Asset type and point value
 */
export function runPineScriptBacktest(
  code:        string,
  params:      Record<string, number | string | boolean>,
  ohlcv:       OHLCV[],
  assetConfig: AssetConfig = { type: 'crypto', pointValue: 1 }
): BacktestResult {
  const n = ohlcv.length
  const { type: aType, pointValue } = assetConfig

  // 1. Build runtime and execute script
  const runtime = new PineRuntime(ohlcv, params)
  try {
    runtime.execute(code)
  } catch {
    // Fall through with whatever was computed before the error
  }

  // 2. Simulate bar-by-bar using detected signals
  const trades:     Trade[]  = []
  let equity        = 100
  const equityCurve = [100]
  let position:     OpenPos | null = null

  for (let i = 1; i < n; i++) {
    const price = ohlcv[i].close

    // Evaluate all signals in order (later ones override earlier in same bar)
    for (const sig of runtime.signals) {
      const active = runtime.getCondAt(sig.condName, i)
      if (!active) continue

      switch (sig.type) {
        case 'long':
          if (position?.direction !== 'long') {
            if (position) {
              const t = makeClosedTrade(position, i, price, ohlcv, aType, pointValue)
              trades.push(t); equity *= (1 + t.pnlPct / 100)
            }
            position = { entryIndex: i, entryPrice: price, direction: 'long' }
          }
          break
        case 'short':
          if (position?.direction !== 'short') {
            if (position) {
              const t = makeClosedTrade(position, i, price, ohlcv, aType, pointValue)
              trades.push(t); equity *= (1 + t.pnlPct / 100)
            }
            position = { entryIndex: i, entryPrice: price, direction: 'short' }
          }
          break
        case 'close_long':
          if (position?.direction === 'long') {
            const t = makeClosedTrade(position, i, price, ohlcv, aType, pointValue)
            trades.push(t); equity *= (1 + t.pnlPct / 100)
            position = null
          }
          break
        case 'close_short':
          if (position?.direction === 'short') {
            const t = makeClosedTrade(position, i, price, ohlcv, aType, pointValue)
            trades.push(t); equity *= (1 + t.pnlPct / 100)
            position = null
          }
          break
        case 'close_all':
          if (position) {
            const t = makeClosedTrade(position, i, price, ohlcv, aType, pointValue)
            trades.push(t); equity *= (1 + t.pnlPct / 100)
            position = null
          }
          break
      }
    }

    equityCurve.push(equity)
  }

  // Close any open position at last bar
  if (position) {
    const lastIdx = n - 1
    const t = makeClosedTrade(position, lastIdx, ohlcv[lastIdx].close, ohlcv, aType, pointValue)
    trades.push(t); equity *= (1 + t.pnlPct / 100)
  }

  return {
    ...calcMetrics(trades, equityCurve, ohlcv),
    params,
    trades,
    equityCurve,
    monthlyPnL: calcMonthlyPnL(trades),
  }
}
