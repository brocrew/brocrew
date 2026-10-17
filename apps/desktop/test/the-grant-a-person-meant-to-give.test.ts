import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_FIELDS,
  capabilityField,
  DEFAULT_CAPABILITIES,
} from '../src/shared/capabilities'
import { thisConversationSpans } from '../src/main/runtime/factory-text'

/**
 * 🔴 **464 · the grant a person meant to give** — `460` F1, and the half of it `456` could not have
 * closed because it was not looking at the sheet.
 *
 * ## ⛔ What actually happened, in one paragraph
 *
 * After `setCapabilities` returns successfully, the next governed call in the same live
 * conversation reads the stored grant; there is no post-commit stale-admission window. The
 * grant UI must therefore distinguish the intended capability and identity so a person cannot
 * unknowingly change the wrong one.
 *
 * ## 🔴 The measurement this file exists to make, and it is about `456` rather than about `460`
 *
 * `456` renamed `canSpawn`'s label from *May create agents as* to **May start conversations as**,
 * and pinned that rename in two places: the tool descriptions, and the grant block
 * `factory-text.ts` renders into every agent's instructions — where
 * `the-text-a-child-is-actually-told.test.ts` reads the label out of {@link CAPABILITY_FIELDS}
 * rather than typing it. ⚠️ **Nothing pinned the PERSON's side**, and four sentences a person reads
 * about that same grant went on spelling it with the retired verb:
 *
 *  1. `SPAWN_RAIL_MEANS` — *"A conversation an agent CREATES can never open without prompts"*,
 *     rendered directly above the control.
 *  2. `SPAWN_NATIVE_DELEGATION_MEANS` — *"an identity that MAY CREATE AGENTS"*, which is worse than
 *     stale: with the rename it stopped naming `canSpawn` at all and started reading as the field
 *     one row down, whose label really is *May add new agents*.
 *  3. The sheet's own header — *"enforced when an agent asks to CREATE a conversation"*.
 *  4. `SideRail.vue`'s agent rows — *"May create worker"* — on the surface where a person decides
 *     WHOSE sheet to open, which is the second half of `460`'s finding.
 *
 * ⛔ **Every one of those is a literal.** The one reader that derived the label was the one with a
 * test. 🔴 **So this file is both halves**: §1 sweeps the retired words out of what a person reads,
 * and §2 pins the three surviving renderers to the SCHEMA's label so the next rename goes red here
 * instead of quietly repointing a disclosure at the neighbouring grant.
 *
 * ## ⚠️ D-014 · the grant this file was about is gone, and so are the sections about it
 *
 * ⛔ `canSpawn`, `canStaff`, `SPAWN_NATIVE_DELEGATION_MEANS`, `STARTING_IS_NOT_ADDING`, the sheet's
 * grant picker and its direction line, and the Team card's grant pair were DELETED — any agent may
 * start a conversation as any identity. ⚑ The sweep of the retired verb, the native-delegation
 * disclosure, the roster row's pair and the empty word went with them. **What stays is what still
 * has a subject**: the create verb where it is right, the one pairing of a label with its value
 * and the question each caller asks it, and the owner line — which is one sentence now.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')
const SHEET = join(SRC, 'renderer/src/components/CapabilitiesSheet.vue')
/**
 * ⚑ **570 · the roster row's new home.** `EXT-008` §4.4 took the AGENTS section out of the
 * navigation column; every reading below that was aimed at the rail's agent row is aimed here
 * now, and the FILE is the only thing that moved (standing rule 26: strip AND re-aim).
 */
const TEAM = join(SRC, 'renderer/src/components/TeamWorkspace.vue')
const FACTORY = join(SRC, 'main/runtime/factory-text.ts')
/** ⚑ **485 · the schema, which is where the VALUE's sentence lives now** — see §2. */
const SCHEMA = join(SRC, 'shared/capabilities.ts')

/**
 * ⛔ **Prose first, and this file is the reason the rule exists in its own right here**: every
 * retired string below is QUOTED, verbatim, in the docblock that records why it was retired — in
 * the very files being swept. A census that did not strip comments would report the defect it just
 * removed. (`a-source-census-must-strip-prose-before-it-asserts`.)
 */
function withoutProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

describe('§1 · the create verb stays where it is the right one', () => {
  it('⚠️ the create verb is UNTOUCHED where it is the right one', () => {
    // 🔴 **`456` moved a verb off one act, not out of the app.** Bringing a name into existence is
    // still creating, and a sweep that had taken `creat` out of the rail wholesale would have
    // broken the sentence that tells a person how to give an orphaned folder its row.
    // ⚑ **570 · the sentence moved with the section that carried it.** `EXT-008` §2 named it as
    // prose living in navigation and §3 said where it belongs — *"explanation belongs where the
    // thing is"* — so it is on the Team page's **Other home folders** block now. ⛔ The claim is
    // unchanged: the app must still tell a person how to give an orphaned folder its row.
    // ⚠️ **Whitespace-normalised, and that is not a weakening.** A sentence inside a template is
    // wrapped wherever prettier decides; a person reads it as one line either way, so a census
    // over what a person reads must not be a census over where the formatter broke it.
    const team = withoutProse(readFileSync(TEAM, 'utf8')).replace(/\s+/g, ' ')
    expect(team).toContain('Create one with the same name to give it its row')
    expect(capabilityField('canCreateAgents').label).toBe('May add new agents')
    // ⛔ …and `456`'s own pair still holds, which is what this dispatch was told not to re-invent.
    // ⚠️ **D-014 · its other half is gone** — the grant labelled *May start conversations as* was
    // deleted with every grant on starting — so what remains is that ADDING an agent is never
    // worded as starting a conversation.
    expect(capabilityField('canCreateAgents').label.toLowerCase()).not.toContain('conversation')
  })
})

describe('shared grant labels and the launch permission sentences', () => {
  it('keeps grant-sheet wording and gives the launch its actual grants and depth', () => {
    // 🔴 **485 · this test used to pin one grant's empty word in TWO files, and agreement between
    // two authors is what `464` costs.** ⛔ The expression lives on the descriptor now
    // ({@link CapabilityField.says}), so the assertion is the opposite shape: the schema holds it,
    // and no renderer does.
    //
    // ⚠️ **D-014 · the empty word went with the grant that had one** (`canSpawn`, a list), and the
    // Team card's grant pair — the second reader — went with it. ⚑ What is left is the pairing
    // itself and the question every caller must name, which is what the rest of this test pinned.
    const factory = withoutProse(readFileSync(FACTORY, 'utf8'))
    const schema = withoutProse(readFileSync(SCHEMA, 'utf8'))
    // 🔴 **544 · the third argument is the fact that moved.** ⛔ `grantSays` takes WHICH QUESTION
    // is being asked — `null` for the grant a person edits, a {@link ConversationAtLaunch} for what
    // one conversation may do — so a reader says out loud which audience it is rendering for.
    expect(schema).toContain('`${field.label}: ${grantSays(field, allowed, at)}`')
    expect(factory).toContain('capabilityLines(context.capabilities, { depth: context.depth })')
    //
    // 🔴 **544 · and the DECLARATION, because the call sites cannot carry this one.** ⛔ The whole
    // repair rests on `at` being REQUIRED: a caller that forgot it would get the grant-sheet
    // answer inside an instruction bundle, which is the defect 544 removed arriving through a
    // defaulted argument. ⚠️ **No mutation can measure it** — every call site passes the argument
    // explicitly, so adding `= null` to the signature is a runtime no-op and would report as a
    // survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`). A census is the only
    // instrument that can, so it is here rather than in a row.
    expect(schema).toContain('at: ConversationAtLaunch | null,')
    expect(schema).toContain(
      'readonly says: (held: ProfileCapabilities[K], at: ConversationAtLaunch | null) => string',
    )
    expect(schema, 'the question acquired a default').not.toContain(
      'at: ConversationAtLaunch | null =',
    )
    expect(schema, 'the question became optional').not.toContain('at?: ConversationAtLaunch')
  })

  it('the launch uses the agreed permission sentence rather than the sheet label', () => {
    const factory = withoutProse(readFileSync(FACTORY, 'utf8'))
    const text = thisConversationSpans({
      profileSlug: 'fictional-agent',
      cwd: '/tmp/fictional-work',
      startedBy: null,
      depth: 0,
      capabilities: { ...DEFAULT_CAPABILITIES, canMessage: 'any' },
      spawningEnabled: true,
      root: null,
      others: { shown: [], more: 0 },
    }).text
    expect(text).toContain('- You may message any conversation.')
    expect(text).not.toContain(`${capabilityField('canMessage').label}:`)
    expect(factory).not.toContain('CAPABILITY_VALUES')
    expect(factory).not.toContain('${field.label}: ')
  })
})

describe('§3 · the owner axis, said once and interpolated', () => {
  it('🔴 the header sentence is about the identity whose sheet is open, and names no slug', () => {
    const sheet = withoutProse(readFileSync(SHEET, 'utf8'))
    const header = sheet.slice(
      sheet.indexOf('data-cy="capabilities-owner"'),
      sheet.indexOf('</small'),
    )
    expect(header.length, 'the owner sentence moved').toBeGreaterThan(80)
    // ⛔ **Twice, and both from the prop** — a sentence about *this* identity that had a slug typed
    // into it would be right on one sheet and wrong on every other.
    // ⚑ **Re-aimed by 712 (R41, `707` GAP-5), not stripped**: the sentence NAMES the identity now —
    // `called`, which is `agentName` over the prop — where it printed the slug in `<code>`. So the
    // two places are `{{ called }}`, the slug is gone from the sentence, and `called` is asked of the
    // prop: the property this arm pinned (*from the prop, never typed*) is the one still pinned.
    // ⚑ **D-014 · three** — the second sentence says any agent may start a conversation as it.
    expect(header.match(/\{\{ called \}\}/g) ?? []).toHaveLength(3)
    expect(header).not.toContain('{{ profileSlug }}')
    expect(sheet).toMatch(
      /const called = computed\(\(\) =>\s*agentName\(props\.profileSlug, store\.identities\.value\?\.identities \?\? null\)/,
    )
    // ⚠️ **D-014 · the second sentence is gone** — *"Any other identity named among them is one
    // these grants point at — to change what that one may do, open its own sheet."* It was about
    // the grant picker, which named other identities, and no grant names one now. ⚑ Its place is
    // taken by what D-014 made true of every row: any agent may start a conversation as it.
    expect(header).not.toContain('open its own sheet')
    expect(header).toContain('conversation is running as {{ called }}.')
    expect(header.trim().endsWith('and that conversation holds these grants.')).toBe(true)
  })

  it('⚠️ …and it no longer claims which rails fire when, because some of them do not', () => {
    // 🔴 **The retired half nobody had noticed.** *"Every rail below is enforced when an agent asks
    // to create a conversation"* was written at `355` over a schema of four spawn-shaped fields.
    // ⛔ `canMessage` is spent on a message (`433`, `439`), `takesWorkFrom` on a second caller's
    // work (`440`) and `canCreateProjects` on a proposal (`441`); none is read when anything asks
    // to start a conversation, so the sentence had been false since `440`. ⚠️ `canCreateProjects`
    // left the schema before D-016, and D-016 took `takesWorkFrom`; `canMessage` is still spent on a
    // message.
    const sheet = withoutProse(readFileSync(SHEET, 'utf8'))
    expect(sheet).not.toContain('Every rail below is enforced')
    // ⚑ **Non-vacuity, and the shape of the claim that replaced it**: the row, which is true of all
    // eight fields, rather than the act, which is true of some of them.
    expect(sheet).toContain('’s own row: every grant below is stored on it')
    expect(CAPABILITY_FIELDS.map((field) => field.key)).toContain('canMessage')
  })
})
