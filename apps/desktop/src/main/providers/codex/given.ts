import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CODEX_TOOLS_DESCRIPTION } from '@brobot2/runtime'
import { sizesAdded } from '../../../shared/what-this-agent-was-given'
import { repositoryConventionChain } from '../repository-instructions'
import type { GivenPolicy } from '../given-policy'

export function filesCodexWouldRead(cwd: string): string[] {
  return repositoryConventionChain(cwd).flatMap((dir) => {
    for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
      const path = join(dir, name)
      if (existsSync(path)) return [path]
    }
    return []
  })
}

const CODEX_PROJECT_DOC_BUDGET = 32 * 1024

/** ⚑ W4.177 — why, for a Codex file the model may have got only part of, or none of. */
const PAST_CODEX_BUDGET =
  'This app keeps this file by its fingerprint only, since BroCrew did not write it, and Codex reads at most 32 KiB of a folder’s AGENTS files in all, so the model may have got only part of this one, or none of it. The agent’s popup shows the file as it is now.'

export const given: GivenPolicy = {
  nativeFiles: filesCodexWouldRead,
  repositoryOrigin:
    'This folder’s own file, written by whoever works in it — a person or an agent; this app can’t tell which. Codex reads it itself.',
  deferral: () => ({
    kind: 'in-every-request',
    says: 'Codex hands the model every one of these, in full, in every request.',
  }),
  externalDeferral: () => ({
    kind: 'found-by-search',
    says: 'Codex finds these with its tool search: until then the model sees neither their names nor their descriptions.',
  }),
  otherServers: (_published, _server, granted) => ({
    size: sizesAdded([]),
    why:
      granted.length === 0
        ? null
        : 'Codex finds other servers’ tools with its tool search, so none of them is in every request.',
  }),
  namespaceText: (declaredWith, count) =>
    count === 0 ? null : (declaredWith ?? CODEX_TOOLS_DESCRIPTION),
  planningKey: 'collaboration-mode',
}

/** A budget attached to persisted native-read records, including records read across providers. */
export const recordedNativeRead = {
  mayBeCut: (bytes: number, truncated: boolean) => bytes > CODEX_PROJECT_DOC_BUDGET || truncated,
  why: PAST_CODEX_BUDGET,
}
