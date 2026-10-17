import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerSchema } from '@brobot2/shared'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import { theConversationCalled, theOwnerOf } from '../src/shared/piece-called'

/** The giver's own piece, which names it wherever a sentence names it (D-016 · commit 7). */
const THE_GIVERS_PIECE = { label: 'W1', title: 'Bakery website' } as const

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('PE-002 · a person can speak directly to any agent', () => {
  for (const provider of providerSchema.options) {
    it(`${provider}: the instructions cover every direct-person case`, () => {
      const root = mkdtempSync(join(tmpdir(), 'brobot-pe002-'))
      roots.push(root)
      const home = join(root, 'home')
      const cwd = join(root, 'work')
      mkdirSync(home)
      mkdirSync(cwd)
      const context: InstructionContext = {
        profileSlug: 'direct-person-test',
        cwd,
        startedBy: theConversationCalled('Gil', THE_GIVERS_PIECE),
        depth: 1,
        capabilities: DEFAULT_CAPABILITIES,
        spawningEnabled: true,
        // ⚑ D-016 · a conversation another one started owns no root.
        root: null,
        // ⚑ D-024 · R1 · no other conversation of the profile.
        others: { shown: [], more: 0 },
      }
      const bundle = publishProfileBundle(provider, home, composeProfileBundle(context))
      expect(bundle.ok).toBe(true)
      // ⚑ **D-024 · R1 — who started this conversation is not in the profile's file any more**: it
      // is this conversation's own text, composed apart as `main/index.ts` composes it, and sent
      // with this launch alone — last in Claude's system prompt, in front of Codex's first message.
      const read = readSessionInstructions({
        provider,
        cwd,
        providerHome: home,
        bundle,
        thisConversation: thisConversationSpans(context),
      })
      const file = readFileSync(bundle.path, 'utf8')
      const itsOwn = (provider === 'claude' ? read.systemHint : read.firstTurnLead) ?? ''
      const delivered =
        provider === 'claude' ? (read.instructions.composed ?? '') : `${file}\n${itsOwn}`

      // The person's word goes, whoever gave the work, and the giver is told.
      expect(delivered).toContain("Follow the person's scope and stops, and tell your giver.")
      const startedBy = `This conversation was started by ${theConversationCalled('Gil', THE_GIVERS_PIECE)}.`
      expect(delivered).toContain(startedBy)
      // 🔴 **D-024 · R1 — and it reaches the agent with its launch, never through the shared file**
      // a sibling's launch rewrites.
      expect(itsOwn).toContain(startedBy)
      expect(file).not.toContain('This conversation was started by')
    })
  }

  it('the incoming turn identifies the person without treating an agent as one', () => {
    expect(messageNamingItsSender('Please stop.', THE_PERSON_AT_A_WINDOW)).toContain(
      'You are answering a person.',
    )
    expect(
      messageNamingItsSender(
        'Please stop.',
        {
          who: 'a-caller-with-an-id',
          caller: 'sess_giver',
          profile: 'giver',
          aPersonIsBehindIt: false,
        },
        () => ({
          name: 'Gil',
          // ⚑ D-016 · these words give no piece; the giver's open piece reads by its label.
          handsYou: null,
          openWorkItGaveYou: ['W1.1'],
          gaveYouWorkThatIsClosed: false,
          // ⚑ D-016 · commit 7 · the giver of W1.1 owns W1, and is addressed by it.
          named: THE_GIVERS_PIECE,
          about: null,
        }),
      ),
    ).toContain(
      // ⚑ W4.187 · by its name alone: the sender line named it in full.
      `The words you write in this turn do not reach Gil, ${theOwnerOf(THE_GIVERS_PIECE)}.`,
    )
  })
})
