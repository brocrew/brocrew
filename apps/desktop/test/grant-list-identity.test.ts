import { expect, it } from 'vitest'
import { codexToolGrant } from '../../../packages/runtime/src/codex/external-mcp'
import { McpCallsInFlight } from '../../../packages/runtime/src/codex/external-mcp'
import { wordsForACard } from '../../../packages/runtime/src/words-on-a-card'
import type { PermissionGrants } from '../../../packages/runtime/src/permission'
import type { RuntimeEvent } from '@brobot2/runtime'
import { transcriptEventForDisplay } from '../src/main/providers/error-presentation'
import { toWireEvent } from '../src/main/runtime/event-wire'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { keptInThisConversation, notKeptHere } from '../src/renderer/src/lib/standing-grants'

type Card = Extract<RuntimeEvent, { type: 'permission_request' }>
const card = (grants: PermissionGrants): Card => ({
  type: 'permission_request',
  id: 'request',
  kind: 'command',
  action: 'locate',
  detail: '{}',
  scope: {
    paths: [],
    networkHosts: [],
    amendments: [],
    persistence: 'always',
    availableDecisions: ['allow_always', 'deny'],
    underDisclosed: false,
    grants,
  },
})
const kept = (request: Card) => {
  const state = createTranscript()
  applyEvent(state, request)
  applyEvent(state, {
    type: 'user_decision',
    requestId: request.id,
    outcome: 'allow_always',
    by: { who: 'a-person' },
  })
  return keptInThisConversation(state.items)
}

it('matches the actual Codex grant producer and blanket list for maps + locate', () => {
  const rule = codexToolGrant('maps', 'locate')
  const calls = new McpCallsInFlight()
  calls.grant('maps', 'locate')
  calls.grant('weather', 'locate')
  calls.grant('maps', 'locate')
  expect(calls.grants).toEqual(['mcp__maps__locate', 'mcp__weather__locate'])
  const request = toWireEvent('codex', card({ allow_always: [rule] })) as Card
  expect(rule.listedAs).toBe('mcp__maps__locate')
  expect(request.scope.grants?.allow_always).toEqual([rule])
  const reading = kept(request)
  expect(reading[0]?.listedAs).toEqual(['mcp__maps__locate'])
  expect(notKeptHere(calls.grants, reading)).toEqual(['mcp__weather__locate'])
  expect(notKeptHere(['maps__locate'], reading)).toEqual(['maps__locate'])
})

it('retains distinct native identities when approval labels clean to the same displayed rule', () => {
  const state = createTranscript()
  const calls = new McpCallsInFlight()
  for (const [index, rawTool] of ['locate  x', 'locate x', 'locate  x'].entries()) {
    calls.grant('maps', rawTool)
    const rule = { ...codexToolGrant('maps', rawTool), tool: wordsForACard(rawTool)! }
    const request = toWireEvent('codex', {
      ...card({ allow_always: [rule] }),
      id: `request-${index}`,
    }) as Card
    applyEvent(state, request)
    applyEvent(state, {
      type: 'user_decision',
      requestId: request.id,
      outcome: 'allow_always',
      by: { who: 'a-person' },
    })
  }
  const reading = keptInThisConversation(state.items)
  expect(reading).toHaveLength(1)
  expect(reading[0]?.listedAs).toEqual(['mcp__maps__locate  x', 'mcp__maps__locate x'])
  expect(notKeptHere(calls.grants, reading)).toEqual([])
})

it('reads a fictional supplied identity without deriving it from the rule or inventory', () => {
  const request = toWireEvent(
    'fictional',
    card({
      allow_always: [
        { kind: 'tool', server: 'maps', tool: 'locate', listedAs: 'fern:other/route' },
      ],
    }),
  ) as Card
  const reading = kept(request)
  expect(reading[0]?.listedAs).toEqual(['fern:other/route'])
  expect(notKeptHere(['mcp__maps__locate', 'fern:other/route'], reading)).toEqual([
    'mcp__maps__locate',
  ])
})

it('keeps lossy old server identities unknown through known-provider live and history reads', () => {
  const rawTool = 'locate  x'
  const savedTool = wordsForACard(rawTool)!
  expect(savedTool).toBe('locate x')
  const old = card({
    allow_all_for_session: [{ kind: 'tool', server: 'maps', tool: savedTool }],
    allow_always: [{ kind: 'tool', server: 'maps', tool: savedTool }],
    alwaysFile: '/fictional/provider/kept-rules.json',
  })
  const saved = JSON.stringify(old)
  const live = transcriptEventForDisplay(old, 'codex') as Card
  const replay = transcriptEventForDisplay(JSON.parse(saved) as Card, 'codex') as Card
  expect(live).toEqual(old)
  expect(replay).toEqual(old)
  expect(JSON.stringify(old)).toBe(saved)
  const calls = new McpCallsInFlight()
  calls.grant('maps', rawTool)
  calls.grant('maps', savedTool)
  for (const request of [live, replay]) {
    const reading = kept(request)
    expect(reading[0]?.listedAs).toEqual([])
    expect(notKeptHere(calls.grants, reading)).toEqual(calls.grants)
  }
})

it('leaves genuinely unknown owner data unknown and retains a literal whole-tool identity', () => {
  const old = card({ allow_always: [{ kind: 'tool', server: 'maps', tool: 'locate' }] })
  expect(transcriptEventForDisplay(old)).toBe(old)
  expect(kept(old)[0]?.listedAs).toEqual([])
  expect(notKeptHere(['mcp__maps__locate'], kept(old))).toEqual(['mcp__maps__locate'])
  const bare = card({ allow_always: [{ kind: 'tool', tool: 'old:literal/name' }] })
  expect(kept(bare)[0]?.listedAs).toEqual(['old:literal/name'])
  expect(notKeptHere(['old:literal/name'], kept(bare))).toEqual([])
})

it('preserves supplied identities, scoped rules and ordering through live and history reads', () => {
  const rules: NonNullable<PermissionGrants['allow_always']> = [
    { kind: 'tool', server: 'maps', tool: 'locate', listedAs: 'fictional/list-key' },
    { kind: 'tool', server: 'maps', tool: 'locate', content: 'restricted' },
    { kind: 'command-prefix', prefix: ['echo', 'hello'] },
    {
      kind: 'tool',
      server: 'weather',
      tool: 'locate__tail',
      listedAs: 'fern:weather/locate__tail',
    },
  ]
  const old = card({ allow_always: rules })
  const projected = transcriptEventForDisplay(old, 'codex') as Card
  expect(projected.scope.grants?.allow_always).toEqual(rules)
  expect(transcriptEventForDisplay(JSON.parse(JSON.stringify(old)) as Card, 'codex')).toEqual(old)
  expect(kept(projected)[0]?.listedAs).toEqual(['fictional/list-key', 'fern:weather/locate__tail'])
  expect(old.scope.grants?.allow_always).toEqual(rules)
})

it('does not manufacture comparison facts for incomplete historical server rules', () => {
  const old = card({
    allow_always: [
      { kind: 'tool', server: '', tool: 'locate' },
      { kind: 'tool', server: 'maps', tool: '' },
    ],
  })
  const projected = transcriptEventForDisplay(old, 'codex') as Card
  expect(projected.scope.grants).toEqual(old.scope.grants)
  expect(kept(projected)[0]?.listedAs).toEqual([])
})
