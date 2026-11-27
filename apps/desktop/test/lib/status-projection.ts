import { CONVERSATION_WAITS } from '../../src/shared/tasks'
import { BEINGS, DOINGS, NEEDINGS, type AgentFacets } from '../../src/renderer/src/lib/agent-state'

export function everyFacetState(): AgentFacets[] {
  const doings = [undefined, ...DOINGS] as const
  const beings = [undefined, ...BEINGS] as const
  const needings = [undefined, ...NEEDINGS] as const
  const waits = [undefined, ...CONVERSATION_WAITS] as const
  const out: AgentFacets[] = []
  for (const doing of doings)
    for (const being of beings)
      for (const needing of needings)
        for (const detached of [false, true])
          for (const scheduled of [false, true])
            for (const waiting of waits)
              out.push({
                ...(doing ? { doing } : {}),
                ...(being ? { being } : {}),
                ...(needing ? { needing } : {}),
                ...(detached ? { detached } : {}),
                ...(scheduled ? { scheduled } : {}),
                ...(waiting ? { waiting } : {}),
              })
  return out
}
