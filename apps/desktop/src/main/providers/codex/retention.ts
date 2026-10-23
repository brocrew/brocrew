import { basename, join } from 'node:path'
import type { RetentionScan } from '../transcript-policy'
import type { TranscriptToClear } from '../../transcript-retention-types'
export async function* scanRetention({
  home,
  scanChildren,
  plainDirectory,
  considered,
  add,
}: RetentionScan): AsyncGenerator<{ path: string; candidate: TranscriptToClear | null }> {
  const walk = async function* (
    path: string,
    depth = 0,
  ): AsyncGenerator<{ path: string; candidate: TranscriptToClear | null }> {
    if (depth > 8) return
    for await (const file of scanChildren(path)) {
      const match =
        /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
          basename(file),
        )
      if (considered(file))
        yield { path: file, candidate: match ? await add(file, match[1]!, null) : null }
      if (!match && (await plainDirectory(file))) yield* walk(file, depth + 1)
    }
  }
  yield* walk(join(home, 'sessions'))
}
