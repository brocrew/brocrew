import { describe, expect, it } from 'vitest'
import { givenAnswer } from './dom/what-this-agent-was-given.fixture'
import type { SnapshotPart } from '../src/shared/provider-snapshots'
import { requestTabs, type ReaderRow } from '../src/renderer/src/lib/request-order'

function part(id: string, where: SnapshotPart['where'], text: string): SnapshotPart {
  return {
    id,
    title: id,
    where,
    when: 'every-request',
    text,
    chars: text.length,
    words: 0,
    approxTokens: 0,
  }
}

function tabs(shape: 'messages' | 'exec', parts: SnapshotPart[]) {
  const given = givenAnswer()
  const snapshot = { ...given.providerParts.snapshot!, shape, parts }
  return requestTabs(
    {
      ...given,
      placement: shape === 'messages' ? 'system-prompt' : 'first-message',
      providerParts: { ...given.providerParts, snapshot },
    },
    [],
    true,
    () => 'today',
  )
}

function row(items: ReturnType<typeof requestTabs>[number]['items'], key: string): ReaderRow {
  const found = items.find((item) => item.kind === 'row' && item.key === key)
  expect(found?.kind).toBe('row')
  return found as ReaderRow
}

for (const brand of ['BroBot', 'BroCrew']) {
  describe(`a stored copy with ${brand} markers`, () => {
    it('keeps the provider text on both sides of the system join', () => {
      const text = `BroBot is an agent.\n⟨${brand}’s text joins the system prompt here⟩\nProvider ending.`
      const items = tabs('messages', [part('prompt', 'system-prompt', text)])[0]!.items
      expect(row(items, 'part:prompt').pieces).toContainEqual({
        kind: 'text',
        text: 'BroBot is an agent.\n',
      })
      expect(row(items, 'part:prompt:after').pieces).toContainEqual({
        kind: 'text',
        text: '\nProvider ending.',
      })
      expect(items.findIndex((item) => item.kind === 'join')).toBeGreaterThan(0)
      expect(items.findIndex((item) => item.key === 'part:prompt:after')).toBe(items.length - 1)
    })

    it('inserts the tools paragraph and deferred names in their context rows', () => {
      const paragraph = `Before ⟨${brand}’s part: its paragraph about its tools⟩ After`
      const names = `Names ⟨${brand}’s part: the names of ${brand}’s tools⟩ End`
      const items = tabs('messages', [
        part('paragraph', 'context-message', paragraph),
        part('names', 'context-message', names),
      ])[2]!.items
      const own = givenAnswer()
      expect(row(items, 'part:paragraph').pieces).toContainEqual({
        kind: 'text',
        text: own.tools.instructions.text,
      })
      expect(row(items, 'part:names').pieces).toContainEqual({
        kind: 'text',
        text: 'mcp__brobot__give_work',
      })
      expect(items.some((item) => item.key === 'tools-paragraph')).toBe(false)
      expect(row(items, 'part:paragraph').pieces.at(-1)).toEqual({ kind: 'text', text: ' After' })
    })

    it('inserts tools inside exec and preserves the original declaration', () => {
      const text = JSON.stringify({
        description: `Before ⟨${brand}’s part: its tools, declared here as code⟩ After`,
      })
      const tools = {
        ...part('tools', 'tools', text),
        tools: [{ name: 'exec', text, chars: text.length }],
      }
      const items = tabs('exec', [tools])[0]!.items
      const exec = row(items, 'tool:exec')
      expect(exec.author).toBe('Provider + BroCrew')
      expect(exec.pieces.filter((piece) => piece.kind === 'brobot-tools')).toHaveLength(1)
      expect(exec.pieces).toContainEqual({ kind: 'text', text: ' After' })
      expect(exec.pieces).toContainEqual({
        kind: 'whole',
        title: 'Original stored declaration',
        text,
      })
    })

    it('keeps both instruction files between their original wrappers', () => {
      const text = `Opening ⟨${brand}’s part: the AGENTS file it writes for this profile⟩ Between ⟨${brand}’s part: the workspace’s AGENTS.md⟩ Closing`
      const items = tabs('exec', [part('files', 'user-message', text)])[2]!.items
      const keys = items.map((item) => item.key)
      const profile = givenAnswer().files[0]!
      expect(keys.indexOf(`file:${profile.path}`)).toBeGreaterThan(
        keys.indexOf('part:files:opening'),
      )
      expect(keys.indexOf(`file:${profile.path}`)).toBeLessThan(keys.indexOf('part:files:between'))
      expect(row(items, 'part:files:closing').pieces).toEqual([{ kind: 'text', text: ' Closing' }])
      expect(keys.at(-1)).toBe('part:files:closing')
    })
  })
}
