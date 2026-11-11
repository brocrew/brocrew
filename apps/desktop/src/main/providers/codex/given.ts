import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CODEX_TOOLS_DESCRIPTION, CODEX_TOOL_NAMING } from '@brobot2/runtime/codex'
import { qualifyWith } from '@brobot2/runtime'
import { sizesAdded } from '../../../shared/what-this-agent-was-given'
import { repositoryConventionChain } from '../repository-instructions'
import type { GivenPolicy } from '../given-policy'
import { launchSetting } from './launch-settings'

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

/** Why a Codex file the model may have got only part of, or none of, is not shown. */
const PAST_CODEX_BUDGET =
  'Codex reads at most 32 KiB of a folder’s AGENTS files in all, so the model may have got only part of this one, or none of it. The agent’s popup shows the file as its launch read it.'

export const given: GivenPolicy = {
  nativeFiles: filesCodexWouldRead,
  toolNames: (server, names, published, externalServers) => {
    const declarations = names.map((name) => qualifyWith(CODEX_TOOL_NAMING, server, name))
    return {
      declarations,
      namesOnlyText: declarations.join('\n'),
      // Older inventories used MCP names; preserve those recorded words beside dynamic declarations.
      published:
        published?.filter(
          (name) => name.startsWith(`${server}__`) || name.startsWith(`mcp__${server}__`),
        ) ?? null,
      external: externalServers.map((server) => ({
        name: server,
        tools:
          published === null
            ? null
            : published.flatMap((name) => {
                const prefix = `mcp__${server}__`
                return name.startsWith(prefix) ? [name.slice(prefix.length)] : []
              }),
      })),
    }
  },
  toolWasSent: (name, disabled) =>
    !disabled.some((one) => one === name || name === `functions.${one}`),
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
  launchSetting,
}

/** A budget attached to persisted native-read records, including records read across providers. */
export const recordedNativeRead = {
  matches: (kind: string) => kind === 'read-by-codex',
  mayBeCut: (bytes: number, truncated: boolean) => bytes > CODEX_PROJECT_DOC_BUDGET || truncated,
  why: PAST_CODEX_BUDGET,
}
