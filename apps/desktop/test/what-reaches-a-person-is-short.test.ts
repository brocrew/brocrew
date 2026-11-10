import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerSchema, type Provider } from '@brobot2/shared'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import {
  composeProfileBundle,
  NOT_IN_THE_FACTORY_TEXT,
  NO_TEXT_PROMISES_A_WATCHER,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { theConversationCalled } from '../src/shared/piece-called'

const CLAUSES = {
  recipient: 'Address the actual reader',
  person: 'Lead with the answer or needed decision',
  warmth: 'in warm, plain words',
  courtesyKeptBrief: 'Keep greetings and apologies brief',
  noFiller: 'End with the answer or needed question; no offers or filler',
  recapOnlyToHelp: 'Keep recaps useful',
  brief: 'Keep finished files on the piece so agents can find them',
} as const
const THE_PARENTS_PIECE = { label: 'W1', title: 'Bakery website' } as const
const STARTED_BY = theConversationCalled('Pat', THE_PARENTS_PIECE)
const OLD_RULE =
  'Give the whole answer. Never truncate it, and never guess at a limit you were not told.'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'reader-test',
    cwd: '/tmp/work',
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    spawningEnabled: true,
    root: (over.startedBy ?? null) === null ? 'not-yet-numbered' : null,
    others: { shown: [], more: 0 },
    ...over,
  }
}

function delivered(provider: Provider, input: InstructionContext): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot-684-text-'))
  roots.push(root)
  const home = join(root, 'home')
  const cwd = join(root, 'work')
  mkdirSync(home)
  mkdirSync(cwd)
  const launch: InstructionContext = { ...input, cwd }
  const bundle = publishProfileBundle(provider, home, composeProfileBundle(launch))
  expect(bundle.ok).toBe(true)
  const read = readSessionInstructions({
    provider,
    cwd,
    providerHome: home,
    bundle,
    thisConversation: thisConversationSpans(launch),
  })
  // Claude gets the app-side append; Codex reads its published file plus the first-turn lead.
  return provider === 'claude'
    ? (read.instructions.composed ?? '')
    : `${readFileSync(bundle.path, 'utf8')}\n${read.firstTurnLead ?? ''}`
}

function forbidden(text: string): string[] {
  return NOT_IN_THE_FACTORY_TEXT.filter((word) => text.toLowerCase().includes(word))
}

describe('what reaches a person is short, whatever the provider', () => {
  for (const provider of providerSchema.options) {
    it(`${provider}: person, agent and unknown-reader clauses reach the launch`, () => {
      for (const startedBy of [null, STARTED_BY]) {
        const text = delivered(provider, context({ startedBy, depth: startedBy === null ? 0 : 1 }))
        for (const [name, clause] of Object.entries(CLAUSES)) expect(text, name).toContain(clause)
        expect(text).not.toContain(OLD_RULE)
        expect(forbidden(text)).toEqual([])
        for (const [why, pattern] of Object.entries(NO_TEXT_PROMISES_A_WATCHER))
          expect(text, why).not.toMatch(pattern)
      }
    })
  }
})
