import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentPreamble } from '../src/main/runtime/agent-preamble'
import { BUNDLE_MARKER, profileBundleSpans } from '../src/main/runtime/factory-text'
import {
  composeSystemHint,
  INSTRUCTION_TOTAL_CAP,
  readSessionInstructions,
} from '../src/main/runtime/instructions'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import {
  oneMessageAsTheModelGotIt,
  whatThisLaunchGave,
} from '../src/main/runtime/what-this-agent-was-given'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { PRODUCT_NAME } from '../src/shared/product-name'

const tail =
  "Below are your instructions, your workspace notes and this conversation's details. Follow them; they take precedence over earlier general guidance."
const identities = [
  {
    identity: { profileSlug: 'writer', displayName: 'Lena' },
    who: 'You are Lena (writer), an agent in BroCrew, the app you run inside.',
  },
  {
    identity: { profileSlug: 'brobot', displayName: 'Another name' },
    who: 'You are BroBot, the coordinator in BroCrew, the app you run inside.',
  },
  {
    identity: { profileSlug: 'writer', displayName: null },
    who: 'You are an agent with the profile writer, in BroCrew, the app you run inside.',
  },
  {
    identity: { profileSlug: null, displayName: null },
    who: 'You are an agent in BroCrew, the app you run inside.',
  },
] as const
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('the agreed preamble identifies one agent', () => {
  for (const { identity, who } of identities) {
    it(`says exactly the agreed words for ${identity.profileSlug ?? 'an adopted conversation'} / ${identity.displayName}`, () => {
      expect(agentPreamble(identity)).toBe(`${who} ${tail}`)
      expect(agentPreamble(identity)).toContain(PRODUCT_NAME)
    })

    for (const provider of ['claude', 'codex'] as const) {
      it(`${provider} puts ${identity.profileSlug ?? 'an adopted conversation'} first without repeating the identity`, () => {
        const root = mkdtempSync(join(tmpdir(), 'brobot-preamble-'))
        roots.push(root)
        const home = join(root, 'provider')
        const cwd = join(root, 'work')
        mkdirSync(home)
        mkdirSync(cwd)
        const context = {
          ...identity,
          capabilities: DEFAULT_CAPABILITIES,
          configured: 'Keep these exact rules.',
        }
        const compiled = profileBundleSpans(context, provider)
        const published = publishProfileBundle(provider, home, compiled.text)
        expect(published.ok).toBe(true)
        const read = readSessionInstructions({
          provider,
          identity,
          providerHome: home,
          cwd,
          home: root,
          bundle: published,
          bundleComposed: compiled,
          thisConversation: { text: '- Your working directory is fictional.', spans: [] },
        })
        const preamble = `${who} ${tail}`
        const file = readFileSync(published.path, 'utf8')
        expect(file.startsWith(BUNDLE_MARKER)).toBe(true)
        const told = provider === 'claude' ? read.systemHint! : file.slice(file.indexOf('\n\n') + 2)
        expect(told.startsWith(preamble + '\n\n')).toBe(true)
        expect((told.match(/You are /g) ?? []).length).toBe(1)
        expect(file).toContain('Keep these exact rules.')
        expect(read.firstTurnLead ?? '').not.toContain('You are ')
        if (provider === 'claude') {
          expect(file).not.toContain('You are ')
          const kept = whatThisLaunchGave({
            provider,
            build: null,
            instructions: read.instructions,
            profileFile: read.profileFile,
            ownInstructionsVersion: null,
            reportedByTheProvider: [],
            toolset: { server: 'brobot', tools: [] },
          })
          expect(kept.profileFile?.heading?.startsWith(preamble + '\n\n')).toBe(true)
          const message = oneMessageAsTheModelGotIt({
            sessionId: 'sess_fixture',
            provider: 'claude',
            message: { ordinal: 2, at: 1, event: { type: 'user_turn', text: 'Hello.' } },
            launch: { ordinal: 1, at: 1, kept: 'recorded', record: kept },
            firstOfItsLaunch: true,
            earlierInThisLaunch: () => [],
            providersRecord: { found: false, why: 'No provider record in this fixture.' },
          })
          expect(message.parts[0]?.heading).toBe(kept.profileFile?.heading)
          expect(message.parts[0]?.heading?.startsWith(preamble + '\n\n')).toBe(true)
          for (const span of kept.profileFile?.sections ?? []) {
            expect(file.slice(span.start, span.end)).not.toBe('')
          }
        }
      })
    }
  }

  it('gives Codex the identity in its lead when publishing would replace an unmanaged file', () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot-preamble-refused-'))
    roots.push(root)
    const home = join(root, 'provider')
    const cwd = join(root, 'work')
    mkdirSync(home)
    mkdirSync(cwd)
    const path = join(home, 'AGENTS.override.md')
    const unmanaged = 'These instructions belong to a person.\n'
    writeFileSync(path, unmanaged)
    const identity = identities[0].identity
    const compiled = profileBundleSpans({ ...identity, configured: '' }, 'codex')
    const bundle = publishProfileBundle('codex', home, compiled.text)
    expect(bundle.ok).toBe(false)
    if (bundle.ok) throw new Error('the unmanaged file was replaced')
    const read = readSessionInstructions({
      provider: 'codex',
      identity,
      providerHome: home,
      cwd,
      home: root,
      bundle,
      bundleComposed: compiled,
      thisConversation: { text: '- This is the current conversation.', spans: [] },
    })
    expect(readFileSync(path, 'utf8')).toBe(unmanaged)
    expect(read.instructions.refused).toContainEqual({ path: bundle.path, reason: bundle.reason })
    expect(read.firstTurnLead?.startsWith(agentPreamble(identity) + '\n\n')).toBe(true)
    expect((read.firstTurnLead?.match(/You are /g) ?? []).length).toBe(1)
    expect(read.firstTurnLead).toContain('- This is the current conversation.')
    expect(read.instructions.composed).toBe(read.firstTurnLead)
    expect(read.systemHint).toBeNull()
    const withoutConversation = readSessionInstructions({
      provider: 'codex',
      identity,
      providerHome: home,
      cwd,
      home: root,
      bundle,
      bundleComposed: compiled,
    })
    expect(withoutConversation.firstTurnLead).toBe(agentPreamble(identity))
    expect(readFileSync(path, 'utf8')).toBe(unmanaged)
  })

  it('still gives Claude the identity when no profile file was sent', () => {
    const identity = identities[0].identity
    const hint = composeSystemHint([], { text: 'Only this conversation.' }, identity)
    expect(hint?.startsWith(agentPreamble(identity) + '\n\n')).toBe(true)
    expect(hint).toContain('Only this conversation.')
    expect(composeSystemHint([])).toBeUndefined()
  })

  it('charges the named UTF-8 preamble when it decides which whole files fit', () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot-preamble-budget-'))
    roots.push(root)
    const home = join(root, 'provider')
    const cwd = join(root, 'work', 'repo', 'leaf')
    mkdirSync(home)
    mkdirSync(cwd, { recursive: true })
    const files = [
      join(home, 'CLAUDE.md'),
      join(root, 'work', 'CLAUDE.md'),
      join(root, 'work', 'repo', 'CLAUDE.md'),
      join(cwd, 'CLAUDE.md'),
    ]
    files.forEach((path) => writeFileSync(path, 'x'))
    const identity = { profileSlug: 'writer', displayName: '名'.repeat(40) }
    const input = { provider: 'claude' as const, identity, providerHome: home, cwd, home: root }
    const sample = readSessionInstructions(input)
    expect(sample.instructions.injected).toHaveLength(4)
    const overhead = Buffer.byteLength(sample.systemHint!, 'utf8') - 4
    const available = INSTRUCTION_TOTAL_CAP - overhead + 1
    files.forEach((path, index) =>
      writeFileSync(
        path,
        'x'.repeat(Math.floor(available / 4) + (index === 0 ? available % 4 : 0)),
      ),
    )
    const read = readSessionInstructions(input)
    expect(Buffer.byteLength(read.systemHint!, 'utf8')).toBeLessThanOrEqual(INSTRUCTION_TOTAL_CAP)
    expect(read.instructions.injected).toHaveLength(3)
    expect(read.instructions.refused.some((one) => one.reason === 'over-budget')).toBe(true)
  })
})
