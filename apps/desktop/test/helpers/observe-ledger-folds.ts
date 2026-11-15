import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Count the actual fold branches only in the measured test worker's bundle. */
export function observeLedgerFolds(): Plugin {
  return {
    name: 'observe-ledger-folds',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/db/ledger-fold-state.ts')) return null
      const replace = (from: string, to: string) => {
        if (source.split(from).length !== 2) throw new Error('The observed fold branch moved')
        source = source.replace(from, to)
      }
      replace(
        '? { answer: held.answer }',
        "? (noteFold(snapshotKey, 'keptOnly'), { answer: held.answer })",
      )
      replace(
        'if (!theFoldsMayBeKept()) return fold(sessionId, noteSkip)',
        "if (!theFoldsMayBeKept()) { noteFold(snapshotKey, 'rebuilt'); return fold(sessionId, noteSkip) }",
      )
      replace(
        'keep(sessionId, held)\n          return held.answer',
        "noteFold(snapshotKey, 'reused')\n          keep(sessionId, held)\n          return held.answer",
      )
      replace(
        'keep(sessionId, { generation, newest, answer })\n            return answer',
        "noteFold(snapshotKey, 'carried')\n            keep(sessionId, { generation, newest, answer })\n            return answer",
      )
      replace(
        'if (noteSkip === undefined) return fold(sessionId)',
        "noteFold(snapshotKey, 'rebuilt')\n      if (noteSkip === undefined) return fold(sessionId)",
      )
      const counter = fileURLToPath(new URL('./observed-fold-counts.ts', import.meta.url))
      return { code: `import { noteFold } from ${JSON.stringify(counter)}\n${source}`, map: null }
    },
  }
}
