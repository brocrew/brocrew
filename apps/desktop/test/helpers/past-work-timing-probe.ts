import type { Plugin } from 'vite'

function insert(source: string, anchor: string, replacement: string): string {
  const first = source.indexOf(anchor)
  if (first === -1 || source.indexOf(anchor, first + anchor.length) !== -1)
    throw new Error('Card 432 diagnostic source anchor changed: ' + anchor)
  return source.replace(anchor, replacement)
}

// Only this fixture's worker bundle gets these counters. The checked-in worker and SQL stay intact.
export function pastWorkTimingProbe(): Plugin {
  return {
    name: 'card432-past-work-timing-probe',
    enforce: 'pre',
    transform(source, id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/main/db/past-work-search.ts')) {
        let code = insert(
          source,
          'const DOCUMENT_LIMIT =',
          'export let card432RankTiming\nconst DOCUMENT_LIMIT =',
        )
        code = insert(
          code,
          "  if (db.inTransaction) return { ok: false, reason: 'unavailable' }",
          "  card432RankTiming = undefined\n  if (db.inTransaction) return { ok: false, reason: 'unavailable' }",
        )
        code = insert(
          code,
          '        const head = indexDb',
          '        const rankCpu = process.threadCpuUsage()\n        const rankStarted = process.hrtime.bigint()\n        const head = indexDb',
        )
        code = insert(
          code,
          '        yield* head\n        if (head.length === MIXED_RANK_HEAD) {',
          `        const rankMs = Number(process.hrtime.bigint() - rankStarted) / 1e6
        const rankUsage = process.threadCpuUsage(rankCpu)
        card432RankTiming = { wallMs: rankMs, cpuMs: (rankUsage.user + rankUsage.system) / 1000, rows: head.length, fallback: false }
        yield* head
        if (head.length === MIXED_RANK_HEAD) {
          card432RankTiming.fallback = true`,
        )
        return code
      }
      if (!path.endsWith('/src/main/past-work-search.worker.ts')) return
      let code = insert(
        source,
        "import { searchPastWork } from './db/past-work-search'",
        "import { card432RankTiming, searchPastWork } from './db/past-work-search'",
      )
      code = insert(
        code,
        '    const parsed = request.safeParse(value)',
        '    const receivedAt = process.hrtime.bigint()\n    const workerCpu = process.threadCpuUsage()\n    const parsed = request.safeParse(value)',
      )
      return insert(
        code,
        '    port.postMessage({ id, result: searchPastWork(db, store, caller, words, source) })',
        `    const result = searchPastWork(db, store, caller, words, source)
    const workerUsage = process.threadCpuUsage(workerCpu)
    const sendingAt = process.hrtime.bigint()
    port.postMessage({
      id, result,
      card432: {
        receivedAt, sendingAt,
        workerCpuMs: (workerUsage.user + workerUsage.system) / 1000,
        rank: card432RankTiming,
      },
    })`,
      )
    },
  }
}
