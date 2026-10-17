import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerSchema, type Provider } from '@brobot2/shared'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import {
  composeProfileBundle,
  MAY_NOT_SAVE_MEMORY,
  MAY_SAVE_MEMORY,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { requestTabs, type ReaderRow } from '../src/renderer/src/lib/request-order'
import { givenAnswer } from './dom/what-this-agent-was-given.fixture'

/**
 * Every launch says, under "What you may do", whether the conversation may save to its profile's
 * memory and saved methods: one with a profile may, and one this app cannot place under a profile,
 * which runs in another profile's home, may not.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'fictional-writer',
    cwd: '/tmp/work',
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    spawningEnabled: true,
    root: 'not-yet-numbered',
    others: { shown: [], more: 0 },
    ...over,
  }
}
const withAProfile = context()
const withNone = context({ profileSlug: null, capabilities: null })

/** The "What you may do" section of a launch's own text. */
function whatYouMayDo(launch: InstructionContext): string {
  const { text, spans } = thisConversationSpans(launch)
  const section = spans.find((one) => one.heading === 'What you may do')
  if (section === undefined) throw new Error('no "What you may do" section')
  return text.slice(section.start, section.end)
}

/** What the provider is handed for this conversation: Claude's system prompt, or the Codex lead. */
function handed(provider: Provider, launch: InstructionContext): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), `may-save-${provider}-`))
  folders.push(root)
  const home = join(root, 'home')
  const cwd = join(root, 'work')
  const userHome = join(root, 'user-home')
  for (const one of [home, cwd, userHome]) mkdirSync(one)
  const at = { ...launch, cwd }
  const bundle = publishProfileBundle(provider, home, composeProfileBundle(at))
  const read = readSessionInstructions({
    provider,
    cwd,
    providerHome: home,
    home: userHome,
    bundle,
    thisConversation: thisConversationSpans(at),
  })
  return (provider === 'claude' ? read.systemHint : read.firstTurnLead) ?? ''
}

describe('"What you may do" says whether this conversation may save memory', () => {
  it('with a profile: it may, in its own paragraph after the agent-tool lines', () => {
    const said = whatYouMayDo(withAProfile)
    expect(said).toContain(`\n\n${MAY_SAVE_MEMORY}`)
    expect(said).not.toContain(MAY_NOT_SAVE_MEMORY)
    expect(said.indexOf(MAY_SAVE_MEMORY)).toBeGreaterThan(said.indexOf('- You may'))
  })

  it('without one: it may not, after the sentence that says the profile is unknown', () => {
    const said = whatYouMayDo(withNone)
    expect(said).toContain(MAY_NOT_SAVE_MEMORY)
    expect(said).not.toContain(MAY_SAVE_MEMORY)
    expect(said.indexOf(MAY_NOT_SAVE_MEMORY)).toBeGreaterThan(
      said.indexOf("The app cannot identify this conversation's profile"),
    )
  })

  it('stays the last line when the app blocks creating agents', () => {
    for (const launch of [withAProfile, withNone]) {
      const said = whatYouMayDo({ ...launch, spawningEnabled: false }).trimEnd()
      expect(said.endsWith(launch === withNone ? MAY_NOT_SAVE_MEMORY : MAY_SAVE_MEMORY)).toBe(true)
      expect(said).toContain('This app currently blocks creating agents')
    }
  })

  for (const provider of providerSchema.options) {
    it(`${provider}: each line reaches the model where this conversation's text goes`, () => {
      expect(handed(provider, withAProfile)).toContain(MAY_SAVE_MEMORY)
      expect(handed(provider, withNone)).toContain(MAY_NOT_SAVE_MEMORY)
      expect(handed(provider, withNone)).not.toContain(MAY_SAVE_MEMORY)
    })
  }

  it('is never in the profile’s own file, which is shared by all its conversations', () => {
    expect(composeProfileBundle(withAProfile)).not.toContain(MAY_SAVE_MEMORY)
    expect(composeProfileBundle(withNone)).not.toContain(MAY_NOT_SAVE_MEMORY)
  })

  for (const [layout, launch, line] of [
    ['claude', withAProfile, MAY_SAVE_MEMORY],
    ['codex', withNone, MAY_NOT_SAVE_MEMORY],
  ] as const) {
    it(`the popup (${layout}) shows the line in the text this conversation was given`, () => {
      const text = thisConversationSpans(launch).text
      const base = givenAnswer()
      const given = givenAnswer({
        thisConversation: {
          text,
          textIs: 'as-launched',
          sections: [],
          size: { characters: text.length, words: 0, tokens: 0 },
        },
        ...(layout === 'codex'
          ? {
              placement: 'first-message' as const,
              providerParts: { ...base.providerParts, snapshot: null },
            }
          : {}),
      })
      const key = layout === 'claude' ? 'this-conversation' : 'conversation-lead'
      const row = requestTabs(given, [], true, () => 'today')
        .flatMap((tab) => tab.items)
        .find((item) => item.kind === 'row' && item.key === key) as ReaderRow | undefined
      expect(row).toBeDefined()
      expect(row!.pieces.some((piece) => piece.kind === 'text' && piece.text.includes(line))).toBe(
        true,
      )
    })
  }
})
