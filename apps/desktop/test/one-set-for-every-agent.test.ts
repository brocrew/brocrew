import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerSchema } from '@brobot2/shared'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { theConversationCalled } from '../src/shared/piece-called'
import {
  type InstructionContext,
  composeProfileBundle,
  profileBundleSpans,
  thisConversationSpans,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { agentPreamble } from '../src/main/runtime/agent-preamble'
import { BROBOTS_ADDITION, howYouWork } from './lib/the-core'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

/** The factory sections of one launch's bundle — the text no profile, depth or grant may change. */
const factoryOf = (context: InstructionContext): string => {
  const { text, spans } = profileBundleSpans(context)
  return spans
    .filter((span) => span.whose === 'factory')
    .map((span) => text.slice(span.start, span.end))
    .join('')
}

/**
 * Launches that differ in profile, depth and grants. The core reads none of them; only BroBot's
 * profile adds its own paragraphs.
 */
const LAUNCHES: readonly Omit<InstructionContext, 'cwd' | 'spawningEnabled' | 'others'>[] = [
  {
    profileSlug: DEFAULT_PROFILE_ID,
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    root: 'W1',
  },
  {
    profileSlug: 'project-manager',
    startedBy: theConversationCalled('Giver', { label: 'W1', title: 'Bakery website' }),
    depth: 1,
    capabilities: { ...DEFAULT_CAPABILITIES,  },
    root: null,
  },
  {
    profileSlug: 'worker',
    startedBy: theConversationCalled('Pm', { label: 'W1.1.1.1.1.1', title: 'Check the pages' }),
    depth: 6,
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      maxDepth: 0,
      canCreateAgents: 'none',
    },
    root: null,
  },
]

describe('one set of instructions for every agent', () => {
  for (const provider of providerSchema.options) {
    it(`${provider}: every profile, depth and grant gets the same core, and BroBot its addition`, () => {
      const root = mkdtempSync(join(tmpdir(), 'brobot-one-set-'))
      roots.push(root)
      const cwd = join(root, 'work')
      mkdirSync(cwd)
      const contexts = LAUNCHES.map((launch): InstructionContext => ({
        ...launch,
        cwd,
        spawningEnabled: true,
        others: { shown: [], more: 0 },
      }))
      const published = contexts.map((context, index) => {
        const home = join(root, `home-${index}`)
        mkdirSync(home)
        const bundle = publishProfileBundle(provider, home, composeProfileBundle(context, provider))
        expect(bundle.ok).toBe(true)
        const read = readSessionInstructions({
          provider,
          identity: context,
          cwd,
          providerHome: home,
          bundle,
          thisConversation: thisConversationSpans(context),
        })
        const file = readFileSync(bundle.path, 'utf8')
        const handed = provider === 'claude' ? (read.instructions.composed ?? '') : file
        expect(handed).toContain('## How you work')
        const itsOwn = (provider === 'claude' ? read.systemHint : read.firstTurnLead) ?? ''
        return { file, itsOwn, handed }
      })

      // Identity and conversation facts differ; the situational rules stay the same.
      expect(new Set(published.map((one) => one.itsOwn)).size).toBe(LAUNCHES.length)
      LAUNCHES.forEach((launch, index) => {
        expect(published[index]?.handed).toContain(agentPreamble(launch))
      })
      // Every profile but BroBot gets the same core, word for word, at any depth and grant.
      const rulesOf = (file: string): string => file.slice(file.indexOf('# Your instructions'))
      const brobot = LAUNCHES.findIndex((launch) => launch.profileSlug === DEFAULT_PROFILE_ID)
      const others = published.filter((_, index) => index !== brobot)
      expect(others.length).toBe(LAUNCHES.length - 1)
      expect(new Set(others.map((one) => rulesOf(one.file))).size).toBe(1)

      const factories = contexts.map(factoryOf)
      const othersFactory = factories.find((_, index) => index !== brobot) ?? ''
      expect(new Set(factories.filter((_, index) => index !== brobot)).size).toBe(1)
      expect(othersFactory).toContain(`${howYouWork(false)}\n`)
      expect(othersFactory).not.toContain(BROBOTS_ADDITION[0])
      // BroBot's is the same core with its addition after it, and nothing else differs.
      const brobotsFactory = factories[brobot] ?? ''
      expect(brobotsFactory).toContain(`${howYouWork(true)}\n`)
      expect(brobotsFactory.replace(`\n\n${BROBOTS_ADDITION.join('\n\n')}`, '')).toBe(othersFactory)
      // A grant moved changes nothing in the core: the grants are said under "What you may do".
      const [first] = contexts
      if (first === undefined) throw new Error('no launch')
      expect(
        factoryOf({ ...first, capabilities: { ...DEFAULT_CAPABILITIES,  } }),
      ).toBe(factories[0])
    })
  }
})
