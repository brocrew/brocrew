import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRAWER_TABS, TAB_OF_THE_SETTINGS } from '../src/renderer/src/lib/drawer'
import { CHANGEABLE_LIVE_IN, providerIsFixed } from '../src/renderer/src/lib/front-door-words'
import { SUPPORTED_PROVIDERS } from '../../../packages/runtime/src'
import { providerName } from '../src/shared/runtime-ipc'

/**
 * 417 · **The claims the front door's one sentence makes, pinned against the code that makes them
 * true** — and the capability its removal strands, pinned so its return is visible.
 *
 * ⛔ **Standing rule 5: a safety sentence with no test is a comment.** {@link providerIsFixed} says
 * three things a person will act on — this runs on `<provider>`, the model and approvals can be
 * changed later on the agent card, the provider cannot. Each is asserted here against the thing that
 * makes it true, never against the sentence itself, so the day one stops holding the sentence goes
 * red rather than quietly false.
 *
 * ⚠️ **In the node project and not the dom one**, because the subject is main-process source.
 *
 * ## 🔴 What `435` changed here, and what it deliberately did not
 *
 * ⛔ **HO-025 §5 reversed half of HO-022 §2** — *"the front door asks nothing and OFFERS
 * EVERYTHING"* — so the screen draws a provider, a model and a reasoning control again. ⚑ **Every
 * assertion in this file survives that unchanged**, and it is worth saying why rather than leaving
 * a green run to be read as more than it is:
 *
 *  - **§1 is about a RUNNING session** — no `UPDATE provider_session SET provider`, no setter by any
 *    of four names, no command arm carrying both a provider and a session id. A control that
 *    chooses the provider a conversation STARTS on says nothing about any of them, and HO-025 §4 is
 *    explicit that this is the half that stays true: *"Model and effort remain changeable while it
 *    runs. Provider does not."*
 *  - **§2 is about the agent card's two live controls**, which are where a running conversation
 *    changes what it can change.
 *  - **§3 is about which files build a launch and which identity each one may name.** `435` added
 *    no door and moved no identity: the front door still sends `DEFAULT_PROFILE_ID`, and there are
 *    still exactly two builders.
 *
 * ⛔ **So this file is NOT evidence that the front door asks nothing** — it never was, and after
 * `435` the distinction matters. The screen's own vocabulary is enumerated in
 * `dom/a-front-door-that-asks-nothing.dom.test.ts` §1, and what *out of the path* means as four
 * measurements is `dom/a-front-door-that-offers-everything.dom.test.ts`.
 */

const SRC = join(import.meta.dirname, '../src')

/** ⛔ A census that reads prose reads code wrong — a docblock quoting a call is not a call. */
function withoutProse(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** Every file in one of the source trees, code only. */
function tree(root: string): { file: string; code: string }[] {
  return readdirSync(join(SRC, root), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|vue)$/.test(name))
    .map((name) => ({
      file: `${root}/${name.replaceAll('\\', '/')}`,
      code: withoutProse(readFileSync(join(SRC, root, name), 'utf8')),
    }))
}

describe('§1 · "the provider you cannot" — the clause, against the absence that makes it true', () => {
  const main = tree('main')

  it('⛔ no statement anywhere writes `provider` onto a session row that already exists', () => {
    // Search shape: every `UPDATE provider_session` in the main tree, prose stripped, checked for
    // the one column. A positive would read `UPDATE provider_session SET provider = ?`.
    const updates = main.flatMap(({ file, code }) =>
      [...code.matchAll(/UPDATE provider_session SET ([^`'"]+)/g)].map((m) => ({
        file,
        sets: m[1] ?? '',
      })),
    )
    expect(
      updates.length,
      'the census found no UPDATE at all, so it measures nothing',
    ).toBeGreaterThan(5)
    expect(updates.filter((u) => /\bprovider\s*=/.test(u.sets))).toEqual([])
  })

  it('⛔ …and no setter can move it on a SESSION, by any of the four names one would have', () => {
    const named = main.filter(({ code }) =>
      /\b(setProvider|changeProvider|switchProvider|swapProvider)\b/i.test(code),
    )
    expect(named.map((f) => f.file)).toEqual([])
    // ⚑ The positive control the negative needs: the three settings that CAN move mid-session all
    // answer the same search, so a shape that finds nothing is a shape that can find something.
    for (const setter of ['setApprovalMode', 'setModel', 'setReasoningEffort']) {
      expect(
        main.filter(({ code }) => code.includes(setter)).length,
        `${setter} is how a movable setting looks`,
      ).toBeGreaterThan(0)
    }
    // 🔴 **433 · the SECOND positive control, and it is what this test is really about.**
    //
    // ⛔ **A setter for an IDENTITY's default now exists** — `setAgentProvider`, which HO-024 §2.2
    // called *required, not planned* — so a reader could take the emptiness above for *this app has
    // no way to choose a provider at all*, which is false and was never the claim. ⚑ **The claim is
    // about a CONVERSATION**: the sentence one section up says the provider is fixed when a
    // conversation starts, and the two assertions that hold it are the `UPDATE provider_session`
    // census above and the session/provider intersection below.
    //
    // ⚠️ **Named here rather than left to the four-name grep to be right by luck.** A verb called
    // `setProvider` would have taken this test red for a reason it does not mean (`423` F5.1), and
    // a reader who did not know that would have deleted the assertion rather than the name.
    expect(
      main
        .filter(({ code }) => code.includes('setAgentProvider(profileSlug'))
        .map((f) => f.file)
        .sort(),
      'the identity-level chooser is gone, so the negative above has nothing to be narrower than',
    ).toEqual(['main/db/session-store.ts', 'main/runtime/runtime-host.ts'])
  })

  it('🔴 no command that names an EXISTING session carries a provider', () => {
    const ipc = withoutProse(readFileSync(join(SRC, 'main/runtime/ipc.ts'), 'utf8'))
    // Search shape: every arm of the wire union, sliced at its own `z.literal`, asked two
    // questions — does it carry a provider, and does it name a session. ⚠️ **Seven arms carry a
    // provider and that is not the claim**: six of them are about a provider rather than about a
    // conversation (`checkProviderAuth`, `listLibrary`, …). The sentence says a provider cannot be
    // changed on a conversation, so what must be empty is the INTERSECTION. A positive would be a
    // `setProvider`-shaped arm with both fields.
    // 🔴 **633 · the region is BOUNDED at the end of the union, and it was not.**
    // ⛔ **The last arm's slice used to run to the end of the FILE**, so every `sessionId:` key
    // anywhere below the schema — in the dispatcher, in `DURING_A_QUIT`, in a helper — counted as
    // a field of `createAgent`. ⚑ It was green only because nothing down there had yet spelled one
    // at a line start; `633` added a `sessionId: command.sessionId,` to the `exportSession` case
    // and the intersection fired on an arm that carries no session at all.
    // ⚠️ `a-fixed-width-slice-runs-into-the-next-region`, with *the next region* being the whole
    // rest of the module — and the fix is a boundary the SOURCE defines rather than a fallback.
    const unionAt = ipc.indexOf("z.discriminatedUnion('kind'")
    const unionEnd = ipc.indexOf('satisfies z.ZodType<RuntimeCommand>', unionAt)
    expect(unionAt, 'the command union was not found').toBeGreaterThan(0)
    expect(unionEnd, 'the command union has no end').toBeGreaterThan(unionAt)
    const union = ipc.slice(unionAt, unionEnd)
    const arms = [...union.matchAll(/z\.literal\('(\w+)'\)/g)].map((m, at, all) => ({
      kind: m[1],
      body: union.slice(m.index, all[at + 1]?.index ?? union.length),
    }))
    const carriesProvider = arms.filter((a) => /provider:\s*providerSchema/.test(a.body))
    expect(
      carriesProvider.map((a) => a.kind),
      'no arm carries a provider, so the intersection below measures nothing',
    ).toContain('createSession')
    // ⚑ **The control the bound needs** (633): the dispatcher below the union really does spell a
    // `sessionId:` key, so a region that ran past the union would find one — and this is what says
    // the region stops before it.
    expect(ipc.slice(unionEnd)).toMatch(/(^|[{,])\s*sessionId\s*[,:}]/m)
    expect(
      // ⚠️ **The FIELD, not the mention, and not only the multi-line spelling.** `listLibrary`
      // filters on `recordId: sessionId.optional()` — the shared validator's name, on a key that
      // is not a session this command acts on — so this matches `sessionId` as a KEY, at a line
      // start OR after a `{`/`,`, which is how the single-line arms in this union are written.
      carriesProvider
        .filter((a) => /(^|[{,])\s*sessionId\s*[,:}]/m.test(a.body))
        .map((a) => a.kind),
    ).toEqual([])
  })
})

describe('§2 · "model and approvals you can change later, in the Open tab" — the two live controls', () => {
  it('⚑ both exist, on the agent card, as controls a person can press', () => {
    // 🔴 **Not a bare `toContain` on the hook.** `CardApproval.vue` draws its face for every
    // conversation, a fixed one (D-017b's `settingsFixed`) included — and that is exactly the state
    // in which *"you can change later"* is FALSE. So the census reads the CONFIRM, the press that
    // changes the mode, and what gates it.
    const approval = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/CardApproval.vue'), 'utf8'),
    )
    expect(approval).toContain('role="switch"')
    expect(approval).toContain(':disabled="!props.approval.changeable || props.approval.saving"')
    expect(approval).toContain('@change="choose"')
    const controls = withoutProse(
      readFileSync(join(SRC, 'renderer/src/composables/useConversationControls.ts'), 'utf8'),
    )
    expect(controls).toContain('const changeable = !sources.fixed()')

    // ⚑ UI-012 · the model is the one model picker, mounted by the card only where a pick can
    // reach the conversation — so the pair here is that it is mounted and that `fixed` stops it.
    const card = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/AgentCard.vue'), 'utf8'),
    )
    expect(card).toMatch(/<ModelPicker[\s\S]{0,200}v-bind="props\.modelPick\.picker\.value"/)
    expect(card).toContain('v-if="mayPick && props.modelPick?.picker.value"')
    const panel = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/SessionPanel.vue'), 'utf8'),
    )
    expect(panel).toContain('fixed: () => props.fixed ?? true')
    const pick = withoutProse(
      readFileSync(join(SRC, 'renderer/src/composables/useConversationModelPick.ts'), 'utf8'),
    )
    expect(pick).toMatch(/!sources\.fixed\(\) && sources\.pickModel\(\) !== undefined/)
    expect(pick).toContain('fixed: !changeable.value')
  })

  it('⛔ and the sentence names them together, once, for every provider', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const said = providerIsFixed(provider)
      // ⚑ **The display name, not the wire id** — `151`'s rule, and the reason `PROVIDER_NAME`
      // exists. A person reads "Codex"; the union member is `'codex'`.
      expect(said).toContain(providerName(provider))
      expect(said, 'the wire id reached a sentence a person reads').not.toContain(provider)
      expect(said).toContain(CHANGEABLE_LIVE_IN)
      expect(said.split(CHANGEABLE_LIVE_IN)).toHaveLength(2)
    }
  })

  it('⚑ …and it names the tab by reading the strip, so a rename carries', () => {
    // ⛔ Not `toBe('the Open tab')` — that is the literal this constant exists to avoid. The claim
    // is that the sentence carries the tab's own label, which is a different assertion from either
    // of them being any particular word.
    const tab = DRAWER_TABS.find((each) => each.id === TAB_OF_THE_SETTINGS)
    expect(tab, 'the settings tab is gone, so the sentence points at nothing').toBeDefined()
    expect(CHANGEABLE_LIVE_IN).toBe(`the ${tab?.label} tab`)
    // …and the tab really is the home of both settings it names.
    expect(tab?.hint).toMatch(/model/i)
    expect(tab?.hint).toMatch(/approvals/i)
  })
})

describe('§3 · what removing the pickers took away, pinned so its return is visible', () => {
  const renderer = tree('renderer')

  /**
   * 🔴 **417 §2 said there was no second door. `423` relay 1 built one, and this is where that is
   * recorded rather than discovered.**
   *
   * ⛔ **`417` wrote here that this test *"goes RED the day the roster gains a create button,
   * which is the moment to delete it"*, and it did not go red — twice.** Once because `423`'s
   * creation gesture mints an `agent_identity` row and starts nothing, which this census is not
   * about; and once, far worse, because `StartAsAgent.vue` DOES build a `CreateSessionInput` and
   * the old regexes could not see it: it is neither `computed<CreateSessionInput>` nor
   * `: CreateSessionInput = {` nor `store.create({ … })`, but an object literal handed to an
   * `emit`. ⚠️ **A census whose prose promises a red its search shape cannot deliver is worse than
   * no census**, so the shape is widened here rather than the sentence softened.
   *
   * ## ⚑ What it measures now
   *
   * **Every renderer file that BUILDS a launch, derived from the payload rather than from a call.**
   * `CreateSessionInput` is what the one command that opens a conversation takes, and a file that
   * assembles one both names the type and WRITES the settings onto it. ⛔ Reading for the type
   * alone is too wide — `session-store.ts` takes one as a parameter and `RuntimeScreen` forwards
   * one — and reading for `profileId:` alone is far too wide, because it is also how a parameter
   * of that name is ANNOTATED and four surfaces read the field without starting anything.
   * ⚑ `approvalMode:` is the discriminator: it is a key only a launch payload carries, and the
   * only two places in the renderer that write it are the two doors.
   *
   * 🔴 **Two doors, and they are two because HO-023 §3 made the merge conditional on both.** The
   * front door opens BroBot and asks nothing; the second places a conversation — an identity and a
   * project — because `424` measured that without it every conversation a person can open after
   * `417` is BroBot's, in the workspace, and so is everything it spawns.
   */
  it('🔴 exactly TWO renderer files build a launch, and they are the two doors', () => {
    // 🔴 **CORRECTED AT `500`, and the correction is the census doing its job.** ⛔ The second
    // clause used to be `/\bapprovalMode\s*:\s*'/` — *the field, assigned a QUOTED LITERAL* — which
    // was exact while both doors hard-coded `'ask'`. `HO-036` §3.1 made the value a person's
    // setting, so both doors now write `approvalMode: props.defaultApprovalMode ?? 'ask'` and the
    // old shape found NEITHER of them: a census that answers *there are no launch builders* over an
    // app with two. ⚑ `a-negative-is-only-as-strong-as-the-search-shape`, met from the direction
    // that goes green-then-empty rather than red.
    // ⚠️ **The clause is now *the field is ASSIGNED something*, and the teeth below say what that
    // must still reject** — a forwarder, an unrelated annotation, and (new at `500`) a TYPE
    // DECLARATION of the same field, which is what a `|` on the line gives away.
    const buildsALaunch = ({ code }: { code: string }): boolean =>
      /\bCreateSessionInput\b/.test(code) && /\bapprovalMode\s*:\s*[^|\n]+$/m.test(code)
    const builders = renderer.filter(buildsALaunch).map((f) => f.file)
    expect(builders.sort()).toEqual([
      'renderer/src/components/NewConversation.vue',
      'renderer/src/components/StartAsAgent.vue',
    ])
    // ⛔ **The teeth** (standing rule 12's control, and `a-negative-is-only-as-strong-as-the-search-shape`):
    // the shape must reject a file that only READS the field, and accept one that only builds the
    // literal — the exact two directions the old regexes got wrong.
    // …a file that only FORWARDS one (the screen), …
    expect(
      buildsALaunch({ code: 'function start(input: CreateSessionInput) { store.create(input) }' }),
    ).toBe(false)
    // …a file that only ANNOTATES a parameter of that name, …
    expect(buildsALaunch({ code: 'function askModels(profileId: string): void {}' })).toBe(false)
    // …and one that builds the literal and hands it to an `emit`, which is the shape the OLD
    // search could not see and the reason this one exists.
    expect(
      buildsALaunch({
        code: "emit('start', { provider: p, profileId: s, approvalMode: 'ask' } as CreateSessionInput)",
      }),
    ).toBe(true)
    // 🔴 **500's two new teeth.** The first is the shape that broke the old clause: a value read
    // from a prop rather than typed as a literal. The second is what the loosening could have cost
    // — a file that only DECLARES the field's type must still not count as a door.
    expect(
      buildsALaunch({
        code: "emit('start', { provider: p, approvalMode: props.defaultApprovalMode ?? 'ask' } as CreateSessionInput)",
      }),
    ).toBe(true)
    expect(
      buildsALaunch({
        code: "type X = { input: CreateSessionInput; approvalMode: 'ask' | 'auto' }",
      }),
    ).toBe(false)
  })

  it('⛔ …and only ONE of them may choose the identity — the front door names a constant', () => {
    const door = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/NewConversation.vue'), 'utf8'),
    )
    const placed = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/StartAsAgent.vue'), 'utf8'),
    )
    // 🔴 The whole of the difference between the two doors, in two lines: one sends the constant,
    // the other sends what it was OPENED for — and neither offers a list to pick from.
    expect(door).toContain('profileId: DEFAULT_PROFILE_ID')
    expect(placed).toContain('profileId: props.profileSlug')
    expect(placed).not.toContain('profile-select')
    // ⚑ **And the second door is opened from the identity's own sheet, not from the launcher** —
    // so `417`'s ruling that the FRONT door asks nothing is untouched by it.
    expect(door).not.toContain('StartAsAgent')
  })

  it('🔴 and it names one profile — a constant, not a choice', () => {
    const door = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/NewConversation.vue'), 'utf8'),
    )
    // ⚠️ **The imported constant, not a component-local alias.** A census that pinned a local
    // name would make removing the indirection a test failure, which is how a source census
    // starts guarding its own spelling instead of the rule it was written for.
    expect(door).toContain('profileId: DEFAULT_PROFILE_ID')
    // ⛔ The two shapes that would put the capability back without anybody noticing.
    expect(door).not.toContain('profile-select')
    expect(door).not.toContain('+ New profile')
  })

  it('⚑ …and the search that found nothing can find something: one create call, one caller', () => {
    const calls = renderer.filter(({ code }) => /bridge\.createSession\(/.test(code))
    expect(calls.map((f) => f.file)).toEqual(['renderer/src/lib/session-store.ts'])
  })
})
