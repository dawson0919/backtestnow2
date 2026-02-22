export interface PineScriptParam {
  varName: string
  title: string
  type: 'int' | 'float' | 'bool' | 'string' | 'source'
  defaultValue: number | boolean | string
  minVal?: number
  maxVal?: number
  step?: number
  options?: string[]
}

export interface ParsedStrategy {
  params: PineScriptParam[]
  strategyName: string
  isValid: boolean
  detectedLogic: 'dual_ma' | 'rsi' | 'bollinger' | 'macd' | 'custom'
}

function parseArgString(argStr: string): Record<string, string> {
  const args: Record<string, string> = {}
  const positional: string[] = []
  let depth = 0
  let current = ''
  let inString = false
  let stringChar = ''

  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i]
    if (inString) {
      current += ch
      if (ch === stringChar) inString = false
    } else if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      current += ch
    } else if (ch === '(' || ch === '[') {
      depth++; current += ch
    } else if (ch === ')' || ch === ']') {
      depth--; current += ch
    } else if (ch === ',' && depth === 0) {
      const trimmed = current.trim()
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0 && !/[><!]/.test(trimmed[eqIdx - 1])) {
        const key = trimmed.substring(0, eqIdx).trim()
        const val = trimmed.substring(eqIdx + 1).trim()
        args[key] = val
      } else {
        positional.push(trimmed)
      }
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) {
    const trimmed = current.trim()
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0 && !/[><!]/.test(trimmed[eqIdx - 1])) {
      const key = trimmed.substring(0, eqIdx).trim()
      const val = trimmed.substring(eqIdx + 1).trim()
      args[key] = val
    } else {
      positional.push(trimmed)
    }
  }

  // Map positional args: input(defval, title, type, minval, maxval, step)
  const positionalKeys = ['defval', 'title', 'type', 'minval', 'maxval', 'step', 'options']
  positional.forEach((v, i) => {
    if (i < positionalKeys.length && !args[positionalKeys[i]]) {
      args[positionalKeys[i]] = v
    }
  })

  return args
}

function cleanValue(val: string): string {
  return val.replace(/^["']|["']$/g, '').trim()
}

function parseNumber(val: string): number | undefined {
  const n = parseFloat(val)
  return isNaN(n) ? undefined : n
}

export function parsePineScript(code: string): ParsedStrategy {
  const params: PineScriptParam[] = []

  // Extract strategy name
  const strategyNameMatch = code.match(/strategy\s*\(\s*["']([^"']+)["']/)
  const strategyName = strategyNameMatch ? strategyNameMatch[1] : 'Custom Strategy'

  // Match input() calls with variable assignment
  // Supports: input.int, input.float, input.bool, input.string, input.source, input()
  const inputRegex = /(\w+)\s*=\s*input(?:\.(int|float|bool|string|source))?\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g
  let match

  while ((match = inputRegex.exec(code)) !== null) {
    const varName = match[1]
    const inputType = (match[2] as PineScriptParam['type']) || 'float'
    const argsStr = match[3]

    try {
      const args = parseArgString(argsStr)
      const defval = args['defval'] || ''
      const title = args['title'] ? cleanValue(args['title']) : varName
      const minval = args['minval'] ? parseNumber(args['minval']) : undefined
      const maxval = args['maxval'] ? parseNumber(args['maxval']) : undefined
      const step = args['step'] ? parseNumber(args['step']) : undefined

      // Parse options array
      let options: string[] | undefined
      if (args['options']) {
        const optMatch = args['options'].match(/\[([^\]]+)\]/)
        if (optMatch) {
          options = optMatch[1].split(',').map(s => cleanValue(s.trim()))
        }
      }

      let defaultValue: number | boolean | string = 0
      if (inputType === 'bool') {
        defaultValue = defval.toLowerCase() === 'true'
      } else if (inputType === 'string') {
        defaultValue = cleanValue(defval)
      } else {
        defaultValue = parseNumber(defval) ?? 0
      }

      params.push({
        varName,
        title,
        type: inputType,
        defaultValue,
        minVal: minval,
        maxVal: maxval,
        step,
        options,
      })
    } catch {
      // Skip unparseable params
    }
  }

  // Detect strategy logic type
  let detectedLogic: ParsedStrategy['detectedLogic'] = 'custom'
  const lowerCode = code.toLowerCase()
  if (lowerCode.includes('ta.sma') || lowerCode.includes('ta.ema') || lowerCode.includes('crossover')) {
    detectedLogic = 'dual_ma'
  } else if (lowerCode.includes('ta.rsi') || lowerCode.includes('rsi(')) {
    detectedLogic = 'rsi'
  } else if (lowerCode.includes('ta.bb(') || lowerCode.includes('bollinger')) {
    detectedLogic = 'bollinger'
  } else if (lowerCode.includes('ta.macd') || lowerCode.includes('macd')) {
    detectedLogic = 'macd'
  }

  return {
    params,
    strategyName,
    isValid: params.length > 0 || code.includes('strategy('),
    detectedLogic,
  }
}

export function generateUpdatedCode(
  originalCode: string,
  params: PineScriptParam[],
  newValues: Record<string, number | string | boolean>
): string {
  let updatedCode = originalCode

  for (const param of params) {
    const newVal = newValues[param.varName]
    if (newVal === undefined) continue

    // Replace default value in input() call
    const escapedVar = param.varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    if (param.type === 'int' || param.type === 'float') {
      // Replace defval= named param or first positional arg
      updatedCode = updatedCode.replace(
        new RegExp(`(${escapedVar}\\s*=\\s*input(?:\\.(?:int|float))?\\s*\\()([^)]+)(\\))`, 'g'),
        (fullMatch, prefix, args, suffix) => {
          // Replace defval named or first positional
          let newArgs = args.replace(/defval\s*=\s*[\d.]+/, `defval = ${newVal}`)
          if (newArgs === args) {
            // Replace first number (positional defval)
            newArgs = args.replace(/^(\s*)[\d.]+/, `$1${newVal}`)
          }
          return `${prefix}${newArgs}${suffix}`
        }
      )
    }
  }

  return updatedCode
}

// Default dual MA example strategy
export const DUAL_MA_EXAMPLE = `//@version=5
strategy("Dual MA Crossover", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)

// === Parameters ===
fastLength = input.int(9, "Fast MA Period", minval=2, maxval=100, step=1)
slowLength = input.int(21, "Slow MA Period", minval=5, maxval=300, step=1)
maType = input.string("EMA", "MA Type", options=["SMA", "EMA", "WMA"])
stopLossPct = input.float(2.0, "Stop Loss %", minval=0.1, maxval=20.0, step=0.1)

// === Calculations ===
fastMA = maType == "SMA" ? ta.sma(close, fastLength) : maType == "EMA" ? ta.ema(close, fastLength) : ta.wma(close, fastLength)
slowMA = maType == "SMA" ? ta.sma(close, slowLength) : maType == "EMA" ? ta.ema(close, slowLength) : ta.wma(close, slowLength)

// === Entry/Exit Signals ===
longCondition  = ta.crossover(fastMA, slowMA)
shortCondition = ta.crossunder(fastMA, slowMA)

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.close("Long")

// === Plots ===
plot(fastMA, color=color.new(color.blue, 0), linewidth=2, title="Fast MA")
plot(slowMA, color=color.new(color.red, 0), linewidth=2, title="Slow MA")
`
