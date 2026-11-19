import { newConversationGive } from './lib/give-fixture'
import { ToolWatchingResumeRuntime } from './lib/provider-double'
import type { InjectedInstructionKind } from '../src/shared/instruction-contracts'
import { legacyWorkspaceFiles } from './helpers/legacy-workspace-files'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  BUNDLE_MARKER,
  bundleHeader,
  composeProfileBundle,
  MAY_NOT_SAVE_MEMORY,
  MAY_SAVE_MEMORY,
  NO_TEXT_PROMISES_A_WATCHER,
  NOT_IN_THE_FACTORY_TEXT,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { BUNDLE_LEAF, publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { TOOL_NAMES } from '../src/main/runtime/agent-tools'
import { REPLY_SUMMARY_LIMIT } from '../src/main/runtime/reply-rails'
import { theConversationCalled } from '../src/shared/piece-called'
import {
  AGENTS_FILENAME,
  AGENTS_OVERRIDE_FILENAME,
  codexConventionChain,
  composeSystemHint,
  readSessionInstructions,
} from '../src/main/runtime/instructions'
import { CLAUDE_INSTRUCTIONS_FILE } from '../src/main/providers/claude/layout.mjs'
import { CODEX_INSTRUCTIONS_FILE } from '../src/main/providers/codex/layout.mjs'
import { WORKSPACE_INSTRUCTIONS, workspaceInstructionFiles } from '../src/main/runtime/workspace'
import { RULE_WRITING_POLICY } from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { agentPreamble } from '../src/main/runtime/agent-preamble'
import { APPROVALS_ARE_THE_PERSONS, howYouWork } from './lib/the-core'
import { syntheticProviderHome, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'

const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

const GRANTS_HEADING = '## What you may do'
const SPAWNING_OFF =
  '- This app currently blocks creating agents and starting new agent conversations.'

const FIXED_RULE_POLICY =
  '- Only the person and the profile that created an agent can change its standing rules; any conversation of that profile counts, and when no creating profile is recorded, only the person can. Being the same profile as the agent gives no right to change its rules: an agent never writes its own, and keeps its own notes instead. Anyone else, the agent included, can propose a change, and the person decides a proposal. Each version keeps its author and reason, and can be undone.'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

function withoutProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const at = join(dir, entry)
    if (lstatSync(at).isDirectory()) walk(at, out)
    else if (/\.(ts|vue)$/.test(entry)) out.push(at)
  }
  return out
}

const NOT_ONE_DOMAIN: Record<string, RegExp> = {
  'merge (HO-035)': /\bmerg(e|es|ed|ing)\b/i,
  'production (HO-035)': /\bproduction\b/i,
  'code (497 · the conventions rule)': /\bcode\b/i,
  'repository (497 · the conventions rule and the PM scoping line)': /\brepositor(y|ies)\b/i,
  'ticket (497 · the PM scoping line)': /\bticket\b/i,
  'spec (497 · the PM scoping line)': /\bspec\b/i,
  branch: /\bbranch(es)?\b/i,
  commit: /\bcommit(s|ted)?\b/i,
  deploy: /\bdeploy(s|ed|ment)?\b/i,
  'pull request': /\bpull requests?\b/i,
  compile: /\bcompil(e|es|ed|ing)\b/i,
}

const thisConversationText = (launch: InstructionContext): string =>
  thisConversationSpans(launch).text

const OTHERS_IN_EVERY_FORM: InstructionContext['others'] = {
  shown: [
    { line: 'conversation W1.2 · Compare the flights', lastActiveAt: Date.UTC(2026, 8, 30, 2, 31) },
    { line: 'conversation W2.1 · Book the train', lastActiveAt: null },
    { line: 'conversation W3 · Bakery website', lastActiveAt: 0 },
    { line: 'conversation sess_untitled · untitled', lastActiveAt: null },
  ],
  more: 2,
}

const everyBundle = (): string[] =>
  [
    context({ profileSlug: null, root: 'not-yet-numbered', others: OTHERS_IN_EVERY_FORM }),
    context({
      startedBy: 'Ada, conversation W2 · Plan the trip',
      others: OTHERS_IN_EVERY_FORM,
    }),
  ].map((launch) => `${composeProfileBundle(launch)}\n\n${thisConversationText(launch)}`)

function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'default',
    cwd: '/tmp/work',
    startedBy: null,
    root: null,
    others: { shown: [], more: 0 },
    ...over,
  }
}

describe('§1 · one instruction set', () => {
  it('🔴 every agent receives the same rules, under no role of any kind', () => {
    const said = composeProfileBundle(context())
    expect(said).toContain('## How you work')
    expect(said).not.toMatch(/## You are (BroBot|a project manager|a worker)/)
    for (const text of [said, thisConversationText(context())]) {
      expect(text).not.toContain('Your recorded role is')
    }
    expect(thisConversationText(context())).toContain('## This conversation')
  })

  it('🔴 497 · ships NEITHER withdrawn rule, and the two words are pinned as members rather than as a grep', () => {
    const said = composeProfileBundle(context())
    expect(said, 'the bundle still ships the withdrawn rule').not.toMatch(/never merge/i)
    expect(said).not.toMatch(/production/i)
    expect(said).not.toMatch(/pull request|branch protection/i)
    expect(NOT_IN_THE_FACTORY_TEXT).toContain('merge')
    expect(NOT_IN_THE_FACTORY_TEXT).toContain('production')
  })

  describe('§1.5 · 497 · the vacation-agent test, over every line', () => {
    it('🔴 no factory sentence is spelled in one industry’s nouns', () => {
      const bundles = everyBundle()
      expect(bundles).toHaveLength(2)
      const read = bundles.join('\n')
      for (const line of [
        '- This conversation was started by Ada, conversation W2 · Plan the trip.',
        "- Your conversation has its own work. Use list_tasks for its label. If untitled, name it with update_work after the person's request.",
        '- Other conversations of this profile, most recent first (list_agents shows more):',
        '  - conversation W1.2 · Compare the flights — last active ',
        '  - conversation W2.1 · Book the train — last activity unknown.',
        '  - conversation W3 · Bakery website — last active ',
        '  - conversation sess_untitled · untitled — last activity unknown.',
        '  - and 2 more.',
      ]) {
        expect(read, `${line} is not in the texts the censuses read`).toContain(line)
      }
      for (const said of bundles) {
        for (const [why, pattern] of Object.entries(NOT_ONE_DOMAIN)) {
          expect(said, `${why} is back in the factory text`).not.toMatch(pattern)
        }
      }
    })

    it('⚠️ …and the census can SEE those words, so the negative above is a measurement', () => {
      const planted = composeProfileBundle(
        context({
          configured:
            'Read the code in the repository, check the ticket and the spec, compile it, ' +
            'commit on a branch, open a pull request, merge it and deploy to production.',
        }),
      )
      for (const [why, pattern] of Object.entries(NOT_ONE_DOMAIN)) {
        expect(planted, `${why} cannot be seen by this census`).toMatch(pattern)
      }
    })

    it('⛔ the memory rule and the work rule stay generic', () => {
      const plain = composeProfileBundle(context())
      expect(plain).toContain(
        "Keep the person's standing wishes in your own notes and, when permitted, tested lessons in saved methods; keep task facts separate.",
      )
      expect(plain).toContain(
        'A specialist may keep work that is small, tightly connected, covered by an exact installed procedure, or cheaper to do than hand off.',
      )
    })

    it('🔴 the conventions and delegation rules speak in generic terms', () => {
      const common = composeProfileBundle(context())
      expect(common).toContain('Follow local conventions; explain conflicts.')
      expect(common).toContain(
        'A specialist may keep work that is small, tightly connected, covered by an exact installed procedure, or cheaper to do than hand off.',
      )
      expect(common).toContain(
        'Keep the judgement and hand off separable, noisy work when the saved time or expertise justifies coordination.',
      )
      expect(common).toContain('Respect locked choices.')
      expect(common).toContain('Follow current permissions, tool contracts and refusals.')
    })
  })

  describe('historical workspace framing and the current publication roster', () => {
    it('the current app no longer publishes workspace instruction files', () => {
      expect(workspaceInstructionFiles()).toEqual([])
    })
    const published = (): { name: string; content: string }[] => legacyWorkspaceFiles()

    const hintFraming = (): string =>
      composeSystemHint(
        (
          [
            'profile-instructions',
            'profile-memory',
            'project-memory',
            'repository-conventions',
            'workspace-instructions',
            'agent-memory',
          ] satisfies InjectedInstructionKind[]
        ).map((kind) => ({
          kind,
          path: `/tmp/work/${kind}.md`,
          text: '',
          bytes: 0,
          truncated: false,
        })),
        { text: '' },
      ) ?? ''

    it('🔴 498 · the roster is derived from the publish call sites — two, and this section names both', () => {
      const publishers = walk(join(SRC, 'main'))
        .filter((file) => /\bpublishOwnFile\s*\(/.test(withoutProse(readFileSync(file, 'utf8'))))
        .map((file) => file.slice(SRC.length + 1).replaceAll('\\', '/'))
        .sort()
      expect(publishers).toEqual(['main/runtime/profile-bundle.ts', 'main/runtime/workspace.ts'])
      const planted = withoutProse(
        `publishOwnFile(a, b, c)\nconst x = 1\n  publishOwnFile (d, e, f)\n`,
      )
      expect(planted.match(/\bpublishOwnFile\s*\(/g)).toHaveLength(2)
      expect(withoutProse('/** calls publishOwnFile(dir, name) */')).not.toMatch(
        /\bpublishOwnFile\s*\(/,
      )
      expect(
        withoutProse(readFileSync(join(SRC, 'main/runtime/profile-bundle.ts'), 'utf8')),
      ).toContain('publishOwnFile(providerHome, name, text')
      expect(published().map((file) => file.name)).toEqual([
        CLAUDE_INSTRUCTIONS_FILE,
        CODEX_INSTRUCTIONS_FILE,
      ])
      for (const file of published()) {
        expect(file.content, `${file.name} is not rendered from the canonical source`).toContain(
          WORKSPACE_INSTRUCTIONS,
        )
      }
    })

    it('🔴 498 · the premise is GONE from the second factory text, and the instruction stayed', () => {
      for (const file of published()) {
        expect(file.content, `${file.name} still claims a watcher`).not.toMatch(
          /A person is supervising/i,
        )
        expect(file.content).not.toMatch(/answers the approval/i)
        expect(file.content).toContain(
          'Ask when something is destructive or ambiguous rather than guessing.',
        )
      }
    })

    it('⛔ 498 · no member of the forbidden list, and no domain noun, in the second factory text', () => {
      for (const file of published()) {
        for (const forbidden of NOT_IN_THE_FACTORY_TEXT) {
          expect(file.content.toLowerCase(), `${forbidden} is in ${file.name}`).not.toContain(
            forbidden.toLowerCase(),
          )
        }
        for (const [why, pattern] of Object.entries(NOT_ONE_DOMAIN)) {
          expect(file.content, `${why} is in ${file.name}`).not.toMatch(pattern)
        }
      }
      const doctored = `${published()[0]?.content ?? ''}\n\nRead the code in the repository, check the ticket and the spec, compile it, commit on a branch, open a pull request, merge it and deploy to production.`
      for (const [why, pattern] of Object.entries(NOT_ONE_DOMAIN)) {
        expect(doctored, `${why} cannot be seen in this text`).toMatch(pattern)
      }
    })

    it('🔴 498 · NEITHER factory text tells an agent that somebody is attending it', () => {
      const roster = [
        ...everyBundle().map((text, index) => ({ name: `bundle ${index}`, text })),
        ...published().map((file) => ({ name: `workspace ${file.name}`, text: file.content })),
      ]
      expect(roster).toHaveLength(4)
      for (const { name, text } of roster) {
        for (const [claim, pattern] of Object.entries(NO_TEXT_PROMISES_A_WATCHER)) {
          expect(text, `${name} promises: ${claim}`).not.toMatch(pattern)
        }
      }
      expect(Object.keys(NO_TEXT_PROMISES_A_WATCHER)).toEqual([
        'is supervising (498)',
        'is watching',
        'somebody is present',
        'somebody answers the prompts',
        'attended or not',
        'at the keyboard',
      ])
      expect(NOT_IN_THE_FACTORY_TEXT).toContain('supervising')
    })

    it('⚠️ …and every one of those patterns FIRES on the sentence that was withdrawn, or on its nearest paraphrase', () => {
      const fires: Record<string, string> = {
        'is supervising (498)':
          'A person is supervising this session and answers the approval prompts.',
        'is watching': 'Somebody is watching this conversation as it runs.',
        'somebody is present': 'A person is at the keyboard while you work.',
        'somebody answers the prompts': 'A person answers the approval prompts for you.',
        'attended or not': 'You are never running unattended.',
        'at the keyboard': 'There is a human at the keyboard.',
      }
      expect(Object.keys(fires)).toEqual(Object.keys(NO_TEXT_PROMISES_A_WATCHER))
      for (const [claim, sentence] of Object.entries(fires)) {
        const pattern = NO_TEXT_PROMISES_A_WATCHER[claim]
        expect(pattern, `${claim} has no pattern`).toBeDefined()
        expect(sentence, `${claim} cannot be seen by its own pattern`).toMatch(pattern as RegExp)
      }
    })

    it('⛔ …and it catches NONE of the true sentences a person is named in — the over-correction control', () => {
      expect(composeProfileBundle(context())).toContain(APPROVALS_ARE_THE_PERSONS)
      const kept = [
        'Tell the person when a piece of work would be better done by an agent of its own, so that they can grant you one.',
        'A request that is a person’s to settle is refused by name.',
        APPROVALS_ARE_THE_PERSONS,
      ]
      for (const sentence of kept) {
        for (const [claim, pattern] of Object.entries(NO_TEXT_PROMISES_A_WATCHER)) {
          expect(sentence, `${claim} would delete a true sentence`).not.toMatch(pattern)
        }
      }
    })

    it('⛔ …and a sentence saying somebody answers is caught, with nothing exempt', () => {
      const pattern = NO_TEXT_PROMISES_A_WATCHER['somebody answers the prompts'] as RegExp
      for (const sentence of [
        'A person is supervising this session and answers the approval prompts.',
        'An agent answers approvals.',
        'Only the person answers approvals and permissions.',
        'The person answers approvals.',
        'Silence answers a required question or grants permission.',
        'Someone always answers a required question or grants permission.',
      ]) {
        expect(sentence, sentence).toMatch(pattern)
      }
    })

    it('⚑ 498 · the THIRD app-authored text a model reads is the hint framing — censused, with its one exemption named', () => {
      const framing = hintFraming()
      expect(framing).toContain('Follow them; they take precedence over earlier general guidance.')
      expect(framing).toContain('generated by BroCrew for this workspace')
      expect(framing).toContain('Composed by BroCrew for this conversation at this launch:')
      for (const [claim, pattern] of Object.entries(NO_TEXT_PROMISES_A_WATCHER)) {
        expect(framing, `the hint framing promises: ${claim}`).not.toMatch(pattern)
      }
      for (const forbidden of NOT_IN_THE_FACTORY_TEXT) {
        expect(framing.toLowerCase(), `${forbidden} is in the hint framing`).not.toContain(
          forbidden.toLowerCase(),
        )
      }
      expect(framing).toMatch(/\brepositor(y|ies)\b/i)
      expect(framing).toContain("this repository's shared agent conventions")
    })
  })

  it('⚠️ 497 · …and the census that keeps them out is asked of the FACTORY half, not of a person’s own text', () => {
    const told = composeProfileBundle(
      context({ configured: 'Never merge, and never touch production.' }),
    )
    expect(told).toContain('## Your own instructions')
    expect(told).toContain('Never merge, and never touch production.')
    const factoryHalf = told.slice(0, told.indexOf('## Your own instructions'))
    expect(factoryHalf).not.toMatch(/merge|production/i)
    expect(factoryHalf).toContain('## How you work')
  })

  it('🔴 …and no text makes a claim a ruling has kept out of it', () => {
    const every = everyBundle()
    for (const said of every) {
      for (const forbidden of NOT_IN_THE_FACTORY_TEXT) {
        expect(said.toLowerCase(), `${forbidden} is in the bundle`).not.toContain(
          forbidden.toLowerCase(),
        )
      }
    }
    expect(every.every((said) => said.length > 500)).toBe(true)
    expect(NOT_IN_THE_FACTORY_TEXT.length).toBeGreaterThan(0)
    for (const said of every) expect(said).not.toContain(String(REPLY_SUMMARY_LIMIT))
  })

  it('⚑ …and the reply sentence S2 was held for DID ship, naming a tool that exists', () => {
    const worker = composeProfileBundle(context())
    expect(TOOL_NAMES).toContain('reply_to_parent')
    expect(TOOL_NAMES).toContain('list_tasks')
    for (const named of ['ask_question']) {
      expect(worker, `${named} is named in the text`).toContain(named)
      expect(TOOL_NAMES as readonly string[], `${named} is a tool`).toContain(named)
    }
    expect(worker).not.toMatch(/routed|delivered to|your parent receives|the app (sends|records)/i)
    expect(worker).not.toMatch(/closes the task|marks the task/i)
    expect(worker).not.toMatch(/if you do not reply/i)
  })

  it('⚑ …and 396’s question sentence shipped with ITS tool, in the bundle every agent receives', () => {
    const pm = composeProfileBundle(context())
    for (const named of ['list_questions', 'answer_question']) {
      expect(TOOL_NAMES as readonly string[], `${named} is a tool`).toContain(named)
    }
    expect(pm).toContain(
      "Ask your questions with ask_question, even to agents; notes expect none. request_action tracks the person's actions. Never guarantee replies.",
    )
    expect(pm).not.toMatch(/routed|travels|the app (sends|records|delivers)/i)
    expect(pm).not.toMatch(/your child(ren)? cannot/i)
  })

  it('⚠️ …and the worker text does not tell a worker it is alone, which is the correction with teeth', () => {
    const said = composeProfileBundle(context())
    expect(said).not.toMatch(/knows only what you tell it/i)
    expect(said).not.toMatch(/cannot see other agents/i)
    expect(said).toContain('Keep finished files on the piece so agents can find them.')
  })
})

describe('§2 · the common rules reach every agent', () => {
  it('⚠️ every common rule applies to every agent, because none of them is about being a worker', () => {
    const unknown = composeProfileBundle(context())
    expect(unknown).toContain('Address the actual reader.')
    expect(unknown).toContain('Keep finished files on the piece so agents can find them.')
    expect(unknown).toContain('Use the assigned folder; create one only for saved work.')
    expect(unknown).not.toMatch(/Work inside your working directory/)
    expect(unknown).toContain(APPROVALS_ARE_THE_PERSONS)
  })
})

describe('§3 · the dynamic layer moves when the data moves', () => {
  it('says the rule-writing policy and whether this conversation may save memory, and no grant', () => {
    const known = thisConversationText(context())
    expect(grantLines(known)).toEqual([FIXED_RULE_POLICY, `- ${MAY_SAVE_MEMORY}`])
    const none = thisConversationText(context({ profileSlug: null }))
    expect(grantLines(none)).toEqual([FIXED_RULE_POLICY, `- ${MAY_NOT_SAVE_MEMORY}`])
    for (const said of [known, none]) {
      expect(said).not.toContain('As of this launch, for')
      expect(said).not.toContain('cannot list its permissions')
      expect(said).not.toContain('A person set these')
    }
  })

  it('names the starter in the launch context by conversation address and title', () => {
    const parent = 'Ada, conversation W1 · Bakery website'
    const said = thisConversationText(context({ startedBy: parent }))
    expect(said).toContain(`- This conversation was started by ${parent}.`)
    expect(said).not.toMatch(/It gave you this task/)
    expect(said).not.toMatch(/who you report to/)
    expect(said).not.toMatch(/no agent currently commands/i)
  })

  it('⛔ a conversation nobody spawned gets no parent paragraph — the paired negative', () => {
    expect(thisConversationText(context({ startedBy: null }))).not.toMatch(/was started by/)
  })

  it('⛔ a conversation this app cannot place says so, rather than borrowing BroBot’s name', () => {
    const nameless = thisConversationText(context({ profileSlug: null }))
    expect(nameless).not.toContain('You are running as the profile')
    expect(agentPreamble({ profileSlug: null }).startsWith('You are an agent in BroCrew,')).toBe(
      true,
    )
    expect(nameless).not.toContain('`default`')
    expect(
      agentPreamble({ profileSlug: 'default' }).startsWith(
        'You are an agent with the profile default, in BroCrew,',
      ),
    ).toBe(true)
  })

  it('⚑ the configured layer is a SEAM: nothing supplied renders no heading at all', () => {
    expect(composeProfileBundle(context())).not.toMatch(/## Your own instructions/)
    expect(composeProfileBundle(context({ configured: '   ' }))).not.toMatch(
      /## Your own instructions/,
    )
    const supplied = composeProfileBundle(context({ configured: 'Never use force-push.' }))
    expect(supplied).toMatch(/## Your own instructions/)
    expect(supplied).toContain('Never use force-push.')
    expect(supplied.indexOf('## How you work')).toBeGreaterThan(-1)
    expect(supplied.indexOf('## How you work')).toBeLessThan(
      supplied.indexOf('## Your own instructions'),
    )
    expect(supplied).not.toContain('## This conversation')
    const base = mkdtempSync(join(tmpdir(), 'brobot2-377-order-'))
    try {
      const launch = context({ configured: 'Never use force-push.' })
      const providerHome = join(base, 'provider')
      const cwd = join(base, 'work')
      mkdirSync(providerHome, { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const read = readSessionInstructions({
        provider: 'claude',
        cwd,
        providerHome,
        bundle: publishProfileBundle('claude', providerHome, composeProfileBundle(launch)),
        thisConversation: thisConversationSpans(launch),
        home: base,
      })
      const sent = read.systemHint ?? ''
      for (const heading of [
        '## How you work',
        '## Your own instructions',
        '## This conversation',
      ]) {
        expect(sent, `${heading} is not in what Claude is sent`).toContain(heading)
      }
      expect(sent.indexOf('## How you work')).toBeLessThan(sent.indexOf('## Your own instructions'))
      expect(sent.indexOf('## Your own instructions')).toBeLessThan(
        sent.indexOf('## This conversation'),
      )
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('§4 · publishing the leaf, and refusing to take somebody else’s', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-377-home-'))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('⛔ writes the dialect leaf each provider actually reads', () => {
    for (const provider of ['claude', 'codex'] as const) {
      const dir = join(home, provider)
      mkdirSync(dir, { recursive: true })
      const published = publishProfileBundle(provider, dir, composeProfileBundle(context()))
      expect(published.ok).toBe(true)
      expect(published.path).toBe(join(dir, BUNDLE_LEAF[provider]))
      expect(readFileSync(published.path, 'utf8')).toContain(howYouWork(false))
    }
    expect(BUNDLE_LEAF.codex).toBe(AGENTS_OVERRIDE_FILENAME)
    expect(BUNDLE_LEAF.claude).not.toBe('CLAUDE.md')
  })

  it('🔴 the leaf is never empty, which is what Codex’s first-nonempty rule requires', () => {
    const bare = composeProfileBundle(context())
    expect(bare.trim().length).toBeGreaterThan(0)
    expect(bare.startsWith(BUNDLE_MARKER)).toBe(true)
    expect(bare).toContain(bundleHeader(false))
  })

  it('⛔ REFUSES an override this app did not write, and does not touch it', () => {
    mkdirSync(home, { recursive: true })
    const leaf = join(home, BUNDLE_LEAF.codex)
    const theirs = '# my own rules\nalways rebase\n'
    writeFileSync(leaf, theirs)
    const published = publishProfileBundle('codex', home, composeProfileBundle(context()))
    expect(published.ok).toBe(false)
    expect(published).toMatchObject({ reason: 'unmanaged-override', path: leaf })
    expect(readFileSync(leaf, 'utf8')).toBe(theirs)
  })

  it('⚑ …and the paired positive: a leaf THIS app wrote is replaced', () => {
    mkdirSync(home, { recursive: true })
    const first = publishProfileBundle('codex', home, composeProfileBundle(context()))
    expect(first.ok).toBe(true)
    const second = publishProfileBundle(
      'codex',
      home,
      composeProfileBundle(context({ configured: 'Remember the new instruction.' })),
    )
    expect(second.ok).toBe(true)
    expect(readFileSync(join(home, BUNDLE_LEAF.codex), 'utf8')).toContain(
      'Remember the new instruction.',
    )
  })

  it('⚠️ a SYMLINK at the leaf is not ours, and the link survives', () => {
    mkdirSync(home, { recursive: true })
    const target = join(home, 'somewhere-else.md')
    writeFileSync(target, `${bundleHeader(false)}\nnot really ours\n`)
    const leaf = join(home, BUNDLE_LEAF.codex)
    symlinkSync(target, leaf)
    expect(publishProfileBundle('codex', home, composeProfileBundle(context())).ok).toBe(false)
    expect(lstatSync(leaf).isSymbolicLink()).toBe(true)
  })

  it('🔴 the refusal reaches the drawer as a row with a reason — on BOTH providers', () => {
    for (const provider of ['claude', 'codex'] as const) {
      const dir = join(home, provider)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, BUNDLE_LEAF[provider]), 'someone else wrote this')
      const bundle = publishProfileBundle(provider, dir, composeProfileBundle(context()))
      const read = readSessionInstructions({ provider, cwd: home, providerHome: dir, bundle })
      expect(
        read.instructions.refused.map((row) => row.reason),
        `${provider} swallowed the conflict`,
      ).toContain('unmanaged-override')
    }
  })
})

describe('§5 · the repository’s AGENTS layer, selected as Codex selects it', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-377-repo-'))
    mkdirSync(join(root, '.git'), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('⛔ walks the git root down to the cwd, and no further up', () => {
    const deep = join(root, 'packages', 'api')
    mkdirSync(deep, { recursive: true })
    const chain = codexConventionChain(deep, '/nowhere')
    expect(chain).toEqual([root, join(root, 'packages'), deep])
  })

  it('⚠️ …and with no git root at all, the cwd alone', () => {
    const orphan = mkdtempSync(join(tmpdir(), 'brobot2-377-orphan-'))
    try {
      expect(codexConventionChain(orphan, '/nowhere').at(-1)).toBe(orphan)
    } finally {
      rmSync(orphan, { recursive: true, force: true })
    }
  })

  it('🔒 a git root at or above HOME does not open the door 170 §4 closed', () => {
    const deep = join(root, 'inner')
    mkdirSync(deep, { recursive: true })
    expect(codexConventionChain(deep, root)).toEqual([deep])
  })

  it('🔴 an override shadows AGENTS.md in its directory — even when it is EMPTY', () => {
    writeFileSync(join(root, AGENTS_FILENAME), 'ordinary conventions MARKER_PLAIN')
    writeFileSync(join(root, AGENTS_OVERRIDE_FILENAME), '')
    const read = readSessionInstructions({
      provider: 'claude',
      cwd: root,
      providerHome: mkdtempSync(join(tmpdir(), 'brobot2-377-ph-')),
      home: '/nowhere',
    })
    expect(read.instructions.injected.map((item) => item.text).join('\n')).not.toContain(
      'MARKER_PLAIN',
    )
    rmSync(join(root, AGENTS_OVERRIDE_FILENAME))
    const again = readSessionInstructions({
      provider: 'claude',
      cwd: root,
      providerHome: mkdtempSync(join(tmpdir(), 'brobot2-377-ph-')),
      home: '/nowhere',
    })
    expect(again.instructions.injected.map((item) => item.text).join('\n')).toContain(
      'MARKER_PLAIN',
    )
    expect(again.instructions.injected.map((item) => item.kind)).toContain('repository-conventions')
  })

  it('⛔ Codex is sent NO copy of it — the exactly-once property', () => {
    writeFileSync(join(root, AGENTS_FILENAME), 'MARKER_REPO_BYTES')
    const providerHome = mkdtempSync(join(tmpdir(), 'brobot2-377-ph-'))
    const bundle = publishProfileBundle('codex', providerHome, composeProfileBundle(context()))
    const read = readSessionInstructions({
      provider: 'codex',
      cwd: root,
      providerHome,
      bundle,
      thisConversation: thisConversationSpans(context({ cwd: root })),
      home: '/nowhere',
    })
    expect(read.instructions.injected).toEqual([])
    expect(read.systemHint).toBeNull()
    expect(read.firstTurnLead).toContain('## This conversation')
    expect(read.firstTurnLead).not.toContain('MARKER_REPO_BYTES')
    expect(readFileSync(join(providerHome, BUNDLE_LEAF.codex), 'utf8')).not.toContain(
      'MARKER_REPO_BYTES',
    )
    const claudeHome = mkdtempSync(join(tmpdir(), 'brobot2-377-ph-'))
    const claude = readSessionInstructions({
      provider: 'claude',
      cwd: root,
      providerHome: claudeHome,
      home: '/nowhere',
    })
    expect(claude.instructions.injected.map((item) => item.text).join('\n')).toContain(
      'MARKER_REPO_BYTES',
    )
  })

  it('⚠️ the shared file comes BEFORE the Claude-only one at the same depth', () => {
    writeFileSync(join(root, AGENTS_FILENAME), 'shared conventions')
    writeFileSync(join(root, 'CLAUDE.md'), 'claude only')
    const read = readSessionInstructions({
      provider: 'claude',
      cwd: root,
      providerHome: mkdtempSync(join(tmpdir(), 'brobot2-377-ph-')),
      home: dirname(root),
    })
    const kinds = read.instructions.injected.map((item) => item.kind)
    expect(kinds.indexOf('repository-conventions')).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf('repository-conventions')).toBeLessThan(kinds.indexOf('project-memory'))
  })

  it('🔴 the app’s own bundle is the FIRST thing on the list, above the agent’s own memory file', () => {
    const providerHome = mkdtempSync(join(tmpdir(), 'brobot2-377-ph-'))
    writeFileSync(join(providerHome, 'CLAUDE.md'), 'what the agent wrote about itself')
    const bundle = publishProfileBundle('claude', providerHome, composeProfileBundle(context()))
    const read = readSessionInstructions({
      provider: 'claude',
      cwd: root,
      providerHome,
      bundle,
      home: '/nowhere',
    })
    const kinds = read.instructions.injected.map((item) => item.kind)
    expect(kinds[0]).toBe('profile-instructions')
    expect(kinds).toContain('profile-memory')
    expect(readFileSync(join(providerHome, 'CLAUDE.md'), 'utf8')).toBe(
      'what the agent wrote about itself',
    )
  })
})

class ContextWatchingRuntime extends ToolWatchingResumeRuntime {
  constructor(provider: Provider, handed: AgentToolset[], sessions: FakeProviderSessions) {
    super(provider, handed, sessions)
  }
}

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('§8 · what the host tells the reader, at a launch and at a reopen', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let seen: InstructionContext[]
  let counter: number
  let clock: number
  let window: Sink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ContextWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
      readInstructions: (provider, cwd, providerHome, ctx) => {
        seen.push(ctx)
        const bundle = publishProfileBundle(
          provider,
          providerHome,
          composeProfileBundle(ctx, provider),
        )
        const read = readSessionInstructions({
          provider,
          identity: ctx,
          cwd,
          providerHome,
          bundle,
          thisConversation: thisConversationSpans(ctx),
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: null,
        }
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-377-host-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-377-host-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    seen = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  it('the launch context carries the display name chosen for its profile', async () => {
    await personOpens('named-agent')
    expect(store.setAgentDisplayName('named-agent', 'Lena')).toBe(true)
    await personOpens('named-agent')
    const ctx = seen.at(-1) as InstructionContext
    expect(ctx.profileSlug).toBe('named-agent')
    expect(ctx.displayName).toBe('Lena')
    expect(agentPreamble(ctx).startsWith('You are Lena (named-agent), an agent in BroCrew,')).toBe(
      true,
    )
  })

  it('🔴 a fresh launch carries the profile', async () => {
    await personOpens(DEFAULT_PROFILE_ID)
    const ctx = seen.at(-1) as InstructionContext
    expect(ctx.profileSlug).toBe(DEFAULT_PROFILE_ID)
    expect(ctx.startedBy).toBeNull()
    expect(thisConversationText(ctx)).toMatch(/What you may do/)
    expect(store.agentIdentityOf(DEFAULT_PROFILE_ID)).not.toBeNull()
  })

  it('a stored retired grant column changes nothing a launch is told', async () => {
    const first = await personOpens(DEFAULT_PROFILE_ID)
    const before = thisConversationText(seen.at(-1) as InstructionContext)
    await host.close(first, window)
    db.prepare(
      "UPDATE agent_identity SET can_message = 'none', can_assign_work = 'none', can_create_agents = 'none', max_depth = 0 WHERE slug = ?",
    ).run(DEFAULT_PROFILE_ID)
    await personOpens(DEFAULT_PROFILE_ID)
    const said = thisConversationText(seen.at(-1) as InstructionContext)
    expect(grantLines(said)).toEqual(grantLines(before))
    expect(said).not.toContain('You may not')
  })

  it('omits the retired switch from a launch even when its old column holds off', async () => {
    db.prepare("UPDATE app_policy SET spawning_enabled = 0 WHERE id = 'policy'").run()
    await personOpens(DEFAULT_PROFILE_ID)
    expect(thisConversationText(seen.at(-1) as InstructionContext)).not.toContain(SPAWNING_OFF)
  })

  it('⛔ …and a first launch of a new identity is told the rule-writing policy', async () => {
    await personOpens('a-fresh-one')
    const ctx = seen.at(-1) as InstructionContext
    expect(store.agentIdentityOf('a-fresh-one')).not.toBeNull()
    expect(thisConversationText(ctx)).toContain(FIXED_RULE_POLICY)
  })

  it('🔴 a child a GIVE started is told its parent — and is told the same thing after a restart', async () => {
    await host.close(await personOpens('worker'), window)
    await host.close(await personOpens(DEFAULT_PROFILE_ID), window)
    const pm = await personOpens(DEFAULT_PROFILE_ID)
    const pmTools = handed.at(-1) as AgentToolset
    const given = await callOn(pmTools, 'give_work', {
      to: 'new',
      conversation_title: 'The text',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The text',
      brief: 'the text this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started).toBe(true)
    const child = given.agent as string
    const pmIsCalled = host.nameByItsWork(pm)
    const theRootItGaveFrom = (given.label as string).split('.').slice(0, -1).join('.')
    expect(pmIsCalled).toContain(`conversation ${theRootItGaveFrom} ·`)
    const atLaunch = seen.at(-1) as InstructionContext
    expect(atLaunch.startedBy).toBe(`${host.whatToCallTheConversation(pm)}, ${pmIsCalled}`)
    expect(atLaunch.startedBy).not.toContain(pm)

    for (const built of hosts) await built.closeAll()
    host = buildHost()
    seen = []
    await host.resumeSession(child, new Sink('webContents:2'))
    const atResume = seen.at(-1) as InstructionContext
    expect(atResume.startedBy, 'the resumed child forgot its parent').toBe(
      `${host.whatToCallTheConversation(pm)}, ${host.nameByItsWork(pm)}`,
    )
    expect(thisConversationText(atResume)).toContain(
      `This conversation was started by ${atResume.startedBy}.`,
    )
    expect(atResume.profileSlug).toBe(atLaunch.profileSlug)
  })
  it('names the starter by its fixed address and current conversation title across a resume', async () => {
    await host.close(await personOpens('worker'), window)
    await host.close(await personOpens('helper'), window)
    await host.close(await personOpens(DEFAULT_PROFILE_ID), window)
    const pm = await personOpens(DEFAULT_PROFILE_ID)
    const pmTools = handed.at(-1) as AgentToolset
    const first = await callOn(
      pmTools,
      'give_work',
      newConversationGive('worker', 'Build the pages', 'build the pages'),
    )
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const worker = first.agent as string
    const workerTools = handed.at(-1) as AgentToolset
    const second = await callOn(workerTools, 'give_work', {
      ...newConversationGive('helper', 'Check the pages', 'check the pages'),
      under: first.label,
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    expect(second.started).toBe(true)
    const helper = second.agent as string
    const byThePieceItGaveFrom = theConversationCalled(host.whatToCallTheConversation(worker), {
      label: first.label as string,
      title: 'Build the pages',
    })
    expect((seen.at(-1) as InstructionContext).startedBy).toBe(
      `${host.whatToCallTheConversation(worker)}, ${host.nameByItsWork(worker)}`,
    )

    const third = await callOn(pmTools, 'give_work', {
      to: first.label,
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Write the copy',
      brief: 'write the copy',
    })
    expect(third.outcome, JSON.stringify(third)).toBe('ok')
    expect(host.nameByItsWork(worker)).toContain(
      `conversation ${first.label as string} · Build the pages`,
    )

    const changed = await callOn(pmTools, 'rename_conversation', {
      conversation: first.label,
      title: 'Write the copy',
    })
    expect(changed.outcome, JSON.stringify(changed)).toBe('ok')
    expect(host.nameByItsWork(worker)).toContain(
      `conversation ${first.label as string} · Write the copy`,
    )
    expect(host.nameByItsWork(worker)).not.toBe(byThePieceItGaveFrom)

    for (const built of hosts) await built.closeAll()
    host = buildHost()
    seen = []
    await host.resumeSession(helper, new Sink('webContents:2'))
    const atResume = seen.at(-1) as InstructionContext
    expect(atResume.startedBy).toBe(
      `${host.whatToCallTheConversation(worker)}, ${host.nameByItsWork(worker)}`,
    )
    expect(thisConversationText(atResume)).toContain(
      `This conversation was started by ${atResume.startedBy}.`,
    )

    const calledFor = (starter: string): string =>
      (
        host as unknown as {
          theStarterCalled(starter: string, conversation: null, from: null): string
        }
      ).theStarterCalled(starter, null, null)
    expect(calledFor(worker)).toBe(host.whatToCallTheConversation(worker))
    expect(calledFor(pm)).toContain(host.whatToCallTheConversation(pm))
    expect(calledFor(pm)).toContain(`the owner of ${store.rootOf(pm)?.label ?? '?'}`)
  })

  it('🔴 the shared delegation wording and a real give agree', async () => {
    for (const slug of [PROJECT_MANAGER_PROFILE_ID, 'reviewer']) {
      expect(
        store.createAgentIdentity(
          { slug, displayName: null, provider: null },
          { by: 'an-agent', agent: DEFAULT_PROFILE_ID },
        ),
      ).not.toBeNull()
    }

    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const launched = seen.at(-1) as InstructionContext
    const told = composeProfileBundle(launched)
    expect(told).toContain('hand off separable, noisy work')
    expect(told).toContain('Follow current permissions, tool contracts and refusals.')
    expect(thisConversationText(launched)).not.toContain(SPAWNING_OFF)

    const brobotTools = handed.at(-1) as AgentToolset
    const admitted = await callOn(brobotTools, 'give_work', {
      to: 'new',
      conversation_title: 'The delegation',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: PROJECT_MANAGER_PROFILE_ID,
      title: 'The delegation',
      brief: 'the delegation the text instructs',
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(admitted.started).toBe(true)

    expect(brobot).toBeTruthy()
  })
})

describe('§9 · one agent instruction set', () => {
  it('keeps delegation, handover and profile sizing together for every agent', () => {
    const said = composeProfileBundle(context())
    expect(said).toContain(
      'A specialist may keep work that is small, tightly connected, covered by an exact installed procedure, or cheaper to do than hand off.',
    )
    expect(said).toContain(
      'Keep the judgement and hand off separable, noisy work when the saved time or expertise justifies coordination.',
    )
    expect(said).toContain('Respect locked choices.')
    expect(said).toContain('State how to check it; give the next agent enough context.')
    expect(said).toContain(
      'Prefer visible BroCrew agents to provider sub-agents, whose work cannot be revisited here.',
    )
    expect(said).toContain('Choose a supported model and offered effort at each handoff')
  })

  it('says the rule-writing policy under its own heading, never in the shared core', () => {
    expect(composeProfileBundle(context())).not.toContain(RULE_WRITING_POLICY)
    expect(thisConversationText(context())).toContain(FIXED_RULE_POLICY)
  })
})

function grantsIn(said: string): string {
  const at = said.indexOf(GRANTS_HEADING)
  expect(at, 'the text has no "What you may do" section').toBeGreaterThan(-1)
  const next = said.indexOf('\n## ', at + GRANTS_HEADING.length)
  return said.slice(at, next === -1 ? undefined : next)
}

function grantLines(said: string): string[] {
  return grantsIn(said)
    .split('\n')
    .filter((line) => line.startsWith('- '))
}

describe('the workspace rules in the conversation block', () => {
  for (const profileSlug of ['brobot', 'named', null]) {
    it(`keeps the two agreed sentences beside cwd for ${String(profileSlug)}`, () => {
      const text = thisConversationText(context({ profileSlug }))
      expect(text).toContain(
        '- Your working directory is `/tmp/work`.\n' +
          '- This folder persists: files you leave here are still here in later conversations.\n' +
          '- Ask when something is destructive or ambiguous.',
      )
      expect(text.split('This folder persists:').length - 1).toBe(1)
      expect(text.split('Ask when something is destructive or ambiguous.').length - 1).toBe(1)
      expect(text).not.toContain('BROBOT-WORKSPACE-CANARY')
    })
  }
})
