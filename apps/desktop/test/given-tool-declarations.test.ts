import { describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { AgentToolset } from '@brobot2/runtime'
import { given as claude } from '../src/main/providers/claude/given'
import { given as codex } from '../src/main/providers/codex/given'
import {
  whatItWasGiven,
  toolsetFingerprint,
  type WhatTheReadIsHanded,
} from '../src/main/runtime/what-this-agent-was-given'
import { requestTabs, TRUST, type ReaderRow } from '../src/renderer/src/lib/request-order'
import { sizeOf, type WhatThisAgentWasGiven } from '../src/shared/what-this-agent-was-given'
import type { SnapshotPart } from '../src/shared/provider-snapshots'
import { givenAnswer } from './dom/what-this-agent-was-given.fixture'

const toolset: AgentToolset = {
  server: 'bakery',
  tools: ['knead', 'bake__bread'].map((name) => ({
    name,
    description: name,
    input: {},
    beyondItsRails: 'nothing-its-rails-do-not-cover' as const,
    call: async () => ({ text: 'done' }),
  })),
}

function read(provider: Provider, published: readonly string[] | null): WhatTheReadIsHanded {
  const template = givenAnswer()
  const text = 'Before ⟨BroBot’s part: the names of BroBot’s tools⟩ After'
  const names: SnapshotPart = {
    id: 'names',
    title: 'Names',
    where: 'context-message',
    when: 'every-request',
    text,
    chars: text.length,
    words: 0,
    approxTokens: 0,
  }
  return {
    provider,
    sessionId: 'session',
    profileId: null,
    launch: { recorded: true, at: 10, build: null, thisBuild: false, running: false },
    record: {
      build: null,
      placement: provider === 'claude' ? 'system-prompt' : 'first-message',
      profileFile: null,
      ownInstructionsVersion: null,
      thisConversation: null,
      files: [],
      memory: [],
      tools: { server: 'bakery', count: 2, sha256: toolsetFingerprint(toolset) },
    },
    own: null,
    toolset,
    published,
    publishedAt: published === null ? null : 11,
    listedCommands: null,
    declaredWith: null,
    externalServers: ['mail', 'empty'],
    memory: { stores: [], readAt: 12 },
    providerVersion: null,
    snapshot: {
      model: null,
      answer: {
        found: true,
        snapshot: {
          ...template.providerParts.snapshot!,
          provider,
          shape: 'messages',
          parts: [names],
        },
      },
    },
    context: null,
    now: 12,
    standsNow: { approval: null, planning: null },
  }
}

function rows(given: WhatThisAgentWasGiven): ReaderRow[] {
  return requestTabs(given, [], true, () => 'today').flatMap((tab) =>
    tab.items.filter((item): item is ReaderRow => item.kind === 'row'),
  )
}

function namesRow(given: WhatThisAgentWasGiven): ReaderRow {
  return rows(given).find((row) => row.key === 'part:names')!
}

describe('provider declarations through the read model and request order', () => {
  it.each([
    ['claude', ['mcp__bakery__knead', 'mcp__bakery__bake__bread']],
    ['codex', ['bakery__knead', 'bakery__bake__bread']],
  ] as const)('uses actual %s declaration names without a published list', (provider, expected) => {
    const given = whatItWasGiven(read(provider, null))
    expect(given.tools.declarationNames).toEqual(expected)
    expect(given.tools.list.map((tool) => tool.name)).toEqual(['knead', 'bake__bread'])
    expect(given.tools.listedByTheProvider).toBeNull()
    expect(given.externalServers.map((server) => server.tools)).toEqual([null, null])
    const row = namesRow(given)
    expect(row.pieces).toContainEqual({ kind: 'text', text: expected.join('\n') })
    expect(row.pieces).toContainEqual({ kind: 'label', author: 'BroCrew', trust: TRUST.thisBuild })
    expect(row.pieces.at(0)).toEqual({ kind: 'text', text: 'Before ' })
    expect(row.pieces.at(-1)).toEqual({ kind: 'text', text: ' After' })
    expect(given.size.toolsInEveryRequest).toEqual(given.size.tools)
  })

  it('keeps recorded Codex MCP names verbatim ahead of current dynamic declarations', () => {
    const published = [
      'mcp__bakery__bake__bread',
      'bakery__knead',
      'mcp__mail__find__letter',
      'bakery_extra__other',
      'mcp__bakery_extra__other',
      'unrecognized-native-name',
    ]
    const input = read('codex', published)
    const given = whatItWasGiven(input)
    expect(given.tools.listedByTheProvider).toEqual({
      at: 11,
      names: ['mcp__bakery__bake__bread', 'bakery__knead'],
    })
    expect(given.externalServers.map(({ name, tools }) => ({ name, tools }))).toEqual([
      { name: 'mail', tools: ['find__letter'] },
      { name: 'empty', tools: [] },
    ])
    expect(namesRow(given).pieces).toContainEqual({
      kind: 'text',
      text: 'mcp__bakery__bake__bread\nbakery__knead',
    })
    expect(namesRow(given).pieces).toContainEqual({
      kind: 'label',
      author: 'BroCrew',
      trust: TRUST.withMessage,
    })
    expect(input.published).toBe(published)
    expect(published.at(-1)).toBe('unrecognized-native-name')
  })

  it('counts Claude deferred names from the current declaration text, preserving published order', () => {
    const given = whatItWasGiven(
      read('claude', ['ToolSearch', 'mcp__bakery__bake__bread', 'mcp__mail__find__letter']),
    )
    expect(given.tools.deferral.kind).toBe('names-until-loaded')
    expect(given.tools.listedByTheProvider?.names).toEqual(['mcp__bakery__bake__bread'])
    expect(given.size.toolsInEveryRequest).toEqual(
      sizeOf('mcp__bakery__knead\nmcp__bakery__bake__bread'),
    )
    expect(given.size.otherServersToolsInEveryRequest).toEqual(sizeOf('mcp__mail__find__letter'))
    expect(given.size.toolsInEveryRequest).not.toEqual(given.size.tools)
  })

  it('renders stored names with explicit absence when an old payload has no declaration facts', () => {
    const given = whatItWasGiven(read('claude', null))
    const oldTools = { ...given.tools }
    delete oldTools.declarationNames
    const row = namesRow({ ...given, tools: oldTools })
    expect(row.pieces).toContainEqual({ kind: 'text', text: 'knead\nbake__bread' })
    expect(row.pieces).toContainEqual({
      kind: 'label',
      author: 'BroCrew',
      trust: TRUST.notRecorded,
    })
    expect(row.pieces).toContainEqual({
      kind: 'join',
      text: 'Provider declaration names were not recorded; these are the stored tool names.',
    })
  })

  it('renders supplied fictional declaration words without interpreting their spelling', () => {
    const given = whatItWasGiven(read('claude', null))
    const supplied = {
      ...given,
      tools: { ...given.tools, declarationNames: ['fern: knead 🪴', 'leaf / bake'] },
    }
    expect(namesRow(supplied).pieces).toContainEqual({
      kind: 'text',
      text: 'fern: knead 🪴\nleaf / bake',
    })
  })

  it.each(['claude', 'codex'] as const)(
    'projects %s disabled declarations before request rendering',
    (provider) => {
      const input = read(provider, null)
      const text = 'functions.exec declaration\nRead declaration'
      const part: SnapshotPart = {
        id: 'native-tools',
        title: 'Native tools',
        where: 'tools',
        when: 'every-request',
        text,
        chars: text.length,
        words: 4,
        approxTokens: 10,
        tools: [
          { name: 'functions.exec', text: 'functions.exec declaration', chars: 26 },
          { name: 'Read', text: 'Read declaration', chars: 16 },
        ],
      }
      const projected = {
        ...input,
        record: { ...input.record, settings: [{ key: 'tools-off' as const, value: ['exec'] }] },
        snapshot: {
          model: null,
          answer: {
            found: true as const,
            snapshot: {
              ...givenAnswer().providerParts.snapshot!,
              provider,
              shape: 'messages' as const,
              parts: [part],
            },
          },
        },
      }
      const given = whatItWasGiven(projected)
      expect(given.tools.notSentDeclarations).toEqual(['functions.exec'])
      const pieces = rows(given).flatMap((row) => row.pieces)
      expect(
        pieces.some(
          (piece) =>
            piece.kind === 'tools' && piece.tools.some((tool) => tool.name === 'functions.exec'),
        ),
      ).toBe(false)
      expect(
        pieces.some(
          (piece) => piece.kind === 'tools' && piece.tools.some((tool) => tool.name === 'Read'),
        ),
      ).toBe(true)
    },
  )

  it.each(['request_user_input', 'functions.request_user_input'])(
    'projects the recorded Codex alias %s without disabling its async neighbor',
    (disabled) => {
      const input = read('codex', null)
      const names = [
        'functions.exec',
        'functions.request_user_input',
        'functions.request_user_input_async',
      ]
      const tools = names.map((name) => {
        const text = JSON.stringify({ name, description: `Use ${name} for this task.` })
        return { name, text, chars: text.length }
      })
      const snapshot = {
        ...givenAnswer().providerParts.snapshot!,
        provider: 'codex' as const,
        shape: 'functions' as const,
        parts: [
          {
            id: 'codex.tools',
            title: 'Provider tools',
            where: 'tools' as const,
            when: 'every-request' as const,
            text: tools.map((tool) => tool.text).join('\n'),
            chars: tools.reduce((sum, tool) => sum + tool.chars, 0),
            words: 12,
            approxTokens: 40,
            tools,
          },
        ],
      }
      const projected: WhatTheReadIsHanded = {
        ...input,
        record: { ...input.record, settings: [{ key: 'tools-off', value: [disabled] }] },
        snapshot: { model: null, answer: { found: true, snapshot } },
      }
      const given = whatItWasGiven(projected)
      expect(given.tools.notSentDeclarations).toEqual(['functions.request_user_input'])
      expect(
        rows(given)
          .filter((row) => row.key.startsWith('tool:'))
          .map((row) => row.key),
      ).toEqual(['tool:functions.exec', 'tool:functions.request_user_input_async'])
      expect(projected.record.settings).toEqual([{ key: 'tools-off', value: [disabled] }])
      expect(snapshot.parts[0]!.tools.map((tool) => tool.name)).toEqual(names)
      const oldTools = { ...given.tools }
      delete oldTools.notSentDeclarations
      const old = { ...given, tools: oldTools }
      expect(
        rows(old)
          .filter((row) => row.key.startsWith('tool:'))
          .map((row) => row.key),
      ).toEqual(
        disabled === 'functions.request_user_input'
          ? ['tool:functions.exec', 'tool:functions.request_user_input_async']
          : names.map((name) => `tool:${name}`),
      )
      const unrecorded = whatItWasGiven({
        ...projected,
        launch: { recorded: false, why: 'not-kept', running: false },
      })
      expect(unrecorded.tools.notSentDeclarations).toBeUndefined()
      expect(
        rows(unrecorded)
          .filter((row) => row.key.startsWith('tool:'))
          .map((row) => row.key),
      ).toEqual(names.map((name) => `tool:${name}`))
    },
  )

  it('keeps absence distinct from an empty published inventory in both native policies', () => {
    for (const policy of [claude, codex]) {
      expect(policy.toolNames('bakery', [], null, ['mail']).external[0]?.tools).toBeNull()
      expect(policy.toolNames('bakery', [], [], ['mail']).external[0]?.tools).toEqual([])
    }
  })
})
