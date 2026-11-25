import type {
  InjectedInstruction,
  SessionInstructions,
} from '../../src/shared/instruction-contracts'
import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import { META, launchRecordProps, mount, unmountAll, visible } from './harness'

afterEach(unmountAll)

const FILLER = 'and the rest of the file, which nobody here has to read. '

function sized(text: string, bytes: number): string {
  const head = `${text}\n`
  const rest = bytes - new TextEncoder().encode(head).length
  if (rest < 0) throw new Error(`the fixture text is already past ${String(bytes)} bytes`)
  return head + FILLER.repeat(Math.ceil(rest / FILLER.length)).slice(0, rest)
}

/** The store as it really was, paths and byte counts included (§1). */
const INDEX: InjectedInstruction = {
  kind: 'agent-memory',
  path: '/homes/claude/memory/MEMORY.md',
  text: sized('- [Reviewer handle](user_reviewer_handle.md) — who reviews this work', 205),
  bytes: 205,
  truncated: false,
  reach: 'prompt',
}

const TOPICS: InjectedInstruction[] = [
  {
    kind: 'agent-memory-topic',
    path: '/homes/claude/memory/brobot-home-is-provider-home.md',
    text: sized("BroBot's home is the provider home.", 1691),
    bytes: 1691,
    truncated: false,
    reach: 'on-request',
  },
  {
    kind: 'agent-memory-topic',
    path: '/homes/claude/memory/user_reviewer_handle.md',
    text: sized('The reviewer goes by alex-acme.', 263),
    bytes: 263,
    truncated: false,
    reach: 'on-request',
  },
]

const STORE: SessionInstructions = {
  ...META.instructions,
  agentMemory: [INDEX, ...TOPICS],
  recallsReported: false,
  writesReported: false,
  composed: null,
}

async function openStore(instructions = STORE) {
  const reader = mount(AgentInputPopup, launchRecordProps(instructions), { width: 760 })
  const record = reader.q('input-launch-evidence') as HTMLDetailsElement
  record.open = true
  await nextTick()
  return reader
}

it('shows a separate row for each file, with its path and reach', async () => {
  const reader = await openStore()
  const rows = reader.all('input-launch-memory-file') as HTMLDetailsElement[]
  expect(rows).toHaveLength(3)
  for (const [index, file] of STORE.agentMemory.entries()) {
    const row = rows[index]!
    const summary = row.querySelector('summary')!
    expect(summary.textContent).toContain(file.path.split('/').at(-1))
    expect(summary.textContent).toContain(index === 0 ? 'In the prompt' : 'Available on request')
    const document = row.querySelector('[data-cy="document-body"]')!
    expect(visible(document)).toBe(false)
    summary.click()
    await nextTick()
    expect(row.open).toBe(true)
    expect(row.querySelector('.bb-mono')?.textContent).toBe(file.path)
    expect(visible(document)).toBe(true)
  }
  expect(rows[2]!.textContent).toContain('The reviewer goes by alex-acme.')
})

it('distinguishes the index, a filed memory and a requested note without naming the provider', async () => {
  const note: InjectedInstruction = {
    ...TOPICS[0]!,
    path: '/homes/claude/memory/notes/note.md',
    kind: 'agent-memory-note',
  }
  const reader = await openStore({ ...STORE, agentMemory: [INDEX, TOPICS[0]!, note] })
  const rows = reader.all('input-launch-memory-file')
  expect(rows).toHaveLength(3)
  const provenance = rows.map((row) => row.querySelector('.bb-muted')?.textContent)
  expect(provenance).toEqual([
    'Written by the agent, loaded by the provider',
    'A memory filed by the agent',
    'A note the agent was asked to write',
  ])
  expect(provenance.join(' ')).not.toMatch(/\bclaude\b|\bcodex\b/i)
})

it('shows just the index for an index-only store', async () => {
  const reader = await openStore({ ...STORE, agentMemory: [INDEX] })
  expect(reader.all('input-launch-memory-file')).toHaveLength(1)
  expect(reader.q('input-launch-memory-file').querySelector('summary')?.textContent).toContain(
    'MEMORY.md',
  )
  expect(reader.all('told-remembers-nothing')).toHaveLength(0)
})

it('states what the store proves and only points to recalls when reported', async () => {
  const reader = await openStore()
  expect(reader.q('memory-store-not-a-reading').textContent).toContain(
    'Stored files don’t show which ones the agent opened.',
  )
  expect(reader.all('memory-store-recall-is-shown')).toHaveLength(0)
  reader.unmount()

  const withRecalls = await openStore({ ...STORE, recallsReported: true })
  expect(withRecalls.q('memory-store-recall-is-shown').textContent).toContain(
    'Recalls appear in the conversation.',
  )
})

it('shows the index explanation separately from the list of files it points to', async () => {
  const reader = await openStore({
    ...STORE,
    note: 'MEMORY.md is an index the provider puts in front of the model.',
  })
  const note = reader.q('instructions-note')
  expect(visible(note)).toBe(true)
  expect(note.textContent).toContain('is an index the provider puts in front of the model')
  expect(note.textContent).not.toContain('user_reviewer_handle.md')
  expect(reader.all('input-launch-memory-file')).toHaveLength(3)
})
