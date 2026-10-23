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
  for await (const project of scanChildren(join(home, 'projects'))) {
    if (!(await plainDirectory(project))) continue
    for await (const file of scanChildren(project)) {
      if (!considered(file)) continue
      const match = /^([a-zA-Z0-9_-]{1,200})\.jsonl$/.exec(basename(file))
      yield {
        path: file,
        candidate: match ? await add(file, match[1]!, join(project, match[1]!)) : null,
      }
    }
  }
}
