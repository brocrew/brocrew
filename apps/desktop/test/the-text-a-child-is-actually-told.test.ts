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
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { InjectedInstructionKind, RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  BUNDLE_MARKER,
  bundleHeader,
  composeProfileBundle,
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
import {
  CLAUDE_INSTRUCTIONS_FILE,
  CODEX_INSTRUCTIONS_FILE,
  WORKSPACE_INSTRUCTIONS,
  workspaceInstructionFiles,
} from '../src/main/runtime/workspace'
import {
  ASSIGNMENT_REACH_ADMITS,
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  MESSAGING_REACH,
  MESSAGING_REACH_ADMITS,
  capabilityField,
  grantSays,
} from '../src/shared/capabilities'
import type {
  AnyCapabilityField,
  ConversationAtLaunch,
  ProfileCapabilities,
} from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { agentPreamble } from '../src/main/runtime/agent-preamble'
import { APPROVALS_ARE_THE_PERSONS, howYouWork } from './lib/the-core'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * 🔴 **377 · the text a child is actually told** — HO-009's instruction architecture, the part
 * Slice 4 cannot ship without.
 *
 * ## ⛔ What was missing, in one sentence
 *
 * Fresh start and cold resume use `readInstructions(provider, cwd, providerHome)`. The reader
 * must receive the child’s factory instructions so an admitted child is told why it exists,
 * not merely given permission to start.
 *
 * ## ⚠️ What each section checks
 *
 *  - **§1** the shared factory text — every agent gets one bundle (D-014 removed roles).
 *  - **§2** the common rules reach every agent.
 *  - **§3** the dynamic layer moves when the DATA moves — the same context with one field changed.
 *    A capability sentence that did not move would be a description, which is what HO-015 §2 forbids.
 *    ⚑ **D-024 · R1 moved that layer out of the profile's file** into a composition of its own,
 *    {@link thisConversationText}, so §3, §8 and §10 ask THAT for every dynamic fact and ask the
 *    file only for the factory and configured layers.
 *  - **§4** the publisher, at the two states that differ: a leaf that is ours and one that is not.
 *  - **§5** the repository bridge, over `362`'s own live matrix — including the row that corrected
 *    the premise everybody was working from (an empty PROJECT override shadows; an empty PROFILE
 *    override does not).
 *  - **§6** and **§7** were the role seed and the census that no rail read `role`; D-014 removed
 *    roles and both went with them.
 */

/** ⚑ **485 · the section §10 is about**, named once so no test spells it twice. */
const GRANTS_HEADING = '## What you may do'
const SPAWNING_OFF =
  '- This app currently blocks creating agents and starting new agent conversations. Giving work to an existing conversation still depends on your permissions.'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

/**
 * Comments first — a docblock quoting a call is not a call.
 *
 * ⚑ **498 · hoisted out of §7, which is where it was written.** §1.6's roster census asks the same
 * question of the same tree, and two strips would be two answers to *is this a call or a quotation
 * of one*.
 */
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

/**
 * ⛔ **Every word a withdrawn or widened sentence was spelled in** — see §1.5's docblock for the
 * test it serves and the two exemptions. ⚑ **498 hoisted it out of §1.5** so §1.6 can ask the same
 * question of the second factory text; a copy would be two lists to keep level.
 */
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

const GRANTED: ProfileCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canMessage: 'any',
}

/**
 * 🔴 **D-024 · R1 — what is true of ONE conversation, and what it has been granted, as composed for
 * its launch.** ⛔ Never the profile's file: `composeProfileBundle` takes `ProfileBundleContext` —
 * the grants and the person's own text — and nothing else, so two conversations of one profile
 * write the same bytes. ⚑ Named once, so a dynamic fact is never asked of the file by habit.
 */
const thisConversationText = (launch: InstructionContext): string =>
  thisConversationSpans(launch).text

/**
 * ⚑ **D-024 · R1 — the profile's other conversations, in every form one line of the list takes**:
 * one this conversation started (`you`), one an agent started, one a person started on a root and
 * one on none — with pieces open, ended and absent — and more of them than are shown, so the
 * `and N more` line renders too. ⚠️ The names, labels and titles are DATA, chosen to trip no census,
 * so what the censuses measure is the words this app writes around them.
 */
const OTHERS_IN_EVERY_FORM: InstructionContext['others'] = {
  shown: [
    { label: 'W1.2', title: 'Compare the flights', lastActiveAt: Date.UTC(2026, 8, 30, 2, 31) },
    { label: 'W2.1', title: 'Book the train', lastActiveAt: null },
    { label: 'W3', title: 'Bakery website', lastActiveAt: 0 },
    { label: 'sess_untitled', title: '', lastActiveAt: null },
  ],
  more: 2,
}

/**
 * Both grant states, because grant-sensitive advice has two branches — and every agent gets one
 * bundle (D-014), so the grants are what moves the profile's file here.
 *
 * 🔴 **D-024 · R1 — each is BOTH texts one launch composes**: the profile's file, then this
 * conversation's own block ({@link thisConversationText}). ⛔ The dynamic layer — the grants'
 * sentences, the parent line, the root line, the other conversations — left the file, so a census
 * asked of the file alone would have stopped reading every one of them with nothing going red:
 * 498's blindness (§1.6), one route over. ⚑ **So each launch also carries the conversation facts
 * that render a line**, which {@link context}'s defaults render none of: the ungranted one is a
 * conversation a person started, on its first launch (the root line) — the granted one a child of
 * another conversation (the parent line, at depth 1, as `startedBy` and `depth` move together) —
 * and both list {@link OTHERS_IN_EVERY_FORM}. §1.5's first case asserts every one of those lines is
 * in the texts, so the four censuses reading them are measurements and not a silence. ⚠️ Joined for
 * the censuses only; the bytes a model is sent carry a header between the two (`composeSystemHint`)
 * — the header is censused in §1.6 and the order the two are sent in is asserted in §3.
 */
const everyBundle = (): string[] =>
  [
    context({ capabilities: null, root: 'not-yet-numbered', others: OTHERS_IN_EVERY_FORM }),
    context({
      capabilities: GRANTED,
      startedBy: theConversationCalled('Ada', { label: 'W2', title: 'Plan the trip' }),
      depth: 1,
      others: OTHERS_IN_EVERY_FORM,
    }),
  ].map((launch) => `${composeProfileBundle(launch)}\n\n${thisConversationText(launch)}`)

/** A context with every field at its least interesting value, so a test moves exactly one thing. */
function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'default',
    cwd: '/tmp/work',
    startedBy: null,
    // ⚑ **544 · the conversation a PERSON started**, which is HO-005 §2 Q3's own `0` and the value
    // that pairs with `startedBy: null` above. ⛔ A test that is about a deeper conversation moves
    // this and `startedBy` together, because the two answer one question.
    depth: 0,
    capabilities: null,
    // ⚑ **485 · the state a shipped database is in**, so a test that is not about the switch does
    // not have to say so: the migration seeds `app_policy.spawning_enabled` to 1 on every install.
    spawningEnabled: true,
    // ⚑ **D-016 · no root line**, the least interesting value: the one conditional line about the
    // root is rendered only for a conversation that owns one, and no test here is about it.
    root: null,
    // ⚑ **D-024 · R1 · no other conversation of the profile**, the least interesting value: the
    // list of them renders no line at all when it is empty, and no test here is about it.
    others: { shown: [], more: 0 },
    ...over,
  }
}

describe('§1 · one instruction set', () => {
  it('🔴 every agent receives the same rules, under no role of any kind', () => {
    // ⚑ **D-014 removed roles**: the bundle differs only by profile, depth and grants.
    const said = composeProfileBundle(context())
    expect(said).toContain('## How you work')
    expect(said).not.toMatch(/## You are (BroBot|a project manager|a worker)/)
    // ⚑ **D-024 · R1 — the role line was a DYNAMIC sentence** (`- Your recorded role is …`, under
    // `## This conversation`), and that section is this conversation's own block now, so the
    // negative is asked of both texts a launch composes — the file alone would pass it vacuously.
    for (const text of [said, thisConversationText(context())]) {
      expect(text).not.toContain('Your recorded role is')
    }
    expect(thisConversationText(context())).toContain('## This conversation')
  })

  it('🔴 497 · ships NEITHER withdrawn rule, and the two words are pinned as members rather than as a grep', () => {
    // 🔴 **HO-035 withdrew both as product invariants**, in the words of the person who set them:
    // *"'Agents never merge' and 'PROD is read-only'… I misread them as properties of the product.
    // BroBot is generic. It can run his coding workflow, and it can plan a vacation."*
    //
    // ⛔ **This test used to assert the sentence SHIPS.** It asserted the rule, its limit clause and
    // `364`'s measurement under it — a correct test of a repair that was itself correct, on a
    // sentence that was never the product's to make. ⚠️ The limit clause is not what went wrong and
    // is not what is being withdrawn: `368`'s shape — *the protection and its bound in one breath* —
    // still governs every line that rests on a fact about this app.
    const said = composeProfileBundle(context())
    expect(said, 'the bundle still ships the withdrawn rule').not.toMatch(/never merge/i)
    expect(said).not.toMatch(/production/i)
    // ⚑ **…and no paraphrase of it either.** `merge` is the word any wording has to reach for,
    // which is why it is the member; these are the two nearest ways to say it without.
    expect(said).not.toMatch(/pull request|branch protection/i)
    // 🔴 **The member list is pinned HERE, by name, and that is the load-bearing half.** ⛔ The
    // census in §2 walks `NOT_IN_THE_FACTORY_TEXT`, so it is derived FROM the constant and would go
    // green the moment somebody deleted a member — `a-bound-written-as-the-constant-cannot-pin-it`,
    // one subject over. ⚠️ Deleting the sentence alone is a diff nobody reads; deleting a member is
    // this line.
    expect(NOT_IN_THE_FACTORY_TEXT).toContain('merge')
    expect(NOT_IN_THE_FACTORY_TEXT).toContain('production')
  })

  /**
   * 🔴 **497 · the PO's own test, run over every line and left where it can be re-run.**
   *
   * > ⛔ **If a sentence in factory text would be FALSE for a vacation-planning agent, it does not
   * > belong in factory text.**
   *
   * ⚑ **HO-035, and it is a different test from standing rule 8.** Rule 8 refuses a sentence that
   * DESCRIBES this app, because a description drifts when the app changes. This one refuses a
   * sentence that is only true of one person's work, because factory text is read by every agent
   * this product can run. ⚠️ Three sentences failed it and were widened; the words they were
   * spelled in are what this asserts, because a word is what any re-wording has to reach for.
   *
   * ## ⛔ The remaining exemption, named and asserted PRESENT rather than left as a hole
   *
   * ⚑ **PE-001 widened the memory rule.** Easy-to-miss steps and costly pitfalls can occur in a
   * trip as well as in a build. The rule now asks for project notes and transferable lessons without
   * naming an industry. This test asserts those two kinds instead of preserving the old example.
   *
   * ⚑ **`implement` stays in the project manager's line** for the same reason and more weakly: it
   * is ordinary English for carrying out a plan, and two independent readers refused to call it
   * domain-specific.
   *
   * ## ⚠️ What this cannot see, said here so nobody reads it as the whole test
   *
   * ⛔ **A word census catches a sentence that is domain-SHAPED. It cannot catch one that is
   * generic in vocabulary and particular in PROVENANCE** — *"size each to roughly ten minutes"* is
   * true and followable for an agent planning a holiday, and it is still one person's PM
   * discipline. ⚑ That one is a finding for the PO and not a red test, because the test he gave
   * does not catch it.
   */
  describe('§1.5 · 497 · the vacation-agent test, over every line', () => {
    it('🔴 no factory sentence is spelled in one industry’s nouns', () => {
      const bundles = everyBundle()
      expect(bundles).toHaveLength(2)
      // 🔴 **D-024 · R1 — the premise of all four censuses over {@link everyBundle}, asserted
      // PRESENT**: every conditional line of this conversation's block is in the texts they read —
      // the parent line, the root line and each form of the other-conversations list. ⛔ Without
      // it, a launch that stopped rendering them would leave every negative below green over a
      // text that no longer carries the sentence.
      const read = bundles.join('\n')
      for (const line of [
        '- This conversation was started by Ada (the owner of W2 · Plan the trip).',
        "- Your conversation has its own work. Use list_tasks for its label. If untitled, name it with update_work after the person's request.",
        '- Other conversations of this profile, as of this launch. Point the person to the right conversation:',
        '  - W1.2 · Compare the flights — last active ',
        '  - W2.1 · Book the train — last activity unknown.',
        '  - W3 · Bakery website — last active ',
        '  - sess_untitled · Untitled conversation — last activity unknown.',
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
      // ⛔ **Standing rule 4: a negative is only as strong as its search shape.** The same
      // patterns, over a bundle that really does carry every one of them, must find all eleven —
      // otherwise the eleven passes above are an artefact of a regex that matches nothing.
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
      const granted = composeProfileBundle(context({ capabilities: GRANTED }))
      expect(plain).toContain(
        'Save tested lessons and person-set conventions when permitted; separate task facts.',
      )
      expect(granted).toContain(
        'A specialist may keep work that is small, tightly connected, covered by an exact installed procedure, or cheaper to do than hand off.',
      )
    })

    it('🔴 the conventions and delegation rules speak in generic terms', () => {
      const common = composeProfileBundle(context())
      expect(common).toContain('Follow local conventions; explain conflicts.')
      const granted = composeProfileBundle(context({ capabilities: GRANTED }))
      expect(granted).toContain(
        'A specialist may keep work that is small, tightly connected, covered by an exact installed procedure, or cheaper to do than hand off.',
      )
      expect(granted).toContain(
        'Keep the judgement and hand off separable, noisy work when the saved time or expertise justifies coordination.',
      )
      // ⚠️ **The rule each one carries is still THERE** — a widening that deleted the instruction
      // would pass every negative above. Each of these is the clause the sentence exists for.
      expect(granted).toContain('Respect locked choices.')
      expect(granted).toContain('Follow current permissions, tool contracts and refusals.')
    })
  })

  /**
   * 🔴 **498 · the SECOND factory text, and the reason it needed its own section.**
   *
   * ⛔ **`workspace.ts`'s `WORKSPACE_INSTRUCTIONS` is factory text by every test this project
   * applies** — app-authored, versioned with the release, editable by nobody, and it says so in its
   * own body. ⚑ It reaches a model by a route none of the censuses above can see:
   * `workspaceInstructionFiles()` renders it as **both** `CLAUDE.md` and `AGENTS.md`, `ensureWorkspace`
   * writes them into the workspace at every launch, and `scratch-cwd.ts`'s blank branch makes that
   * workspace the cwd of **every conversation that names no folder**.
   *
   * ⚠️ **Every census above is addressed to `composeProfileBundle`'s OUTPUT**, so the blindness was
   * by construction rather than by carelessness — and it cost one sentence that was false on
   * arrival: *"A person is supervising this session and answers the approval prompts."*
   * ⛔ `factory-text.ts` is conditional about the same fact on purpose (*"**When this app asks** a
   * person to approve…"*, because *in the automatic mode a request may not be raised at all*), and
   * `spawn-rails.ts` records `auto` as the mode the operator uses.
   *
   * ## 🔴 The durable half: the roster is DERIVED, so the third text cannot hide either
   *
   * ⛔ **A test that simply added one more constant would fix the instance and not the class.** The
   * first census below asks the TREE which files publish a text for a provider to read, and fails
   * if that set is anything but the two this section names. ⚑ A third publisher is then a red test
   * on the day it lands, not a sweep two dispatches later.
   */
  describe('historical workspace framing and the current publication roster', () => {
    it('the current app no longer publishes workspace instruction files', () => {
      expect(workspaceInstructionFiles()).toEqual([])
    })
    /** ⚑ What is actually written into the cwd — header comment included, because a model reads it. */
    const published = (): { name: string; content: string }[] => legacyWorkspaceFiles()

    /**
     * ⛔ **The app's own framing around every file it appends**, with empty bodies so what is left
     * is only the text `instructions.ts` authors: its `HINT_PREAMBLE` and one `scopeWording` per
     * kind. ⚠️ Not a published FILE and so not in the roster — it is the third route, and the last
     * test in this section is where it is censused.
     *
     * ⚑ **D-024 · R1 — and the header above this conversation's own block**, which that file
     * authors too and appends LAST; composed here with an empty block, for the same reason the
     * files' bodies are empty.
     */
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
      // ⛔ **The question a roster written by hand cannot answer:** *is this all of them?* Every
      // file under `main/` that names the publisher in CODE, prose stripped, because a docblock
      // quoting a call is not a call.
      const publishers = walk(join(SRC, 'main'))
        .filter((file) => /\bpublishOwnFile\s*\(/.test(withoutProse(readFileSync(file, 'utf8'))))
        .map((file) => file.slice(SRC.length + 1).replaceAll('\\', '/'))
        .sort()
      expect(publishers).toEqual(['main/runtime/profile-bundle.ts', 'main/runtime/workspace.ts'])
      // ⚑ **A control that plants TWO, not one** (standing rule 12), and both directions of the
      // strip that does the work.
      const planted = withoutProse(
        `publishOwnFile(a, b, c)\nconst x = 1\n  publishOwnFile (d, e, f)\n`,
      )
      expect(planted.match(/\bpublishOwnFile\s*\(/g)).toHaveLength(2)
      expect(withoutProse('/** calls publishOwnFile(dir, name) */')).not.toMatch(
        /\bpublishOwnFile\s*\(/,
      )
      // ⚠️ **…and what each one publishes is a text this file censuses.** The bundle is
      // `composeProfileBundle`'s output, asserted two ways above; the workspace pair is one
      // constant rendered twice.
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
      // ⛔ **The withdrawn half**, asserted on the bytes a model reads rather than on the constant.
      for (const file of published()) {
        expect(file.content, `${file.name} still claims a watcher`).not.toMatch(
          /A person is supervising/i,
        )
        expect(file.content).not.toMatch(/answers the approval/i)
        // ⚑ **The kept half, and it is what makes this a repair rather than a deletion.** It asks
        // the agent to DO something and is followable in both approval modes.
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
        // ⚠️ **497's vacation-agent census, over the text it could not see.** It came back clean
        // before this dispatch too — which is a reason to PIN it, not a reason to skip it.
        for (const [why, pattern] of Object.entries(NOT_ONE_DOMAIN)) {
          expect(file.content, `${why} is in ${file.name}`).not.toMatch(pattern)
        }
      }
      // ⚑ **And the census can see all eleven in this text**, so the negative above is a
      // measurement: the same planted sentence §1.5 uses, appended to the real bytes.
      const doctored = `${published()[0]?.content ?? ''}\n\nRead the code in the repository, check the ticket and the spec, compile it, commit on a branch, open a pull request, merge it and deploy to production.`
      for (const [why, pattern] of Object.entries(NOT_ONE_DOMAIN)) {
        expect(doctored, `${why} cannot be seen in this text`).toMatch(pattern)
      }
    })

    it('🔴 498 · NEITHER factory text tells an agent that somebody is attending it', () => {
      // ⛔ **Standing rule 8's claim, as a census rather than as a sentence-by-sentence reading.**
      // Whether a person is there, whether a request is raised and who answers it are facts about
      // this LAUNCH — `auto` and `ask` differ on all three — so no template may promise any.
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
      // 🔴 **The members are pinned BY NAME here**, because the loop above is derived from the
      // constant and would go green the moment somebody deleted one — the same hole §1 closes for
      // `NOT_IN_THE_FACTORY_TEXT`.
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
      // ⛔ **A negative is only as strong as its search shape** (standing rule 4). One planted
      // sentence per member, each the way that claim actually gets written.
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
      // 🔴 **Naming a person as the only party who MAY act is not a claim that one is there.** A
      // census that also deleted these would have taken the enforced rule with the withdrawn one.
      // The core's own approval sentence is one of them, and it is in the shipped text.
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
      // The withdrawn sentence and its near-variants, each caught as written.
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
      // ⛔ **It is not a published file and it is still text this app wrote into a prompt.**
      expect(framing).toContain('Follow them; they take precedence over earlier general guidance.')
      expect(framing).toContain('generated by BroCrew for this workspace')
      // ⚑ **D-024 · R1 — the census reaches the conversation block's header**, so the negatives
      // below range over it as well.
      expect(framing).toContain('Composed by BroCrew for this conversation at this launch:')
      for (const [claim, pattern] of Object.entries(NO_TEXT_PROMISES_A_WATCHER)) {
        expect(framing, `the hint framing promises: ${claim}`).not.toMatch(pattern)
      }
      for (const forbidden of NOT_IN_THE_FACTORY_TEXT) {
        expect(framing.toLowerCase(), `${forbidden} is in the hint framing`).not.toContain(
          forbidden.toLowerCase(),
        )
      }
      // 🔴 **The vacation-agent census deliberately does NOT range over this text, and here is
      // why, as an assertion rather than as a silence.** `repository-conventions` is a LABEL for a
      // file BroBot found in a repository — the word is a measurement of where the bytes came
      // from, not a premise about what the agent's work is. ⚠️ Stated here so the exemption is
      // read as a decision; if it ever stops being one, this line is what goes red.
      expect(framing).toMatch(/\brepositor(y|ies)\b/i)
      expect(framing).toContain("this repository's shared agent conventions")
    })
  })

  it('⚠️ 497 · …and the census that keeps them out is asked of the FACTORY half, not of a person’s own text', () => {
    // ⛔ **The distinction HO-035 turns on, as an assertion.** *"Never merge"* is a perfectly good
    // rule for a person to give their own agents — HO-009 §2.2 makes *relayed from user* its own
    // authorization — and what was withdrawn is the product asserting it unasked. ⚑ So a bundle
    // whose CONFIGURED layer says it is not in breach of anything, and the forbidden-clause census
    // must never be turned on that layer.
    const told = composeProfileBundle(
      context({ configured: 'Never merge, and never touch production.' }),
    )
    expect(told).toContain('## Your own instructions')
    expect(told).toContain('Never merge, and never touch production.')
    // ⚠️ **The pair, so this is a measurement and not a tautology**: the same words are absent from
    // the same bundle's factory half. Splitting at the configured heading is what tells them apart.
    const factoryHalf = told.slice(0, told.indexOf('## Your own instructions'))
    expect(factoryHalf).not.toMatch(/merge|production/i)
    expect(factoryHalf).toContain('## How you work')
  })

  it('🔴 …and no text makes a claim a ruling has kept out of it', () => {
    // ⚠️ **HO-017 §3 asked the PM to hold one of these BY NAME**: *"the `reply_to_parent` sentence in
    // the reply instruction does not ship before S2 supplies the tool and a real task id."* ⚑ **`393` is
    // S2 and the hold has lifted** — the assertion below moved with it, and the paired positive in
    // the next test is where the sentence that shipped is pinned.
    // ⛔ **Asserted over both grant states** — every agent gets one bundle (D-014), so a clause
    // added to the common rules would reach every agent.
    const every = everyBundle()
    for (const said of every) {
      for (const forbidden of NOT_IN_THE_FACTORY_TEXT) {
        expect(said.toLowerCase(), `${forbidden} is in the bundle`).not.toContain(
          forbidden.toLowerCase(),
        )
      }
    }
    // ⚑ **The paired positive, and it is what makes the negatives above a measurement.** A compiler
    // that returned the empty string would satisfy every one of them.
    expect(every.every((said) => said.length > 500)).toBe(true)
    expect(NOT_IN_THE_FACTORY_TEXT.length).toBeGreaterThan(0)
    // 🔴 **And the number is still out, which is the member most likely to be argued away.** ⛔ The
    // bound lives in `REPLY_SUMMARY_LIMIT` and is named by the tool's own refusal; a bundle that
    // spelled it would be the same value in two places, wrong the day the constant moves.
    for (const said of every) expect(said).not.toContain(String(REPLY_SUMMARY_LIMIT))
  })

  it('⚑ …and the reply sentence S2 was held for DID ship, naming a tool that exists', () => {
    // 🔴 **The other half of HO-017 §3, and the half a census cannot state as an absence.** The hold
    // was *"not before S2 supplies the tool and a real task id"*; S2 supplied both, so the sentence
    // is owed and this is where it is owed from.
    const worker = composeProfileBundle(context())
    // The reply sentence itself is the hand-back skill's now; the core names the tool a decision is
    // asked with, and it is a tool this app publishes.
    expect(TOOL_NAMES).toContain('reply_to_parent')
    expect(TOOL_NAMES).toContain('list_tasks')
    for (const named of ['ask_question']) {
      expect(worker, `${named} is named in the text`).toContain(named)
      expect(TOOL_NAMES as readonly string[], `${named} is a tool`).toContain(named)
    }
    // ⚑ **It INSTRUCTS and does not DESCRIBE** (HO-015 §2, standing) — so the clauses that would
    // have made it a claim about the system are asserted absent, one by one, rather than left to a
    // reading of the sentence.
    expect(worker).not.toMatch(/routed|delivered to|your parent receives|the app (sends|records)/i)
    expect(worker).not.toMatch(/closes the task|marks the task/i)
    // ⚠️ **And the ONE thing it must not promise**: what silence means. S3 owns that ruling and
    // `393` did not make it — `shared/tasks.ts` says `silent` is not a failure.
    expect(worker).not.toMatch(/if you do not reply/i)
  })

  it('⚑ …and 396’s question sentence shipped with ITS tool, in the bundle every agent receives', () => {
    // 🔴 **`393`'s shape one subject over.** The reply sentence was held until S2 supplied the verb;
    // this one was owed the moment `list_questions` was published, and it is owed MORE loudly: a
    // question raised while a parent was not running reaches it through that tool and nothing else.
    const pm = composeProfileBundle(context())
    // The question sentence is the ask-and-wait skill's now: the tools it names are still the
    // published ones, and the core asks for decisions with ask_question.
    for (const named of ['list_questions', 'answer_question']) {
      expect(TOOL_NAMES as readonly string[], `${named} is a tool`).toContain(named)
    }
    expect(pm).toContain(
      'Ask your questions with ask_question, even to agents; notes expect none. request_action tracks the person's actions. Never guarantee replies.',
    )
    // ⚑ **It INSTRUCTS and does not DESCRIBE** (HO-015 §2): nothing about where a question came
    // from, how it got here, or what the app did with it.
    expect(pm).not.toMatch(/routed|travels|the app (sends|records|delivers)/i)
    // The core names permissions as something to check; it says nothing a child cannot do.
    expect(pm).not.toMatch(/your child(ren)? cannot/i)
  })

  it('⚠️ …and the worker text does not tell a worker it is alone, which is the correction with teeth', () => {
    // 🔴 **HO-015 §2 on `370`'s catch:** *"a worker knows ONLY what you tell it"* would have made a
    // PM under-specify every task, because the PM would believe it was writing for a blank slate.
    // **A false sentence in a PM's instructions becomes a defect in every task it writes.**
    const said = composeProfileBundle(context())
    // What a helper is told it does not inherit is the delegate skill's now; the core still says
    // nothing false about it.
    expect(said).not.toMatch(/knows only what you tell it/i)
    // ⛔ **`370` W8: *"You cannot see other agents' work"* is FALSE** — a child inherits its parent's
    // directory and runs as the same OS user (`364` §1.4).
    expect(said).not.toMatch(/cannot see other agents/i)
    expect(said).toContain('Keep finished files on the piece so agents can find them.')
  })
})

describe('§2 · the common rules reach every agent', () => {
  it('⚠️ every common rule applies to every agent, because none of them is about being a worker', () => {
    const unknown = composeProfileBundle(context())
    // The core's rules about readers reach every agent: whoever it is, it addresses the recipient
    // and keeps the detail on the piece.
    expect(unknown).toContain('Address the actual reader.')
    expect(unknown).toContain('Keep finished files on the piece so agents can find them.')
    // ⚑ `726` §2a · R92: no rule tells an agent to stay in its folder. The core's folder habit is
    // sampled instead, and the old limit is asserted gone so it cannot drift back.
    expect(unknown).toContain('Use the assigned folder; create one only for saved work.')
    expect(unknown).not.toMatch(/Work inside your working directory/)
    expect(unknown).toContain(APPROVALS_ARE_THE_PERSONS)
  })
})

describe('§3 · the dynamic layer moves when the data moves', () => {
  it('says the four resolved permissions and the current-rule qualification', () => {
    const text = thisConversationText(context({ capabilities: DEFAULT_CAPABILITIES }))
    expect(text).toContain(
      "As of this launch, for BroCrew's agent tools (the tools always check the current rules):",
    )
    expect(grantLines(text)).toEqual(expectedPermissions(DEFAULT_CAPABILITIES))
  })

  it('says the reach of each tool route without extending giving-work permission', () => {
    for (const value of MESSAGING_REACH) {
      const capabilities = { ...DEFAULT_CAPABILITIES, canMessage: value, canAssignWork: value }
      expect(grantLines(thisConversationText(context({ capabilities })))).toEqual(
        expectedPermissions(capabilities),
      )
      expect(capabilityField('canMessage').help).toContain(MESSAGING_REACH_ADMITS[value])
      expect(capabilityField('canAssignWork').help).toContain(ASSIGNMENT_REACH_ADMITS[value])
    }
    expect(ASSIGNMENT_REACH_ADMITS.any).not.toBe(MESSAGING_REACH_ADMITS.any)
    expect(ASSIGNMENT_REACH_ADMITS.any).not.toContain('whoever started it')
  })

  it('an unknown identity gets no invented permission', () => {
    const none = thisConversationText(context({ capabilities: null }))
    expect(none).toContain(GRANTS_HEADING)
    expect(none).toContain(
      "The app cannot identify this conversation's profile, so it cannot list its permissions. Read each tool's response.",
    )
    expect(none).not.toContain('As of this launch, for')
    expect(grantLines(none)).toEqual([])
    const known = thisConversationText(context({ capabilities: DEFAULT_CAPABILITIES }))
    expect(grantLines(known)).toEqual(expectedPermissions(DEFAULT_CAPABILITIES))
  })

  it('🔴 the parent is named by the piece it owns, rendered as provenance and not as delegation', () => {
    // ⚑ **D-016 · commit 7 · R3** — the parent as a sentence names it: its agent's name and the
    // piece it owns, never its id (the label is the address every door that takes an agent takes).
    const parent = theConversationCalled('Ada', { label: 'W1', title: 'Bakery website' })
    const said = thisConversationText(context({ startedBy: parent }))
    // ⛔ **`370` §3.1 / HO-015 §3**: provenance, which is durable and true, rather than delegation,
    // which is neither.
    expect(said).toContain(`- This conversation was started by ${parent}.`)
    expect(said).not.toMatch(/It gave you this task/)
    expect(said).not.toMatch(/who you report to/)
    // 🔴 **And `373` is why the second sentence exists at all.** `370`'s recommended cold-resume
    // wording — *"no agent currently commands this session"* — is stale: `resumeSession` re-derives
    // `commandedBy` from the provenance row, so a parent commands its child across a restart.
    expect(said).toMatch(/can still do so after this app has been restarted/)
    expect(said).not.toMatch(/no agent currently commands/i)
  })

  it('⛔ a conversation nobody spawned gets no parent paragraph — the paired negative', () => {
    // ⚑ **D-024 · R1 — asked of this conversation's own text**, where the paragraph is rendered:
    // the file carries no parent line for anybody, so a negative asked of it would pass vacuously.
    expect(thisConversationText(context({ startedBy: null }))).not.toMatch(/was started by/)
  })

  it('⛔ a conversation this app cannot place says so, rather than borrowing BroBot’s name', () => {
    // 🔴 **Found reviewing this dispatch's own diff.** An ADOPTED row carries no profile id and is
    // reopened in the DEFAULT profile's home — so the tempting fold is `?? DEFAULT_PROFILE_ID`.
    // ⛔ The slot keeps the null, so `341`'s and `374`'s rails treat such a session as an identity
    // they cannot name: printing BroBot's name would give it an identity every gate denies it.
    const nameless = thisConversationText(context({ profileSlug: null }))
    expect(nameless).not.toContain('You are running as the profile')
    expect(agentPreamble({ profileSlug: null }).startsWith('You are an agent in BroCrew,')).toBe(
      true,
    )
    expect(nameless).not.toContain('`default`')
    // ⚑ The pair, one fact over.
    expect(
      agentPreamble({ profileSlug: 'default' }).startsWith(
        'You are an agent with the profile default, in BroCrew,',
      ),
    ).toBe(true)
  })

  it('⚑ the configured layer is a SEAM: nothing supplied renders no heading at all', () => {
    // ⚠️ **Slice 5 owns the editor** (HO-009 §8). ⛔ An empty heading would be 086 in the other
    // direction — a section that says a person has written rules when they have not.
    expect(composeProfileBundle(context())).not.toMatch(/## Your own instructions/)
    expect(composeProfileBundle(context({ configured: '   ' }))).not.toMatch(
      /## Your own instructions/,
    )
    const supplied = composeProfileBundle(context({ configured: 'Never use force-push.' }))
    expect(supplied).toMatch(/## Your own instructions/)
    expect(supplied).toContain('Never use force-push.')
    // ⛔ **factory BEFORE configured BEFORE dynamic** — HO-009 §2's order, asserted by position.
    expect(supplied.indexOf('## How you work')).toBeGreaterThan(-1)
    expect(supplied.indexOf('## How you work')).toBeLessThan(
      supplied.indexOf('## Your own instructions'),
    )
    // 🔴 **D-024 · R1 — the dynamic layer is not in the file any more**, so the second half of the
    // order is decided ACROSS the two compositions: `composeSystemHint` appends this conversation's
    // own block LAST, after every file. ⚑ Asserted on the string Claude's adapter is handed
    // (`SessionLaunchRead.systemHint`), published and read back exactly as a launch does it — and
    // every anchor is asserted PRESENT first, since `indexOf`'s −1 is "before" everything.
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
        // ⚠️ The chain stops below `home`, so nothing outside this scratch directory is read.
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
      // ⚑ **A common rule, whichever one** — `497` swapped *"Never merge"* out when HO-035 withdrew
      // it. What this line is for is that the leaf carries the FACTORY half at all, not which rule.
      // `726` §2a · R92 replaced the *"Work inside your working directory"* rule this line sampled
      // with a habit, and the line samples the habit.
      expect(readFileSync(published.path, 'utf8')).toContain(howYouWork(false))
    }
    // 🔴 **Codex's is `AGENTS.override.md` and Claude's is NOT `CLAUDE.md`.** `362` §1.1 measured
    // that `<CLAUDE_CONFIG_DIR>/CLAUDE.md` is the file the AGENT writes and this reader already
    // treats as `profile-memory`; publishing over it would overwrite an agent's memory once a
    // launch — HO-009 §2.2's instruction drift with the writer reversed.
    expect(BUNDLE_LEAF.codex).toBe(AGENTS_OVERRIDE_FILENAME)
    expect(BUNDLE_LEAF.claude).not.toBe('CLAUDE.md')
  })

  it('🔴 the leaf is never empty, which is what Codex’s first-nonempty rule requires', () => {
    // ⚠️ **`362` §2's live matrix**: an EMPTY profile-global override does not shadow `AGENTS.md` —
    // it falls through — so a bundle that could compile to nothing would silently stop being the
    // file the provider reads. ⛔ The header is what guarantees it, and this is the state that has
    // nothing else in it: no role, no project, no parent, no grants.
    const bare = composeProfileBundle(context())
    expect(bare.trim().length).toBeGreaterThan(0)
    expect(bare.startsWith(BUNDLE_MARKER)).toBe(true)
    // ⚑ **583 · `false`, which is this context's state** — `context()` supplies no configured
    // layer, so the header's second clause takes the arm that does not name a section below it.
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
    // ⛔ **Their bytes are exactly as they were.** HO-016: *"Someone put that file there on purpose;
    // the app disagreeing with them silently is the failure mode."*
    expect(readFileSync(leaf, 'utf8')).toBe(theirs)
  })

  it('⚑ …and the paired positive: a leaf THIS app wrote is replaced', () => {
    // ⚠️ **The one fact over.** Same directory, same name, same call — and the only difference is
    // who wrote what is already there. Without this row the refusal above could be a publisher that
    // refuses everything.
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
    // 🔒 **A link would make the marker read come from wherever it points**, so a planted link to a
    // file whose first line carries the marker would license replacing the link's own name.
    // `publishOwnFile` replaces the NAME rather than writing through it, so the target is never
    // written either way — but deleting a person's link without telling them is the same silence.
    mkdirSync(home, { recursive: true })
    const target = join(home, 'somewhere-else.md')
    writeFileSync(target, `${bundleHeader(false)}\nnot really ours\n`)
    const leaf = join(home, BUNDLE_LEAF.codex)
    symlinkSync(target, leaf)
    expect(publishProfileBundle('codex', home, composeProfileBundle(context())).ok).toBe(false)
    expect(lstatSync(leaf).isSymbolicLink()).toBe(true)
  })

  it('🔴 the refusal reaches the drawer as a row with a reason — on BOTH providers', () => {
    // ⛔ **HO-016 as `377` §6 cites it: *"the refusal is SURFACED TO A PERSON, not only logged."***
    // `SessionInstructions.refused` is the panel's *"an absence with a reason"* list, and
    // `SessionInstructions.vue` draws every row in it.
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
      // ⚠️ The temp directory has no `.git` anywhere above it that this walk should reach; the home
      // argument is elsewhere, so the only stop is the filesystem root.
      expect(codexConventionChain(orphan, '/nowhere').at(-1)).toBe(orphan)
    } finally {
      rmSync(orphan, { recursive: true, force: true })
    }
  })

  it('🔒 a git root at or above HOME does not open the door 170 §4 closed', () => {
    // ⛔ **The bridge must not become a second answer to *how far up do we read*.** `170` found
    // BroBot reading a person's own `~/.claude/CLAUDE.md` into a prompt; the chain has excluded home
    // and its ancestors ever since, and this walk is filtered by the same predicate.
    const deep = join(root, 'inner')
    mkdirSync(deep, { recursive: true })
    expect(codexConventionChain(deep, root)).toEqual([deep])
  })

  it('🔴 an override shadows AGENTS.md in its directory — even when it is EMPTY', () => {
    // ⚠️ **`362` §2 corrected the premise everyone was working from.** At a PROJECT directory the
    // candidate is selected before its content is read, so an empty override contributes nothing AND
    // suppresses the ordinary file. ⛔ That is the opposite of the profile-global pair, which is
    // first-NONEMPTY, and conflating the two is the mistake `362` exists to correct.
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
    // ⚑ **The pair, one fact over**: remove the override and the ordinary file is selected.
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
    // 🔴 **`364` §2.3**: putting repo bytes in Codex's global override, or echoing them through
    // `developerInstructions`, gives Codex the copy AND its own native read — *"costs context on
    // every request, may bias the model through repetition, and can leak project A's conventions
    // through a global profile used in project B."*
    writeFileSync(join(root, AGENTS_FILENAME), 'MARKER_REPO_BYTES')
    const providerHome = mkdtempSync(join(tmpdir(), 'brobot2-377-ph-'))
    const bundle = publishProfileBundle('codex', providerHome, composeProfileBundle(context()))
    const read = readSessionInstructions({
      provider: 'codex',
      cwd: root,
      providerHome,
      bundle,
      // ⚑ **D-024 · R1 — as a launch reads it**, with this conversation's own text composed: that
      // is the one text this app now sends Codex, so it is where a copy would ride.
      thisConversation: thisConversationSpans(context({ cwd: root })),
      home: '/nowhere',
    })
    expect(read.instructions.injected).toEqual([])
    // 🔴 **D-024 · R1 — …and what IS sent carries none of the bytes.** It rides the first message
    // of the life and never a system hint; asserted non-empty first, so the negative measures.
    expect(read.systemHint).toBeNull()
    expect(read.firstTurnLead).toContain('## This conversation')
    expect(read.firstTurnLead).not.toContain('MARKER_REPO_BYTES')
    // ⛔ …and the bytes are not in the durable leaf either.
    expect(readFileSync(join(providerHome, BUNDLE_LEAF.codex), 'utf8')).not.toContain(
      'MARKER_REPO_BYTES',
    )
    // ⚑ The paired positive from the other engine, so the empty list above is a decision rather
    // than a walk that found nothing.
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
    // `364` §2.3: *"compose root to cwd and, within each directory, place the selected shared
    // `AGENTS` file before plain `CLAUDE.md` and then `.claude/CLAUDE.md`. That keeps deeper scope
    // later while making Claude-only prose an explicit same-depth overlay."*
    writeFileSync(join(root, AGENTS_FILENAME), 'shared conventions')
    writeFileSync(join(root, 'CLAUDE.md'), 'claude only')
    const read = readSessionInstructions({
      provider: 'claude',
      cwd: root,
      providerHome: mkdtempSync(join(tmpdir(), 'brobot2-377-ph-')),
      home: '/nowhere',
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
    // ⛔ **Two files, one directory apart, with opposite owners** — and the panel labels them
    // differently for 086's reason. The agent's file is untouched by the publish.
    expect(readFileSync(join(providerHome, 'CLAUDE.md'), 'utf8')).toBe(
      'what the agent wrote about itself',
    )
  })
})

/**
 * 🔴 **§8 · the seam is called with the SAME context on both paths** — a fresh launch and a cold
 * resume.
 *
 * ⛔ **This is the section `370` measured missing and `362` measured mattering.** The reader is
 * called *"on start AND on resume"*, and until this dispatch it was called with three arguments that
 * say nothing about who is launching. ⚠️ **A resume that built a poorer context would be invisible
 * to every other test in this file**, because they all ask the compiler directly.
 */
class ContextWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ContextWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **The whole point of the section**: what the host hands the reader, captured verbatim.
      readInstructions: (provider, cwd, providerHome, ctx) => {
        seen.push(ctx)
        const bundle = publishProfileBundle(
          provider,
          providerHome,
          composeProfileBundle(ctx, provider),
        )
        // 🔴 **D-024 · R1 — `main/index.ts` composes this conversation's own text beside the file**
        // and hands it on where the reader says it rides; a copy of that call without it would
        // read every launch here as one no launch builds.
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
    // ⚠️ **D-016 took the project it also carried** — the context has no project, and the factory
    // text no project lines.
    await personOpens(DEFAULT_PROFILE_ID)
    const ctx = seen.at(-1) as InstructionContext
    expect(ctx.profileSlug).toBe(DEFAULT_PROFILE_ID)
    expect(ctx.startedBy).toBeNull()
    // 🔴 **485 · the FIRST launch carries the grants its own row is about to hold.** ⛔ This
    // assertion used to be `expect(ctx.capabilities).toBeNull()` with *"there is nothing to
    // state"* above it, and the sentence that justified it — *a first conversation really may do
    // nothing through these tools* — was false from `409` onward: `onRegistered` runs the `INSERT
    // OR IGNORE` before `pumpEvents`, so the row exists before anything can ask.
    //
    // ⚠️ **The ordering is unchanged and is asserted here**: the store still answers nothing at
    // the moment the reader is called. What moved is what the reader does with that.
    // ⚑ **D-014 · one default set, the same for every agent** — no code seeds a column for any
    // identity, so what a first launch is told is the ruled defaults.
    expect(ctx.capabilities).toEqual(DEFAULT_CAPABILITIES)
    // ⚑ **D-024 · R1 — the grants are said in this conversation's own text**, composed from the
    // same context the host handed the reader; the profile's file carries none of them.
    expect(thisConversationText(ctx)).toMatch(/What you may do/)
    // ⛔ **And the row written under it agrees, by two different derivations** — a SQL round-trip
    // through `readCapabilities` over an all-NULL row against the ruled defaults. ⚑ Without this
    // the fallback would be a guess that happened to look right.
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)).toEqual(ctx.capabilities)
  })

  it('🔴 …and a row a person narrowed OUTRANKS the fallback — standing rule 11, at the reader', async () => {
    // ⛔ **The hazard this fallback creates and the reason it is `??` rather than a merge.** A
    // launch-time default that could overwrite a stored row would re-grant what a person removed,
    // which is the one thing standing rule 11 forbids — and it would do it invisibly, in the text
    // rather than in the database.
    const first = await personOpens(DEFAULT_PROFILE_ID)
    await host.close(first, window)
    // ⚑ **D-014 · the narrowing is on a grant that survived** — `canSpawn` and `canStaff` are gone.
    // ⚑ **What this test is about is untouched**: it is the fallback losing to a stored row.
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' })).toBe(true)
    await personOpens(DEFAULT_PROFILE_ID)
    const ctx = seen.at(-1) as InstructionContext
    expect(ctx.capabilities?.canMessage).toBe('none')
    // ⚑ **And the fallback is what it was narrowed FROM**, so this is a comparison rather than an
    // assertion about a grant that was narrow all along.
    expect(DEFAULT_CAPABILITIES.canMessage).toBe('any')
    // ⚑ **D-024 · R1 — two texts, each asked for its own layer**: the narrowed grant LINE is in
    // this conversation's own text, and the delegation rule it bounds is factory text in the file.
    const said = thisConversationText(ctx)
    expect(said).toContain('- You may not send messages to other conversations.')
    const file = composeProfileBundle(ctx)
    expect(file).toContain('hand off separable, noisy work')
    expect(file).toContain('Follow current permissions, tool contracts and refusals.')
  })

  it('⚑ …and the app-wide spawn switch reaches the context, both ways', async () => {
    // 🔴 **HO-031 §0's third row.** ⛔ It is not a grant and cannot be read out of
    // `CAPABILITY_FIELDS`; the host reads `app_policy` and hands it over, and a launch that did
    // not would leave the disclosure unreachable however well `composeProfileBundle` renders it.
    // ⚑ **D-024 · R1 — the disclosure is in the grant section, which is this conversation's own
    // text now** ({@link thisConversationText}); the file's context carries no switch at all.
    await personOpens(DEFAULT_PROFILE_ID)
    expect((seen.at(-1) as InstructionContext).spawningEnabled).toBe(true)
    expect(thisConversationText(seen.at(-1) as InstructionContext)).not.toContain(SPAWNING_OFF)
    expect(host.setSpawningEnabled(false)).toEqual({ spawningEnabled: false })
    await personOpens(DEFAULT_PROFILE_ID)
    const ctx = seen.at(-1) as InstructionContext
    expect(ctx.spawningEnabled).toBe(false)
    expect(thisConversationText(ctx)).toContain(SPAWNING_OFF)
  })

  it('⛔ …and a first launch of an identity the app insists on NOTHING for gets the ruled values', async () => {
    // ⚑ **The paired control, one identity over.** Since D-014 no identity is seeded anything, so
    // an identity that is not BroBot resolves to the same ruled defaults.
    await personOpens('a-fresh-one')
    const ctx = seen.at(-1) as InstructionContext
    expect(ctx.capabilities).toEqual(DEFAULT_CAPABILITIES)
    expect(ctx.capabilities?.canWriteRules).toBe('none')
    expect(store.capabilitiesOf('a-fresh-one')).toEqual(ctx.capabilities)
    // ⛔ **So the grant section says `none` on the line a model reads**, which is a real answer and
    // not the absence this branch used to render.
    expect(thisConversationText(ctx)).toContain(
      "- You may not change or propose other agents' standing rules.",
    )
  })

  it('⛔ …and the SECOND launch of the same identity does carry them — the paired positive', async () => {
    const first = await personOpens(DEFAULT_PROFILE_ID)
    await host.close(first, window)
    await personOpens(DEFAULT_PROFILE_ID)
    const ctx = seen.at(-1) as InstructionContext
    expect(ctx.capabilities?.canMessage).toBe('any')
    expect(thisConversationText(ctx)).toMatch(/You may message any conversation\./)
  })

  it('🔴 a child a GIVE started is told its parent — and is told the same thing after a restart', async () => {
    // ⛔ **The divergence.** `370`'s recommendation was a DIFFERENT sentence on the resume path,
    // because `commandedBy` came back null; `373` fixed that, and HO-015 §4 refused to ship the
    // sentence describing the defect. This is the assertion that the two paths now agree.
    // ⚠️ **Both identities have to EXIST first** — `341` criterion 12: an identity exists once a
    // conversation has run as it, so `setCapabilities` answers false for a slug nobody has opened.
    // ⚑ **D-014 · no grant to write first**: any agent may start a conversation as any identity
    // that exists. ⚑ **D-016 · a give is what starts one**, with its brief as the child's first turn.
    await host.close(await personOpens('worker'), window)
    await host.close(await personOpens(DEFAULT_PROFILE_ID), window)
    const pm = await personOpens(DEFAULT_PROFILE_ID)
    const pmTools = handed.at(-1) as AgentToolset
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The text',
      brief: 'the text this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started).toBe(true)
    const child = given.agent as string
    // ⚑ **D-016 · commit 7 · R3 — the parent is named by the piece it owns**: the root the child's
    // piece hangs under, and never its id.
    const pmIsCalled = host.nameByItsWork(pm)
    const theRootItGaveFrom = (given.label as string).split('.').slice(0, -1).join('.')
    expect(pmIsCalled).toContain(`the owner of ${theRootItGaveFrom}`)
    const atLaunch = seen.at(-1) as InstructionContext
    expect(atLaunch.startedBy).toBe(pmIsCalled)
    expect(atLaunch.startedBy).not.toContain(pm)

    // A restart: the ledger survives and the slots do not.
    for (const built of hosts) await built.closeAll()
    host = buildHost()
    seen = []
    await host.resumeSession(child, new Sink('webContents:2'))
    const atResume = seen.at(-1) as InstructionContext
    expect(atResume.startedBy, 'the resumed child forgot its parent').toBe(pmIsCalled)
    // ⚑ **And the whole rendered paragraph is the same one**, which is stronger than the field: a
    // second construction of this object is where two answers to *what is this conversation* come
    // apart, and only the fresh one is ever seen by a person. ⚑ **D-024 · R1 — rendered in this
    // conversation's own text**, composed again at the resume; the file never carries it.
    expect(thisConversationText(atResume)).toContain(
      `This conversation was started by ${pmIsCalled}.`,
    )
    expect(atResume.profileSlug).toBe(atLaunch.profileSlug)
  })
  it('🔴 W4.175 · a giver is named by its own piece it started the child from — never by its work now, and with no mark', async () => {
    // ⚑ **The rule an agent's record names a starter by** (`whoStartedIt`), now on the launch line
    // too: a giver whose work has moved on since it started this conversation is not named by the
    // newer work, nor with *"(and 1 more)"* beside it.
    await host.close(await personOpens('worker'), window)
    await host.close(await personOpens('helper'), window)
    await host.close(await personOpens(DEFAULT_PROFILE_ID), window)
    const pm = await personOpens(DEFAULT_PROFILE_ID)
    const pmTools = handed.at(-1) as AgentToolset
    const first = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Build the pages',
      brief: 'build the pages',
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const worker = first.agent as string
    const workerTools = handed.at(-1) as AgentToolset
    const second = await callOn(workerTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'helper',
      title: 'Check the pages',
      brief: 'check the pages',
      piece: first.label,
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    expect(second.started).toBe(true)
    const helper = second.agent as string
    const byThePieceItGaveFrom = theConversationCalled(host.whatToCallTheConversation(worker), {
      label: first.label as string,
      title: 'Build the pages',
    })
    // ⚑ At the first launch, before the give is written down: the give's own piece.
    expect((seen.at(-1) as InstructionContext).startedBy).toBe(byThePieceItGaveFrom)

    // ⚑ The giver's work moves on: a second piece, so it is named now by that one, with a mark.
    const third = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Write the copy',
      brief: 'write the copy',
    })
    expect(third.outcome, JSON.stringify(third)).toBe('ok')
    expect(host.nameByItsWork(worker)).toContain('(and 1 more)')
    expect(host.nameByItsWork(worker)).not.toBe(byThePieceItGaveFrom)

    // ⛔ …and a launch after a restart still names it by the piece it started this one from.
    for (const built of hosts) await built.closeAll()
    host = buildHost()
    seen = []
    await host.resumeSession(helper, new Sink('webContents:2'))
    const atResume = seen.at(-1) as InstructionContext
    expect(atResume.startedBy).toBe(byThePieceItGaveFrom)
    expect(thisConversationText(atResume)).toContain(
      `This conversation was started by ${byThePieceItGaveFrom}.`,
    )

    // ⚑ A first launch with no piece to name it by — a replacement's, started by a delivery — names
    // the starter alone, ⚑ and a root owner by its root still.
    const calledFor = (starter: string): string =>
      (
        host as unknown as {
          theStarterCalled(starter: string, conversation: null, from: null): string
        }
      ).theStarterCalled(starter, null, null)
    expect(calledFor(worker)).toBe(host.whatToCallTheConversation(worker))
    expect(calledFor(pm)).toBe(host.nameByItsWork(pm))
    expect(calledFor(pm)).toContain(`the owner of ${store.rootOf(pm)?.label ?? '?'}`)
  })

  /**
   * 🔴 **402 · the instruction this app gave and then refused** — put on the path the code walks,
   * so the two halves are measured on ONE machine rather than reasoned about across two files.
   *
   * ⛔ **The live sequence this reproduces, from `399`'s own evidence** (Codex, `gpt-5.6-sol`,
   * `/private/tmp/brobot2-resume-smoke/2026-09-10T01-07-32-627Z-13823`): the model read the bundle,
   * said *"I’m delegating the file write to the project manager, as required by the workspace
   * instructions"*, called `spawn_agent`, and was told **`not-in-can-spawn` ·
   * `until-a-person-changes-it` · `retryable: false`**. `smoke:resume` then failed for a marker file
   * that no agent was ever permitted to write.
   *
   * ⚠️ **The paired case is the same machine one switch later**, which is what makes this a
   * measurement rather than a screenshot: the text says spawning is off exactly when the rail
   * starts refusing. ⚑ **D-014 re-aimed it** — the per-identity spawn grants and
   * `not-in-can-spawn` are gone, and any agent may start a conversation as any identity that
   * exists, so the app-wide switch is what is left that moves the rail and the text together.
   */
  it('🔴 the shared delegation rule stays conditional while the spawn rail reads the current switch', async () => {
    // 1 · the identities the text is about to tell BroBot to delegate to have to EXIST (341
    // criterion 12). ⛔ **Not decoration**: without a row the give in step 2 is refused
    // `no-such-profile` (D-016 · R3), and this test would stop measuring the switch it exists for.
    // ⚑ **Two of them, because the switch refuses only a give that would START a conversation**
    // (D-016, ruling 12): a second give to the first would reach the conversation BroBot already has
    // with it, so step 3 gives to one BroBot has none with.
    for (const slug of [PROJECT_MANAGER_PROFILE_ID, 'reviewer']) {
      expect(
        store.createAgentIdentity(
          { slug, displayName: null, provider: null },
          { by: 'an-agent', agent: DEFAULT_PROFILE_ID },
        ),
      ).not.toBeNull()
    }

    // 2 · BroBot, as a fresh install ships it: the delegation rule is in its text, and nothing in
    // the text says spawning is off.
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const launched = seen.at(-1) as InstructionContext
    // ⚑ **D-024 · R1 — the rule is factory text in the profile's file, and the switch is said in
    // this conversation's own grant section**, so each half is asked of the text that carries it.
    const told = composeProfileBundle(launched)
    expect(told).toContain('hand off separable, noisy work')
    expect(told).toContain('Follow current permissions, tool contracts and refusals.')
    expect(thisConversationText(launched)).not.toContain(SPAWNING_OFF)

    // …and the rail agrees, on this identity, through the tool the model actually calls.
    // ⚠️ **BroBot's OWN toolset, held in a name**: an admitted `give_work` LAUNCHES the child,
    // which pushes the CHILD's toolset onto `handed`, so a second `handed.at(-1)` would ask the
    // child rather than BroBot.
    const brobotTools = handed.at(-1) as AgentToolset
    const admitted = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: PROJECT_MANAGER_PROFILE_ID,
      title: 'The delegation',
      brief: 'the delegation the text instructs',
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(admitted.started).toBe(true)

    // 3 · **one switch later — a person's decision — and BOTH move together.**
    expect(host.setSpawningEnabled(false)).toEqual({ spawningEnabled: false })
    const refused = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'reviewer',
      title: 'The delegation',
      brief: 'the delegation the text no longer instructs',
    })
    expect(refused.outcome).toBe('refused')
    expect(refused.rail).toBe('spawning-disabled')
    // ⛔ **Permanent and not retryable**, which is why "it will work later" is not a reading of the
    // red: an instruction refused this way is refused for every turn until a person acts.
    expect(refused.permanence).toBe('until-a-person-changes-it')
    expect(refused.retryable).toBe(false)

    // ⚑ **The next launch is told so, in the rail's own words**, and the delegation rule stays
    // conditional rather than being withdrawn.
    await personOpens(DEFAULT_PROFILE_ID)
    const relaunched = seen.at(-1) as InstructionContext
    expect(thisConversationText(relaunched)).toContain(SPAWNING_OFF)
    expect(composeProfileBundle(relaunched)).toContain(
      'Follow current permissions, tool contracts and refusals.',
    )
    expect(brobot).toBeTruthy()
  })
})

/** PE-003: instructions follow the work and the grants — every agent gets one bundle (D-014). */
describe('§9 · one agent instruction set', () => {
  it('keeps delegation, handover and profile sizing together for every agent', () => {
    // ⚑ **D-014 · every agent gets one bundle**, so one composition is every agent's.
    const said = composeProfileBundle(context())
    expect(said).toContain(
      'A specialist may keep work that is small, tightly connected, covered by an exact installed procedure, or cheaper to do than hand off.',
    )
    expect(said).toContain(
      'Keep the judgement and hand off separable, noisy work when the saved time or expertise justifies coordination.',
    )
    expect(said).toContain('Respect locked choices.')
    expect(said).toContain('State how to check it; give the next agent enough context.')
    // ⚑ F078 — this app's agents, never the provider's own sub-agents.
    expect(said).toContain(
      'Prefer visible BroCrew agents to provider sub-agents, whose work cannot be revisited here.',
    )
    expect(said).toContain('Choose a supported model and offered effort at each handoff')
  })

  it('says the same core whatever the grants: what an agent may do is said under its own heading', () => {
    const narrow = {
      ...DEFAULT_CAPABILITIES,
      canMessage: 'none' as const,
      canWriteRules: 'none' as const,
    }
    const wide = {
      ...narrow,
      canMessage: 'any' as const,
      canWriteRules: 'relay' as const,
    }
    const proposing = { ...wide, canWriteRules: 'propose' as const }
    const none = composeProfileBundle(context({ capabilities: narrow }))
    const some = composeProfileBundle(context({ capabilities: wide }))
    const asksApproval = composeProfileBundle(context({ capabilities: proposing }))
    expect(none).toContain(howYouWork(false))
    expect(some).toBe(none)
    expect(asksApproval).toBe(none)
    // The grants move what this conversation is told it may do, which is where they belong.
    const told = (capabilities: ProfileCapabilities): string =>
      thisConversationText({ ...context(), capabilities })
    expect(told(narrow)).toContain('- You may not send messages to other conversations.')
    expect(told(wide)).toContain('- You may message any conversation.')
    expect(told(proposing)).toContain(
      "- You may propose other agents' standing rules; the person must approve before they are saved.",
    )
  })
})
// ─────────────────────────────────────────────────────────────────────────────────────────────
// §10 · 485 · what am I allowed to do — every grant, said BY the grant
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **Values for one capability, derived from the field's own `editor` rather than typed per key**
 * (485).
 *
 * ⛔ **The brief asked for a test that fails when a new grant is added and is not rendered, and
 * *exhaustive over the shape, not a list you typed*.** A table keyed by capability would be the
 * defect this dispatch removed, rebuilt in the test that guards it. ⚑ `editor` is the closed
 * vocabulary that decides how a value is SHAPED, so a ninth grant of an existing kind is covered
 * the day it lands and a NEW kind is a compile error on the `never` below.
 *
 * ⚠️ **None of them is `ruled` or `narrowest`**, deliberately: on several fields those two are the
 * same value, so a pair drawn from them would compare a thing with itself and measure nothing
 * (`a-comparison-tested-where-both-sides-agree-measures-nothing`).
 *
 * 🔴 **Each COMPONENT of a value varies on its own, and that is what makes the distinctness test
 * bite** — a sentence that printed one part of a value and dropped another would still move under
 * a pair that changed both. ⚑ D-014 left two kinds, a count and a word, and each is one part.
 */
function valuesFor(field: AnyCapabilityField): readonly unknown[] {
  switch (field.editor) {
    case 'count':
      return [0, 7]
    case 'choice': {
      // ⚑ **A cast at the read and not at the declaration.** `vocabulary` is typed to each field's
      // own value type, so the union of them is not one array type; what this needs is the whole
      // closed list, and `an-enumeration-whose-members-must-differ-needs-a-distinctness-check` is
      // why its length is asserted rather than assumed.
      const words = field.vocabulary as readonly string[] | undefined
      expect(words, `${field.key} is a choice with no vocabulary`).toBeDefined()
      const said = words as readonly string[]
      expect(said.length, `${field.key}'s vocabulary has nothing to compare`).toBeGreaterThan(1)
      return said
    }
    default: {
      // ⛔ **A new editor kind does not compile until it has been given values**, which is the
      // same forcing function `says` itself is.
      const unreached: never = field.editor
      throw new Error(`no values for the ${String(unreached)} editor`)
    }
  }
}

/** The narrowest and the widest of {@link valuesFor}, for a test that moves one thing. */
function endsOf(field: AnyCapabilityField): readonly [unknown, unknown] {
  const values = valuesFor(field)
  return [values[0], values[values.length - 1]]
}

/**
 * One capabilities object with a single field moved.
 *
 * ⚠️ **One cast, here.** A computed key over a union of value types cannot be checked by the
 * compiler; every value handed in comes from {@link twoValuesFor}, which is driven by the same
 * field's own `editor`.
 */
function withField(
  base: ProfileCapabilities,
  field: AnyCapabilityField,
  value: unknown,
): ProfileCapabilities {
  return { ...base, [field.key]: value } as ProfileCapabilities
}

/**
 * The grant section alone — the part of the text §10 is about. ⚑ **D-024 · R1 — it is in this
 * conversation's own text** ({@link thisConversationText}) and never in the profile's file, and it
 * is still the last section of what it is in, so the slice below ends where the grants do.
 */
function grantsIn(said: string): string {
  const at = said.indexOf(GRANTS_HEADING)
  expect(at, 'the text has no grant section').toBeGreaterThan(-1)
  return said.slice(at)
}

/** Every rendered grant line, in order. */
function grantLines(said: string): string[] {
  return grantsIn(said)
    .split('\n')
    .filter((line) => line.startsWith('- ') && line !== SPAWNING_OFF)
}

/**
 * 🔴 **The placement {@link context} composes at** — a conversation a person started, HO-005 §2
 * Q3's depth `0` (544).
 *
 * ⛔ **Named rather than written `{ depth: 0 }` at each site**, because every assertion below that
 * compares a bundle line against {@link grantSays} has to ask the SAME question the bundle asked;
 * a site that drifted to `null` would compare an instruction against a grant sheet and pass on
 * eight of the nine fields.
 */
const AT_A_PERSONS_OWN_CONVERSATION: ConversationAtLaunch = { depth: 0 }

describe('§10 · a grant says its own value, and every grant says one', () => {
  it('🔴 every capability answers the question, and answers it with something', () => {
    // ⛔ **Required and not optional, which is the whole forcing function** — the same argument
    // `470` made for `whenItTakesEffect`, and the compile-error gate `CAPABILITY_VALUES` used to
    // provide. ⚠️ A grant with no sentence would render as a label, a colon and nothing, which
    // reads as a value this app failed to produce rather than as the narrowest one there is.
    for (const field of CAPABILITY_FIELDS) {
      expect(field, field.key).toHaveProperty('says')
      expect(typeof field.says, field.key).toBe('function')
      for (const value of valuesFor(field)) {
        // ⚑ **544 · BOTH questions, because a grant that answered only one would ship an empty
        // line to exactly one audience.** ⛔ `null` is the grant a person edits; the placement is
        // what one conversation may do — see {@link ConversationAtLaunch}.
        for (const at of [null, AT_A_PERSONS_OWN_CONVERSATION]) {
          const said = grantSays(field, withField(DEFAULT_CAPABILITIES, field, value), at)
          expect(said, `${field.key} said nothing for ${JSON.stringify(value)}`).not.toBe('')
          expect(said.trim(), `${field.key} said padding`).toBe(said)
        }
      }
    }
  })

  it('🔴 …and it says DIFFERENT values differently, which is the half a layout test cannot see', () => {
    // ⛔ **The line test below compares the bundle against `grantSays`, so it is blind to what
    // `grantSays` returns** — `a-mutation-on-a-census-is-invisible-to-that-census`. ⚑ This is the
    // independent half: whatever the sentence is, two different grants may not produce it.
    //
    // 🔴 **544 · and the question it asks is `null`, deliberately.** ⛔ That is the grant as a
    // sheet would put it, and it must stay injective: two different grants that read the same are
    // a value a person cannot tell they changed. ⚠️ **The LAUNCH rendering is deliberately NOT
    // injective** — at one depth every bound above it produces the same sentence, because the rail
    // produces the same answer — and that is measured on the axes where it does have two answers:
    // `ProfileCapabilities.maxDepth`'s own `says` says why, the test below moves the grant across
    // the boundary, and `what-a-chain-is-told-about-its-own-depth.test.ts` moves the conversation.
    //
    // 🔴 **And the values move one component at a time** ({@link valuesFor}), so a sentence that
    // renders half of what it was handed is caught rather than passed over.
    for (const field of CAPABILITY_FIELDS) {
      const said = new Map<string, unknown>()
      for (const value of valuesFor(field)) {
        const sentence = grantSays(field, withField(DEFAULT_CAPABILITIES, field, value), null)
        const clash = said.get(sentence)
        expect(
          clash,
          `${field.key} says the same thing for ${JSON.stringify(clash)} and ${JSON.stringify(value)}`,
        ).toBeUndefined()
        said.set(sentence, value)
      }
    }
  })

  it('prints the approved model words for each permission value', () => {
    for (const field of CAPABILITY_FIELDS.filter((field) => field.key !== 'maxDepth')) {
      for (const value of valuesFor(field)) {
        const allowed = withField(DEFAULT_CAPABILITIES, field, value)
        expect(grantLines(thisConversationText(context({ capabilities: allowed })))).toEqual(
          expectedPermissions(allowed),
        )
      }
    }
  })

  it('moves exactly the permission whose resolved value changed', () => {
    const fields = CAPABILITY_FIELDS.filter((field) => field.key !== 'maxDepth')
    for (const field of fields) {
      const [low, high] = endsOf(field)
      const a = grantLines(
        thisConversationText(
          context({ capabilities: withField(DEFAULT_CAPABILITIES, field, low) }),
        ),
      )
      const b = grantLines(
        thisConversationText(
          context({ capabilities: withField(DEFAULT_CAPABILITIES, field, high) }),
        ),
      )
      expect(a).not.toEqual(b)
      expect(a.filter((line, index) => line !== b[index])).toHaveLength(1)
    }
  })

  it('🔴 a grant’s sentence is handed its OWN value and can reach no neighbour', () => {
    // ⛔ **The property the `Record<CapabilityKey, (allowed: ProfileCapabilities) => string>` this
    // replaced could not express.** Every entry in that table was handed the whole object, so
    // `canAssignWork`'s could have rendered `canMessage`'s word and only review would have caught
    // it — `464` in the one place every agent reads. ⚑ `says` takes the field's own value, and
    // this is that promise measured rather than trusted.
    for (const field of CAPABILITY_FIELDS) {
      let low = DEFAULT_CAPABILITIES
      let high = DEFAULT_CAPABILITIES
      for (const other of CAPABILITY_FIELDS) {
        if (other.key === field.key) continue
        const [a, b] = endsOf(other)
        low = withField(low, other, a)
        high = withField(high, other, b)
      }
      // ⚠️ **The premise, asserted**: the two objects really do differ everywhere else. Without it
      // this loop would pass over a builder that had quietly produced one object twice
      // (`a-positive-assertion-must-differ-from-the-default`).
      expect(low, `${field.key}'s neighbours did not move`).not.toEqual(high)
      expect(grantSays(field, low, null), `${field.key} read a neighbour`).toBe(
        grantSays(field, high, null),
      )
    }
  })

  it('⛔ the section no longer claims a PERSON set them, and the bound it carries survives', () => {
    const said = thisConversationText(context({ capabilities: DEFAULT_CAPABILITIES }))
    // 🔴 **HO-015 §2's own class, inside the section written to replace exactly those.** ⚠️ The
    // sentence read *"A person set these."*, and on the identity this app ships it is false in
    // both directions — asserted below rather than argued.
    expect(said).not.toContain('A person set these')
    // ⚑ **`368`'s rule is unchanged**: a protection is disclosed with its limit.
    expect(said).toContain("for BroCrew's agent tools (the tools always check the current rules)")
    // ⛔ **D-014 · no identity is seeded anything**, so every grant a new identity holds is a NULL
    // column nobody has chosen, resolving to `ruled` — which is not a person either.
  })

  it('⚑ the app-wide switch is said only when it is OFF, in the rail’s own words', () => {
    // 🔴 **HO-031 §0's third row, and the one fact the capability shape cannot carry.**
    // `spawning_enabled` is one CHECK-pinned row for the whole app, not a column on an identity —
    // `schema.ts` records that the per-identity alternative was refused as *"N switches and none
    // of them global"*. ⛔ While it is off, the delegation the text instructs is a promise this app
    // will not keep.
    const on = thisConversationText(
      context({ capabilities: DEFAULT_CAPABILITIES, spawningEnabled: true }),
    )
    const off = thisConversationText(
      context({ capabilities: DEFAULT_CAPABILITIES, spawningEnabled: false }),
    )
    // ⚑ **The rail's own sentence and not a second one.** It is what `spawn_agent` answers with at
    // the door, so the two moments cannot come to disagree — and the person's sheet keeps its own
    // wording because its remedy is *the switch is in the rail* and a model has no rail.
    expect(off).toContain(SPAWNING_OFF)
    expect(on).not.toContain(SPAWNING_OFF)
    // ⛔ **And it changes no grant.** The switch is a bound on the grants, not one of them; a line
    // that moved with it would be this dispatch inventing a ninth capability.
    expect(grantLines(off)).toEqual(grantLines(on))
    // ⚠️ **Said in the no-identity branch too**, where there are no grants to bound: a switch that
    // is off is off for a conversation this app cannot place as much as for one it can.
    const nobody = thisConversationText(context({ capabilities: null, spawningEnabled: false }))
    expect(nobody).toContain(SPAWNING_OFF)
  })
})

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

function expectedPermissions(allowed: ProfileCapabilities): string[] {
  return [
    allowed.canMessage === 'any'
      ? '- You may message any conversation.'
      : '- You may not send messages to other conversations.',
    allowed.canAssignWork === 'any'
      ? '- You may give work to any agent, through your own conversation with it.'
      : '- You may not give work to other agents.',
    allowed.canCreateAgents === 'any'
      ? '- You may create agents and give them their initial rules.'
      : '- You may not create agents.',
    {
      none: "- You may not change or propose other agents' standing rules.",
      propose:
        "- You may propose other agents' standing rules; the person must approve before they are saved.",
      relay:
        "- You may propose rules for approval, or save a person's rule for another agent when they gave it in this conversation.",
    }[allowed.canWriteRules],
  ]
}
