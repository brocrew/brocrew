import { readFileSync } from 'node:fs'

/** Card 483: the text of the kept file a read_document answer names by its path. */
export function textOfTheKeptFile(answer: string): string {
  const said = /^Kept file: (.+)$/m.exec(answer)?.[1]
  if (said === undefined) throw new Error(`no kept path in: ${answer}`)
  return readFileSync(said.startsWith('"') ? (JSON.parse(said) as string) : said, 'utf8')
}
