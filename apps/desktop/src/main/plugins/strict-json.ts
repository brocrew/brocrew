import { refusePlugin } from './verification-error'

/** JSON is decoded once, with duplicate decoded keys and non-scalar Unicode refused. */
export function strictPluginJson(bytes: Uint8Array, maximumBytes: number): unknown {
  if (bytes.byteLength > maximumBytes) refusePlugin('limit')
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refusePlugin('invalid')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return refusePlugin('invalid')
  }
  let at = 0
  let nodes = 0
  const numberAt = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const white = () => {
    while (at < text.length && /[\t\n\r ]/.test(text[at]!)) at += 1
  }
  const string = (): string => {
    const start = at++
    while (at < text.length) {
      const character = text[at++]
      if (character === '\\') at += 1
      else if (character === '"') {
        let value: unknown
        try {
          value = JSON.parse(text.slice(start, at))
        } catch {
          return refusePlugin('invalid')
        }
        if (typeof value !== 'string') refusePlugin('invalid')
        for (let index = 0; index < value.length; index++) {
          const code = value.charCodeAt(index)
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(++index)
            if (!(next >= 0xdc00 && next <= 0xdfff)) refusePlugin('invalid')
          } else if (code >= 0xdc00 && code <= 0xdfff) refusePlugin('invalid')
        }
        return value
      }
    }
    return refusePlugin('invalid')
  }
  const value = (depth: number): unknown => {
    if (depth > 64 || ++nodes > 100_000) refusePlugin('limit')
    white()
    const first = text[at]
    if (first === '"') return string()
    if (first === '{') {
      at += 1
      const result: Record<string, unknown> = Object.create(null)
      const keys = new Set<string>()
      white()
      if (text[at] === '}') {
        at += 1
        return result
      }
      for (;;) {
        white()
        if (text[at] !== '"') refusePlugin('invalid')
        const key = string()
        if (keys.has(key)) refusePlugin('invalid')
        keys.add(key)
        white()
        if (text[at++] !== ':') refusePlugin('invalid')
        result[key] = value(depth + 1)
        white()
        const end = text[at++]
        if (end === '}') return result
        if (end !== ',') refusePlugin('invalid')
      }
    }
    if (first === '[') {
      at += 1
      const result: unknown[] = []
      white()
      if (text[at] === ']') {
        at += 1
        return result
      }
      for (;;) {
        result.push(value(depth + 1))
        white()
        const end = text[at++]
        if (end === ']') return result
        if (end !== ',') refusePlugin('invalid')
      }
    }
    for (const [token, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(token, at)) {
        at += token.length
        return result
      }
    }
    numberAt.lastIndex = at
    const number = numberAt.exec(text)?.[0]
    if (number === undefined) return refusePlugin('invalid')
    at += number.length
    const parsed = Number(number)
    if (!Number.isFinite(parsed)) refusePlugin('invalid')
    return parsed
  }
  const parsed = value(0)
  white()
  if (at !== text.length) refusePlugin('invalid')
  return parsed
}
