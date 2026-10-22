/** The index's file in a profile's saved-methods folder. */
export const SAVED_METHODS_INDEX = 'index.md'

const LINE = /^- (.+?) \| (.+?) \| verified (\d{4}-\d{2}-\d{2}) \| ([a-z0-9][a-z0-9-]*\.md)$/
/** Characters a title or its use may not hold: markup, links, and control or format characters. */
const NOT_IN_A_FIELD = /[`<>[\]|\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** A real date written as `YYYY-MM-DD`. */
function aRealDate(text: string): boolean {
  const [year, month, day] = text.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** A title or its use: short, trimmed, and free of markup, links and control characters. */
function aField(text: string, most: number): boolean {
  return (
    text.length > 0 && text.length <= most && text === text.trim() && !NOT_IN_A_FIELD.test(text)
  )
}

/** The same metadata parser serves launch composition and the complete book inventory. */
export function parseSavedMethodLine(raw: string): {
  readonly title: string
  readonly when: string
  readonly verified: string
  readonly file: string
} | null {
  const found = LINE.exec(raw.trimEnd())
  if (found === null) return null
  const [title, when, verified, file] = found.slice(1)
  if (
    title === undefined ||
    when === undefined ||
    verified === undefined ||
    file === undefined ||
    !aField(title, 80) ||
    !aField(when, 200) ||
    !aRealDate(verified)
  )
    return null
  return { title, when, verified, file }
}
