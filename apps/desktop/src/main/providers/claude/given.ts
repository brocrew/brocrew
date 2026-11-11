import { CLAUDE_LAUNCH_SETTING_KEYS } from '@brobot2/runtime/claude'
import {
  sizesAdded,
  sizeOf,
  type GivenDeferral,
  type PartSize,
} from '../../../shared/what-this-agent-was-given'
import type { GivenPolicy } from '../given-policy'
import { launchSetting } from './launch-settings'
import { CLAUDE_TOOL_NAMING } from '@brobot2/runtime/claude'
import { qualifyWith } from '@brobot2/runtime'

function toolNames(
  server: string,
  names: readonly string[],
  published: readonly string[] | null,
  externalServers: readonly string[],
): ReturnType<GivenPolicy['toolNames']> {
  const declarations = names.map((name) => qualifyWith(CLAUDE_TOOL_NAMING, server, name))
  return {
    declarations,
    namesOnlyText: declarations.join('\n'),
    published: published?.filter((name) => name.startsWith(`mcp__${server}__`)) ?? null,
    external: externalServers.map((name) => {
      const prefix = `mcp__${name}__`
      return {
        name,
        tools:
          published
            ?.filter((tool) => tool.startsWith(prefix))
            .map((tool) => tool.slice(prefix.length)) ?? null,
      }
    }),
  }
}

function deferral(published: readonly string[] | null): GivenDeferral {
  if (published === null) {
    return {
      kind: 'unknown',
      says: 'Claude has not reported its tool list for this conversation yet, so this app can’t tell how it hands these over.',
    }
  }
  return published.includes('ToolSearch')
    ? {
        kind: 'names-until-loaded',
        says: 'Claude puts only their names in front of the model, and the whole description when the agent loads one with its tool search.',
      }
    : {
        kind: 'in-every-request',
        says: 'Claude hands the model every one of these, in full, in every request.',
      }
}
function otherServers(
  published: readonly string[] | null,
  brobotsServer: string,
  granted: readonly string[],
): { readonly size: PartSize | null; readonly why: string | null } {
  const nothing = sizesAdded([])
  const how = deferral(published)
  if (published === null) {
    return granted.length === 0
      ? { size: nothing, why: null }
      : {
          size: null,
          why: 'Claude has not reported its tool list for this conversation yet, so this app can’t tell which other servers’ tools it sends.',
        }
  }
  const ours = `mcp__${brobotsServer}__`
  const names = published.filter((one) => one.startsWith('mcp__') && !one.startsWith(ours))
  if (names.length === 0) return { size: nothing, why: null }
  return how.kind === 'names-until-loaded'
    ? { size: sizeOf(names.join('\n')), why: null }
    : {
        size: null,
        why: 'Claude hands other servers’ tools over in full, and this app keeps none of their descriptions, so it can’t count them.',
      }
}

export const given: GivenPolicy = {
  launchSettingKeys: () => CLAUDE_LAUNCH_SETTING_KEYS,
  nativeFiles: () => [],
  toolNames,
  toolWasSent: (name, disabled) =>
    !disabled.some((one) => one === name || name === `functions.${one}`),
  repositoryOrigin:
    'This folder’s own file, written by whoever works in it — a person or an agent; this app can’t tell which. BroCrew reads it and sends it as it is.',
  deferral,
  externalDeferral: deferral,
  otherServers,
  namespaceText: () => null,
  planningKey: 'mode',
  launchSetting,
}

/** The spelling of an older profile-memory record stays the same for every reader. */
export const recordedProfileMemory = {
  title: 'This profile’s own CLAUDE.md',
  says: 'This profile’s own CLAUDE.md, written by a person or by the agent; this app can’t tell which. BroCrew sends it as it is.',
}
