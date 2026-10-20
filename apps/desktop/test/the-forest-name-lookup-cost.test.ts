import { describe, expect, it } from 'vitest'
import { computed, reactive } from 'vue'
import { forestView, type ForestViewInput } from '../src/renderer/src/lib/the-forest'
import { agentName, type AgentIdentityName } from '../src/shared/runtime-ipc'
import type { ForestConversation, ForestNode, TheWholeForest } from '../src/shared/the-whole-forest'

function conversation(identity: string, index: number): ForestConversation {
  return {
    node: 'a-conversation',
    conversation: `sess_${index}`,
    identity,
    under: { is: 'the-person' },
    provider: 'codex',
    status: 'idle',
    running: 'not-running',
    standsInFor: [],
    inItsPlace: null,
    startedAt: 1,
    updatedAt: 2,
  }
}

function input(
  rows: ForestNode[],
  identities: readonly AgentIdentityName[] | null,
): ForestViewInput {
  const count = rows.filter((row) => row.node === 'a-conversation').length
  const forest: TheWholeForest = {
    readAt: 2,
    conversations: count,
    heldByNoAgent: 0,
    nodes: { rows, walk: 'every-conversation-this-app-placed', ledgers: count, rowsUnread: 0 },
  }
  return { forest, identities, atWork: null, waits: null, held: new Set() }
}

describe('the forest name lookup cost', () => {
  it('bounds roster reads per push with 120 agents and work naming both ends', () => {
    const count = 120
    let slugReads = 0
    const identities = reactive(
      Array.from({ length: count }, (_, i): AgentIdentityName => ({
        id: `aid:worker-${i}`,
        get slug() {
          slugReads++
          return `worker-${i}`
        },
        displayName: `Rowan ${i}`,
      })),
    )
    const rows: ForestNode[] = []
    for (let i = 0; i < count; i++) {
      const one = conversation(`Worker-${i}`, i)
      rows.push(one, {
        node: 'a-task',
        under: { is: 'a-conversation', conversation: one.conversation },
        givenBy: { is: 'a-conversation', conversation: one.conversation },
        work: {
          piece: `work_${i}`,
          label: `W1.${i + 1}`,
          title: 'Check a sample',
          from: one.conversation,
          fromIdentity: one.identity,
          to: one.conversation,
          toIdentity: one.identity,
          state: 'working',
          givenAt: 1,
          endedAt: null,
        },
      })
    }
    // The previous fold called agentName for each conversation, recipient and giver.
    const beforeNames = rows.flatMap((row) =>
      row.node === 'a-conversation'
        ? [agentName(row.identity, identities)]
        : [
            agentName(row.work.toIdentity, identities),
            agentName(row.work.fromIdentity, identities),
          ],
    )
    const before = slugReads
    expect(before).toBe(21_780)
    const reading = input(rows, identities)
    const perPush: number[] = []
    for (let push = 0; push < 8; push++) {
      slugReads = 0
      const view = forestView({ ...reading, said: new Map() })!
      perPush.push(slugReads)
      const afterNames = view.rows.flatMap((row) =>
        row.taskRow === null ? [row.name] : [row.name, row.taskRow.givenByName],
      )
      expect(afterNames).toEqual(beforeNames)
      expect(slugReads).toBeLessThanOrEqual(count * 2)
    }
    console.info(
      `120 agents / 120 tasks: roster slug reads per push before=${before}, after=${perPush.join(',')}`,
    )
  })

  it('keeps canonical names and fallbacks, and tracks an in-place rename', () => {
    const identities = reactive([
      { id: 'aid:worker', slug: 'worker', displayName: 'Mira' as string | null },
      { id: 'aid:unnamed', slug: 'unnamed', displayName: null },
      { id: 'aid:default', slug: 'default', displayName: 'Orin' },
    ])
    const keys = ['Worker', 'Unnamed', 'Missing', 'default']
    const rows = keys.map(conversation)
    const folded = computed(() => forestView(input(rows, identities))!)
    expect(folded.value.rows.map((row) => row.name)).toEqual(
      keys.map((key) => agentName(key, identities)),
    )
    identities[0]!.displayName = 'Lina'
    expect(folded.value.rows[0]!.name).toBe('Lina')
    identities[0]!.displayName = null
    expect(folded.value.rows[0]!.name).toBe('worker')
    expect(forestView(input(rows, null))!.rows.map((row) => row.name)).toEqual(
      keys.map((key) => agentName(key, null)),
    )
    expect(forestView({ ...input(rows, identities), forest: null })).toBeNull()
  })
})
