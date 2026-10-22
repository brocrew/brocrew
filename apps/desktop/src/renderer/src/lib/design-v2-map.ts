/**
 * 🔴 **Where every value v2.3 draws comes from — before anything moves on screen** (382).
 *
 * ## ⛔ What this file is, and what it deliberately is not
 *
 * `381` closed round two with three items and put them in an order: *"the smallest first
 * implementation commit remains the round-one order: **an information-map and copy/contract pass
 * before CSS**."* This is that map. ⚠️ **It renders nothing and no component imports it.** Its
 * consumers are `the-map-before-the-move.test.ts`, which resolves every pointer here against the
 * product and holds the verdicts to their sources; `the-bar-and-the-shelf.test.ts`, which resolves
 * five of `SessionShelf.vue`'s absent words out of {@link V23_FIELD_MAP} at run time;
 * `who-answered-it.test.ts`, which holds the actor slot and its sentence; and
 * `the-drawing-arrives.test.ts`, which holds §10's records and asserts that no component imports
 * this file.
 *
 * ⚑ **Why a module and not a document.** `171`/`168`'s rule, applied one level up: *"a rule can only
 * be enforced on wording a test can reach."* A markdown table saying *"`launch.home` comes from
 * `CreatedSession.providerHome`"* is a sentence that goes stale the first time a field is renamed;
 * {@link SourceRef} is a claim a test resolves against the file it names. ⛔ **A pointer clause is a
 * claim** — the one in `370` was wrong and nothing caught it, because nothing could.
 *
 * ## ⚠️ The three questions §1 asks of every field, and they are asked here in this order
 *
 *  1. **Where does the product's value come from** — {@link FieldMapping.binding}.
 *  2. **What is its absent state** — {@link FieldMapping.absent}. ⛔ Never a plausible value: `378`'s
 *     rule is that *"when the product has no report, the interface must say unknown, unavailable or
 *     refused."*
 *  3. **Is it a fact or a sentence** — {@link FieldMapping.kind}. A *fact* is rendered from data and
 *     may be `Unknown`. A *sentence* is copy a person reads, and copy is governed: standing rule 5,
 *     *a safety sentence with no test is a comment*.
 *
 * ## 🔴 The one thing this file exists to make impossible
 *
 * `382 §2`: *"render those strings and modes from the product's data/copy source; do not transfer
 * them by hand into a template."* Every `kind: 'sentence'` entry either names the constant it is
 * rendered FROM, or is a {@link HAND_CARRIED} entry with a verdict — and a hand-carried sentence is
 * a defect with an owner, never a slot that quietly ships. ⚑ The count that must be zero is the
 * number of `HAND_CARRIED` sentences that have been pasted into `renderer/` or `shared/`, and the
 * test asserts it. ⚠️ The drawings are not in this repository, so the enumeration is the
 * reference: nothing holds a quote against the drawing it came from.
 *
 * ## ⛔ Provider-neutral, on purpose, and it is a finding rather than a constraint
 *
 * Nothing here names a provider. `039`/`provider-neutrality.test.ts` refuses a renderer that decides
 * anything by recognising one, and v2.3's approval sheet draws a hard-coded two-tab segmented
 * control. ⚠️ **The tabs are fine and the literals are not**: the list of providers is
 * `SUPPORTED_PROVIDERS`, the disclosures are `RuntimeCommand{kind:'capabilities'}`'s answer keyed by
 * `Provider`, and the sheet is a `v-for`. See {@link DISCLOSURE_FIELDS}.
 */

import type { Provider } from '../../../shared/runtime-ipc'

/**
 * ⚑ **v2.3's copy input, typed** — what `BroBotUI.bind({disclosures})` reads.
 *
 * ⛔ **Keyed by {@link Provider} and never by a literal.** The mock's own approval sheet hard-codes a
 * two-tab segmented control; the product's list is `SUPPORTED_PROVIDERS` and the sheet is a `v-for`.
 * ⚠️ `Partial`, because a provider whose copy has not arrived must draw v2.3's own
 * *"Exact product wording not supplied"* block rather than an empty string — and an empty string is
 * what a total record would hand it.
 */
export type DisclosureInput = Readonly<
  Partial<
    Record<
      Provider,
      {
        readonly launchText?: string
        readonly modes?: readonly {
          readonly id: string
          readonly label: string
          /** ⛔ Absent is a state: `canAct('setApprovalMode')` refuses a mode with no disclosure. */
          readonly text?: string
        }[]
      }
    >
  >
>

/* ---------------------------------------------------------------------------
   The shape of one answer
   --------------------------------------------------------------------------- */

/**
 * ⛔ **A fact is rendered from data; a sentence is read by a person.**
 *
 * ⚠️ **The distinction is not stylistic and standing rule 8 is why**: *"where an agent must know a
 * fact about the system, that fact comes from the DYNAMIC layer, rendered from data — never asserted
 * as prose in a template."* All eight of `370`'s false sentences were facts written as prose. A
 * `sentence` here is copy whose subject is what the app or a provider DOES, and it must have exactly
 * one source in the codebase.
 */
export type FieldKind = 'fact' | 'sentence'

/**
 * A pointer at the product, resolvable rather than described.
 *
 * `module` is repo-root-relative and POSIX-separated so it reads the same on every machine.
 * `symbol` is either a top-level declaration (`SPAWN_RAIL_MEANS`) or a `Type.member`
 * (`CreatedSession.providerHome`).
 *
 * ⚠️ **What the resolver can and cannot prove.** It proves the file exists and that the name is
 * declared in it — a rename or a delete goes red. It does NOT prove the member belongs to that type
 * rather than to a neighbouring one in the same file, because a source census is not a type checker.
 * ⛔ Stated so a green run is not read as more than it is.
 */
export interface SourceRef {
  readonly module: string
  readonly symbol: string
}

/**
 * How well the product can answer for this field today.
 *
 *  - **`bound`** — a product value exists and is carried to a surface already. Wire it.
 *  - **`derived`** — the product holds the material but not in this shape. The `note` says what the
 *    derivation is, and a derivation that loses information is a design decision, not a helper.
 *  - **`unhoused`** — 🔴 **the product HAS this and v2.3 has nowhere to draw it.** The opposite
 *    direction from a hole, and it is `378`'s List B — *"product truths the mock has no adequate
 *    home for"* — arriving as data instead of as a paragraph. ⛔ Keeping the two apart matters: a
 *    hole is answered by a capability in a later slice, an `unhoused` fact is answered by a place to
 *    put it in THIS design, and confusing them turns a layout decision into a roadmap item.
 *  - **`hole`** — ⛔ **the product cannot supply this.** `382 §4`: *"for each, the answer is the
 *    existing unknown / no-report / read-only state — NOT a plausible value."* A hole is never
 *    closed by inventing a value; it is closed by a capability, and a capability is a proposal for
 *    the next slice.
 */
export type Binding =
  | { readonly state: 'bound'; readonly from: readonly SourceRef[]; readonly note?: string }
  | { readonly state: 'derived'; readonly from: readonly SourceRef[]; readonly note: string }
  | { readonly state: 'unhoused'; readonly from: readonly SourceRef[]; readonly note: string }
  | { readonly state: 'hole'; readonly note: string }

/** One field v2.3 draws, and the four things §9.1 asks about it. */
export interface FieldMapping {
  /**
   * The field's path in v2.3's own snapshot, exactly as the mock spells it — `launch.home`,
   * `children[].state`. ⚑ The mock's spelling and not ours: the left-hand column has to be
   * checkable against the file, and a renamed-on-the-way-in column is not.
   */
  readonly path: string
  readonly kind: FieldKind
  readonly binding: Binding
  /** ⛔ What the surface draws when the product has no value. Never a plausible substitute. */
  readonly absent: string
}

/* ---------------------------------------------------------------------------
   Modules, named once
   --------------------------------------------------------------------------- */

const IPC = 'apps/desktop/src/shared/runtime-ipc.ts'
const CAPS = 'apps/desktop/src/shared/capabilities.ts'
const PROVIDER_CAPABILITIES = 'packages/shared/src/provider-capabilities.ts'
const EVENTS = 'packages/runtime/src/events.ts'
const PERMISSION = 'packages/runtime/src/permission.ts'
const CHILD = 'packages/runtime/src/child-conversation.ts'
const CONTRACTS = 'packages/shared/src/contracts.ts'
const PROVIDERS = 'packages/shared/src/providers.ts'
const LIB = 'apps/desktop/src/renderer/src/lib'
const AGENT_STATE = `${LIB}/agent-state.ts`
const TOOLS = `${LIB}/tool-inventory.ts`
const APPROVALS = `${LIB}/approval-mode.ts`
/** ⚠️ The runtime package has a file of the SAME NAME, and they hold different things. */
const RUNTIME_APPROVALS = 'packages/runtime/src/approval-mode.ts'
const CREDENTIAL = `${LIB}/profile-credential.ts`
const AGENT_STORE = `${LIB}/agent-store.ts`
/**
 * ⚑ **384 §1.1 lifted `PROFILE_OWNS` out of `NewConversation.vue` and into here**, which is what
 * makes a second surface able to render it. `NEW_CONVERSATION` — the component path this
 * pointer used to name — has no reader left and is gone with it.
 */
const PROFILE_WORDS = `${LIB}/profile-words.ts`
const STATUS_PROJECTION = `${LIB}/status-projection.ts`

const ref = (module: string, symbol: string): SourceRef => ({ module, symbol })

/* ---------------------------------------------------------------------------
   §1 · The conversation's own identity
   --------------------------------------------------------------------------- */

const CONVERSATION: readonly FieldMapping[] = [
  {
    path: 'origin',
    kind: 'fact',
    binding: {
      state: 'hole',
      note: 'The mock’s own three-way switch — empty / fixture / host — and it has no product counterpart because the product is always the host. ⚑ It is the seam `381` praised and it does not survive the port: a bound surface is `host` and there is nothing else for it to be. Keep it in the mock; drop it from the view model rather than shipping a field that can only hold one value.',
    },
    absent: 'n/a — the field does not cross into the product.',
  },
  {
    path: 'sessionId',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'CreatedSession.sessionId')] },
    absent: 'null before a launch. Draws the launch declaration, not an empty conversation.',
  },
  {
    path: 'title',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'LibraryEntry.title')],
      note: 'A LIVE conversation has no title field at all: `CreatedSession` carries none, and `LibraryEntry.title` is the archived record’s. ⚠️ The mock opens on `New conversation` and then shows a sentence from the work. Deriving a live title from the first message is a product decision nobody has made.',
    },
    absent: '`New conversation` before a launch; the record’s own title for a history view.',
  },
  {
    path: 'provider',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'CreatedSession.provider'), ref(PROVIDERS, 'Provider')],
    },
    absent:
      '`Provider not specified` — the mock’s own word, and correct: a draft has a chosen provider, never an absent one.',
  },
  {
    path: 'phase',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'CreatedSession.sessionId'), ref(IPC, 'LibraryEntry.id')],
      note: 'new / live / record is a routing fact, not a session field: the product answers it by WHICH surface is open. `phase` is the view model’s, derived at the boundary, and it is the one derived field here that loses nothing.',
    },
    absent: '`new` — the pre-launch surface is the app’s own starting state.',
  },
  {
    path: 'status',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [
        ref(CONTRACTS, 'SessionStatus'),
        ref(AGENT_STATE, 'AgentFacets'),
        ref(AGENT_STATE, 'DOINGS'),
        ref(AGENT_STATE, 'BEINGS'),
        ref(AGENT_STATE, 'NEEDINGS'),
        ref(STATUS_PROJECTION, 'v23StateOf'),
        ref(STATUS_PROJECTION, 'V23_HOLES'),
      ],
      note: '🔴 **The lossiest field in the map. `384 §1.2` SETTLED it — the view model keeps the three facets, and this field is a PROJECTION of them, computed at the moment of drawing and never the only thing on screen.** `status-projection.ts` is the decision and `one-word-and-what-it-drops.test.ts` measures its cost over the whole facet space. ⛔ **Two of the product’s nine words have no word in v2.3 at all — `background` and `scheduled` — and BOTH have a control behind them**, which is why the projection returns `null` there rather than picking the nearest lie.** v2.3 has ONE status from a flat twelve-word list. The product has `SessionStatus` (five) crossed with three INDEPENDENT facets — what the agent is DOING, what it IS, and what it NEEDS FROM YOU — which `035` split apart on purpose and `378` warned against re-collapsing: *"do not use a single busy badge or broad amber status for everything."* ⛔ A single `status` cannot say *working AND waiting on a permission*, which is the exact pair the composer-freeze rule turns on.',
    },
    absent:
      '`ready` (grey). ⚠️ Grey-as-ready is not grey-as-unknown; the product has a seventh faceless `unknown` doing and the view model must keep them apart.',
  },
  {
    path: 'recordKind',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [
        ref(IPC, 'LibraryEntry.origin'),
        ref(IPC, 'LIBRARY_ORIGINS'),
        ref(IPC, 'LibraryEntry.derived'),
      ],
      note: 'The mock’s two words — `Closed record` / `Discovered · read-only` — are `LibraryOrigin`’s three (`ours` / `user-home` / `restored`) with two of them merged. Render the origin’s own word.',
    },
    absent: '`Read-only record`.',
  },
  {
    path: 'actionError',
    kind: 'sentence',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'ChildTalkRefusal'), ref(IPC, 'RevealResult'), ref(IPC, 'QueueOutcome')],
      note: '⚠️ The mock has ONE error slot and composes its text itself (`` `${action}: ${message}` ``). The product’s refusals are typed per verb and each carries its own words. Rendering them through one string slot throws the type away; the slot should take a refusal, not a sentence.',
    },
    absent: 'null — nothing drawn.',
  },
]

/* ---------------------------------------------------------------------------
   §2 · The launch declaration
   --------------------------------------------------------------------------- */

const LAUNCH: readonly FieldMapping[] = [
  {
    path: 'launch.profile',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'CreatedSession.profileId'), ref(IPC, 'DEFAULT_PROFILE_LABEL')],
      note: 'The person chooses the pinned profile’s display name; it is not its slug.',
    },
    absent: '`No profiles reported` in the select; `Not reported` in the companion’s mini-fact.',
  },
  {
    path: 'launch.home',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'CreatedSession.providerHome'), ref(IPC, 'ProviderConfigInfo.home')],
    },
    absent:
      '`Home location unknown` under the select. ⛔ Never a constructed path: the home is per profile AND per provider, and a guess at it names somebody else’s folder.',
  },
  {
    path: 'launch.folder',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'CreatedSession.cwd')],
      note: "🔴 **417 took the launcher's half of this away.** It was bound from two places — the session's own `cwd` and the launcher's `LaunchDraft`, which held the folder a person had typed before pressing Start. HO-022 §2 removed the folder field (*\"BroBot has his workspace\"*), and `lib/launch-draft.ts` went with it. ⚠️ **The value still exists and is still reported**; what is gone is the person's answer to it. What a front-door conversation runs in is now `runtime-host.resolveCwd`'s, and **for BroBot's own conversations that is the durable workspace and NOTHING ELSE** (`424`, HO-023 §3): the front door names no folder, and since D-016 there is no project folder for it to inherit. ⛔ **This clause read *\"the pinned project's folder if it has one, and the durable workspace otherwise\"* from `417` until `455`, and `424` reversed exactly that** — `420` §0 had measured the old behaviour and `424`'s own docblock names this sentence as the bug it fixed. ⚠️ `424` repriced twelve promises and did not reach this file.",
    },
    absent: '`No verified working folder`.',
  },
  {
    path: 'launch.folderVerified',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'CwdVerdict')],
      note: '🔴 **A three-state field the mock draws as a boolean, and the third state is the honest one.** `checkCwd` answers at the moment it is asked; nothing stores the answer. So a folder checked earlier is *verified when it was checked*, which is not *verified now* — and a `true` rendered from the row’s existence claims a check nobody made. ⚠️ `true` only for the verdict this surface itself just received.',
    },
    absent:
      'null ⇒ `Verification unknown`. ⛔ Not `false`: unasked and refused are different answers.',
  },
  {
    path: 'launch.model',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'SessionSettingsDisclosure.model'), ref(IPC, 'ProviderConfigInfo.model')],
    },
    absent:
      '`Not reported`. ⚑ `292 §3`: omitting a setting is a REPORTED state of its own and must not read as a default.',
  },
  {
    path: 'launch.reasoning',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'SessionSettingsDisclosure.reasoningEffort')] },
    absent:
      '`Not reported` — and it is still the ordinary case, because the front door OFFERS a reasoning control and requires nothing of it (435, HO-025 §5). ⚠️ `417`\'s clause read *"because the launcher asks for nothing"*, which stopped being the reason the day the menu came back: an untouched door sends no `reasoningEffort` at all, which is what keeps the reported value a fact rather than an echo of a box.',
  },
  {
    path: 'launch.planCapability',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [
        ref(PROVIDER_CAPABILITIES, 'ProviderCapabilities.planMode'),
        ref(PROVIDER_CAPABILITIES, 'CapabilityStatus'),
      ],
      note: '⛔ **Not a boolean.** `CapabilityStatus` is a union whose `unavailable` arms are REQUIRED to carry a reason, which is `030`’s honest-absence rule held up by the type system. `textOrUnknown()` flattens it to `Reported available` / `Reported unavailable` and throws the reason away — the one thing a person needs when the answer is no.',
    },
    absent: '`Unknown` only when no capability answer has arrived at all.',
  },
  {
    path: 'launch.planMode',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'SessionSettingsDisclosure.planMode')] },
    absent: '`Not reported`.',
  },
  {
    path: 'launch.approvalMode',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'ApprovalModeDisclosure.approvalMode'), ref(APPROVALS, 'approvalModeLabel')],
      note: '⚠️ `pendingApprovalMode` has no slot in v2.3 and it is a different fact: a mode CHANGE does not rewrite the running turn, which is a sentence the mock itself already carries.',
    },
    absent:
      '`unrecorded` — `approvalModeLabel`’s own word. ⛔ Never `ask`: guessing the safer mode presents a yolo session as a careful one.',
  },
  {
    path: 'launch.credentialStatus',
    kind: 'sentence',
    binding: {
      state: 'derived',
      from: [
        ref(CREDENTIAL, 'profileCredential'),
        ref(PROVIDER_CAPABILITIES, 'ProviderCapabilities.homeCredential'),
      ],
      note: '⚠️ **The product’s answer is a paragraph and the mock’s slot is a chip.** `profileCredential()` returns a sentence plus a `tone`, because what has happened to a credential differs between the providers in KIND — one keeps a copy that shares a rotating token, the other keeps nothing. There is no one-word status to put in a chip, and inventing one is exactly what `329` corrected.',
    },
    absent: '`Unknown`.',
  },
  {
    path: 'launch.credentialOwner',
    kind: 'fact',
    binding: {
      state: 'hole',
      note: '⛔ **No product value answers “credential ownership”.** The nearest is `ProfileCredential.copies`, a boolean about whether this profile keeps a copy — which is not ownership, and the app owns none of it either way. ⚑ A chip here would be a word invented to fill a chip.',
    },
    absent: '`Unknown`, and it stays `Unknown` — this slot should be removed rather than filled.',
  },
]

/* ---------------------------------------------------------------------------
   §3 · The provider’s report, child work and the plan
   --------------------------------------------------------------------------- */

const REPORT: readonly FieldMapping[] = [
  {
    path: 'report.at',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'PersistedEventInfo')],
      note: 'Events carry their own time; there is no session-level “last report at”. Take the newest event’s.',
    },
    absent:
      'null ⇒ the whole `report` block is absent, which is what draws `Session started. No child-work or context report has arrived.`',
  },
  {
    path: 'report.source',
    kind: 'sentence',
    binding: {
      state: 'derived',
      from: [ref(TOOLS, 'InventoryReading.provenance')],
      note: '⚑ The product has exactly one such sentence and it belongs to the tool reading. A general “where this report came from” line does not exist; the honest attribution is the provider’s own name plus the event kind.',
    },
    absent: '`Time not reported` / no attribution line.',
  },
  {
    path: 'report.launchAt',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'LibraryEntry.createdAt')] },
    absent: 'Omit the line.',
  },
  {
    path: 'children',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'subAgentEventSchema')],
      note: '🔴 **`null` vs `[]` is the whole design and the mock got it right**: no report at all is not the same fact as a report containing no children. Keep both arms.',
    },
    absent: 'null ⇒ `No child work reported`; `[]` ⇒ `No child work in this report`.',
  },
  {
    path: 'children[].id',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'subAgentEventSchema')],
      note: 'The `agentId` — stable across every phase, which is what lets three events collapse into one row. ⚠️ `idKind` says what KIND of id it is: a dispatch inside the parent, or a real thread with a rollout file. There is nothing to open in the first case.',
    },
    absent: 'Not optional — a child with no id cannot be a row.',
  },
  {
    path: 'children[].name',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'subAgentEventSchema'), ref(CHILD, 'ChildThreadState')],
      note: 'The event’s `title` when there is one, else `ChildThreadState.nickname`, else the id. ⚠️ Both are optional and the mock’s fixture names are shell-ish (`ui_audit`); a real child often has no name at all.',
    },
    absent: 'The id. ⛔ Never a generated label.',
  },
  {
    path: 'children[].state',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'subAgentEventSchema'), ref(CHILD, 'ChildThreadState')],
      note: '⚠️ **Two different vocabularies, and neither is the mock’s.** The event has `phase` (started/progress/ended) and an optional `outcome` (completed/failed/**interrupted**); the live thread has `status` (working/idle/unloaded/error). `interrupted` is a third real answer that `rounding it to failed accuses a sub-agent that was stopped from outside` — the mock has no badge for it.',
    },
    absent: 'Unknown (grey). ⛔ Not `in-flight`.',
  },
  {
    path: 'children[].avatar',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(AGENT_STATE, 'DOINGS'), ref(AGENT_STATE, 'DOING_WORD')],
      note: 'The robot images ARE the `doing` facet’s six plus the faceless seventh. ⛔ The seventh is not decoration: showing a face claims a doing we were not told.',
    },
    absent: 'The faceless `unknown` ring.',
  },
  {
    path: 'children[].activity',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'subAgentEventSchema')],
      note: 'The event’s `summary`, or `lastTool` when there is no summary yet.',
    },
    absent: 'Draw the row with its state and no second line.',
  },
  {
    path: 'children[].at',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'PersistedEventInfo')] },
    absent: '`Time not reported`.',
  },
  {
    path: 'children[].event',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'subAgentEventSchema')],
      note: 'The mock writes `child.running` / `spawn.refused`. The product’s wire word is `phase`; a dotted event name is the mock’s invention and must not become a second vocabulary.',
    },
    absent: 'Omit.',
  },
  {
    path: 'children[].reportedBy',
    kind: 'sentence',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'subAgentEventSchema')],
      note: 'The event’s `origin` — `announced` (the parent said so) vs `observed` (we saw it) — is the real attribution and it is finer than one source string.',
    },
    absent: 'Omit the source line rather than writing `Provider report`.',
  },
  {
    path: 'children[].events[].at',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'PersistedEventInfo')] },
    absent: '`Time not reported`.',
  },
  {
    path: 'children[].events[].name',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'subAgentEventSchema')],
      note: 'The same derivation as `children[].event`: the wire word is `phase`, and the dotted `child.started` spelling is the mock’s own invention rather than anything the product emits.',
    },
    absent: 'Omit the row.',
  },
  {
    path: 'children[].events[].text',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(EVENTS, 'subAgentEventSchema')] },
    absent: 'Omit the second line.',
  },
  {
    path: 'plan',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'planUpdateEventSchema')],
      note: '⚠️ **`steps` REPLACES the list; it never appends.** A view model that accumulates plan steps across events would show a plan the agent has already abandoned.',
    },
    absent: 'null ⇒ `No plan reported`.',
  },
  {
    path: 'plan[].text',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(EVENTS, 'PlanStep')] },
    absent: 'Not optional.',
  },
  {
    path: 'plan[].status',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'PlanStep')],
      note: '⛔ **Three words, not twelve.** A step is `pending` / `active` / `done`; the mock reuses the conversation’s whole `STATES` table and draws them as `queued` / `in-flight` / `landed`. ⚠️ Two vocabularies for one field is how a step acquires a state the provider never reports.',
    },
    absent: 'Unknown.',
  },
]

/* ---------------------------------------------------------------------------
   §4 · Sources — the part `378` liked best and the product already models
   --------------------------------------------------------------------------- */

const SOURCES: readonly FieldMapping[] = [
  {
    path: 'sources',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'SessionInstructions')] },
    absent:
      'null ⇒ `No provider report yet. Headings are shown without invented totals or source files.`',
  },
  {
    path: 'sources.inPrompt',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'InjectedInstruction'), ref(IPC, 'SessionInstructions')],
      note: '⛔ **`reach` is carried by the `agent-memory*` kinds ALONE** (`317 §2.2`). Every other injected kind is in the prompt by construction and has no `reach` to read, so the split is: everything without a `reach`, plus the memory rows whose `reach` is `prompt`.',
    },
    absent: '`No sources in this report.`',
  },
  {
    path: 'sources.onDemand',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'InjectedInstruction')],
      note: '⚠️ `on-request` is a statement about AVAILABILITY and never about what the model has read — `009`’s rule and `305`’s defect. The mock’s caption says exactly that; keep it.',
    },
    absent: '`No sources in this report.`',
  },
  {
    path: 'sources.files',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'HandedPath'), ref(IPC, 'MAX_HANDED_PATHS')] },
    absent: '`No sources in this report.`',
  },
  {
    path: 'sources.config',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'ProviderConfigFile'), ref(IPC, 'ProviderConfigInfo.files')],
    },
    absent:
      'Omit the fold. ⚑ `ProviderConfigFile.exists` is a third state the mock has no slot for: a configuration location that is NOT there is a different fact from one nobody reported.',
  },
  {
    path: 'sources.unexposed',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'ProviderInstruction'), ref(IPC, 'InstructionScope')],
      note: '⚠️ The product’s nearest fact is `ProviderInstruction` — a file the PROVIDER reported loading on its own, with a `scope` that may be `unknown`. That is *reported and unattributed*, which is not the same as *not published*. A boolean here would flatten the two.',
    },
    absent: 'false ⇒ draw nothing. ⛔ Absence of the flag is not proof the inventory is complete.',
  },
  {
    path: 'sources.*.id',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'InjectedInstruction')],
      note: '⛔ **There is no separate id.** An injected instruction is identified by its absolute path, which is also what `readInstructionSource` takes — a synthesised key would be a second identity for one file.',
    },
    absent: 'Not optional.',
  },
  {
    path: 'sources.*.name',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'InjectedInstruction')],
      note: 'The path’s leaf. ⚠️ Two sources can share a leaf — a profile and a project both hold an instruction file — so the leaf is a LABEL and the path is the identity beside it.',
    },
    absent: 'Not optional.',
  },
  {
    path: 'sources.*.provenance',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'InjectedInstruction'), ref(IPC, 'RefusedInstruction')],
      note: '🔴 **A fourth state the mock has no vocabulary for: REFUSED.** `RefusedInstruction` is a file on the chain this app would not read and why. ⚠️ **The vocabulary is SEVEN words across two declarations, and `382`’s list named four of them** — `InstructionRefusal` (`main/runtime/instructions.ts`) is `symlink | not-a-regular-file | too-large | not-utf8 | unreadable`, and `RefusedInstruction`’s own docblock adds `over-budget` and `dangling-link`. ⛔ **`reason` on the wire is a bare `string`**, so the type bounds the reader and not the row. 🔴 **Two of the seven are DECLARED AND NEVER WRITTEN**: `main/runtime/instructions.ts` produces `absent`, `dangling-link`, `not-a-regular-file`, `not-utf8`, `over-budget`, `symlink` and `unreadable` — **`too-large` has no producer anywhere in the product**, and `absent` is written and declared by neither type. ⚠️ **`455` first “corrected” this note by deleting `too-large` as a word that belonged to another type. That was wrong** — it is a member of this one, in both declarations — and the true finding is the smaller one: an enumeration a reader takes for the reasons they may SEE contains one nothing can produce. It is neither confirmed, offered nor unexposed, and it is the state a person most needs to see because it means an instruction they wrote did not arrive.',
    },
    absent: '`Unknown`.',
  },
  {
    path: 'sources.*.caption',
    kind: 'sentence',
    binding: {
      state: 'derived',
      from: [
        ref(IPC, 'InjectedInstruction'),
        ref(IPC, 'InjectedInstructionKind'),
        ref(IPC, 'RefusedInstruction'),
      ],
      note: '⛔ **Per KIND, and the kinds are enumerated** — eight of them, and the panel already owns a label for each. A caption composed in a template is a ninth source of words for a closed set that already has one.',
    },
    absent: 'Omit the caption line.',
  },
  {
    path: 'sources.*.at',
    kind: 'fact',
    binding: {
      state: 'hole',
      note: 'Injected instructions carry `bytes` and `truncated`, not a time. There is no per-source “read at”.',
    },
    absent: 'Omit the `Launch report · <time>` line entirely.',
  },
  {
    path: 'sources.*.path',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'InjectedInstruction'), ref(IPC, 'SessionPathTarget')],
    },
    absent: 'Omit both the reveal fold and the copy button.',
  },
  {
    path: 'sources.*.documentId',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'InstructionSourceResult')],
      note: '⛔ **The path is the handle** — `readInstructionSource` takes it, so a document id is one more identity for a file that already has one. ⚠️ v2.3 keys its example documents by a short slug, which only a fixture can do.',
    },
    absent: 'Disable `Open`.',
  },
  {
    path: 'document.name',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'InstructionSourceResult')],
      note: 'The path’s leaf, as `sources.*.name`. ⚑ The sheet title is the only place a person sees which of two same-named files they opened, so the path belongs in the header beside it.',
    },
    absent: '`Document`.',
  },
  {
    path: 'document.path',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'InstructionSourceResult')] },
    absent: 'Hide `Reveal`.',
  },
  {
    path: 'document.content',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'InstructionSourceResult'), ref(IPC, 'WorkflowOutputResult')],
      note: '⚑ The refusal arms of those results are the interesting half and the mock has one message for all of them.',
    },
    absent: '`No document content has been reported.`',
  },
]

/* ---------------------------------------------------------------------------
   §5 · Tools — three provenance states in the mock, and they are not our three
   --------------------------------------------------------------------------- */

const TOOLS_FIELDS: readonly FieldMapping[] = [
  {
    path: 'tools',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(TOOLS, 'InventoryReading'), ref(TOOLS, 'readInventory')],
    },
    absent: 'null ⇒ `No tool report yet` + `Unknown does not mean enabled.`',
  },
  {
    path: 'tools.source',
    kind: 'sentence',
    binding: { state: 'bound', from: [ref(TOOLS, 'InventoryReading.provenance')] },
    absent: '⛔ Not optional — the provenance sentence is always shown.',
  },
  {
    path: 'tools.at',
    kind: 'fact',
    /**
     * ⚑ **Filled by `444` relay 1, and the note it replaces is kept here because the reason
     * matters**: this read *"`InventoryReading` carries no time. The inventory is the newest
     * frame, not a stamped reading."* ⛔ The frame still carries no clock — the moment is the
     * LEDGER ROW's `created_at`, which the fold received all along and never read.
     */
    binding: { state: 'bound', from: [ref(TOOLS, 'InventoryReading.at')] },
    absent:
      '⛔ Draw NOTHING. Never `Time not reported`, never a zero — see `TOOLS_ARE_AS_OF_A_STATEMENT`.',
  },
  {
    path: 'tools.inventoryExposed',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(TOOLS, 'InventoryReading')],
      note: '⛔ **Three product states flattened to a boolean.** `kind` is `untold` (no adapter has said anything) / `unpublished` (the provider publishes none) / `published`. `untold` is not `false`: nobody has been asked yet.',
    },
    absent: 'The `untold` arm draws the sentence and no list.',
  },
  {
    path: 'tools.items[].name',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(TOOLS, 'ToolRow'), ref(TOOLS, 'qualify')],
      note: '⚑ Two names, not one: the tool’s own and the one the MODEL must spell on this provider. The mock has one slot.',
    },
    absent: 'Not optional.',
  },
  {
    path: 'tools.items[].provenance',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(TOOLS, 'ToolStanding')],
      note: '🔴 **The vocabulary collision this dispatch was sent to find.** The product’s row standings are `confirmed` / `offered` / `unconfirmable`, where **`offered` is a real problem** — the provider DOES publish a list and this tool is missing from it — and `unconfirmable` is not a problem at all. v2.3’s row states are `confirmed` / `offered`, with `unexposed` drawn only as a whole-category card. ⛔ So a row on a provider that publishes nothing and a row that a publishing provider omitted would draw IDENTICALLY, which is the single distinction this surface exists to make.',
    },
    absent: '`Unknown`.',
  },
  {
    path: 'tools.items[].description',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(TOOLS, 'ToolRow'), ref(TOOLS, 'InventoryReading.builtins')],
      note: '⚠️ Built-ins are NAMES ONLY and that is the provider’s limit, not ours. A row with no second line is the honest rendering.',
    },
    absent: 'Draw the name alone.',
  },
  {
    path: 'tools.foreign',
    kind: 'fact',
    binding: {
      state: 'unhoused',
      from: [ref(TOOLS, 'ForeignServer'), ref(TOOLS, 'InventoryReading')],
      note: '⛔ **v2.3 has no slot for a server the CHILD named that BroBot did not declare.** `ForeignServer` exists, it is drawn today, and it is the row that answers *what else is in this conversation*.',
    },
    absent: 'n/a — the surface has nowhere to put it.',
  },
  {
    path: 'tools.dropped',
    kind: 'fact',
    binding: {
      state: 'unhoused',
      from: [ref(TOOLS, 'InventoryReading')],
      note: '⛔ **`InventoryReading.dropped` — how many rows the last frame named and did not carry.** Non-zero means the list UNDERSTATES, and a list that understates without saying so is the defect `a-count-taken-before-the-bound-is-invisible-to-it` names.',
    },
    absent: 'n/a — needs a line v2.3 does not have.',
  },
]

/* ---------------------------------------------------------------------------
   §6 · Human decisions
   --------------------------------------------------------------------------- */

const REQUESTS: readonly FieldMapping[] = [
  {
    path: 'requests[].id',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'permissionRequestSchema'), ref(PERMISSION, 'userInputQuestionSchema')],
    },
    absent: 'Not optional.',
  },
  {
    path: 'requests[].kind',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'permissionRequestSchema'), ref(PERMISSION, 'userInputPermissionSchema')],
      note: '⚠️ The mock’s two kinds are permission / question. The product’s permission has its OWN `kind` — `command` vs `file` — and the card is different for each. Two levels, not one.',
    },
    absent: 'Not optional.',
  },
  {
    path: 'requests[].status',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'UserDecisionEvent'), ref(IPC, 'AnswerAck')],
      note: '`UserDecisionEvent.outcome` is the decision the person made; the mock’s `submitted` (decided, provider outcome not yet reported) is a real and separate state and the product has `AnswerAck` for it.',
    },
    absent: '`pending`.',
  },
  {
    path: 'requests[].at',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'PersistedEventInfo')] },
    absent: '`Time not reported`.',
  },
  {
    path: 'requests[].title',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'permissionRequestSchema'), ref(PERMISSION, 'userInputQuestionSchema')],
      note: 'The permission’s `action` line, or the question’s own text — two different fields under one heading, and the card beneath them differs by more than the title.',
    },
    absent: 'Not optional.',
  },
  {
    path: 'requests[].description',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'permissionRequestSchema')],
      note: '⚠️ `detailOmitted` says how much of `detail` was cut. A card that shows a truncated command without saying so is worse than one that shows none.',
    },
    absent: 'Omit.',
  },
  {
    path: 'requests[].command',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(EVENTS, 'permissionRequestSchema')],
      note: '⛔ The `detail`, shown IN FULL and never clamped — the whole argument of `367` is that the card is the only thing `ask` buys you, so a truncated command is a card that does not do its job.',
    },
    absent: 'Omit the code block (a `file` permission has no command).',
  },
  {
    path: 'requests[].folder',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(PERMISSION, 'permissionScopeSchema')] },
    absent: 'Omit the fold.',
  },
  {
    path: 'requests[].source',
    kind: 'sentence',
    binding: {
      state: 'derived',
      from: [ref(EVENTS, 'permissionRequestSchema')],
      note: 'The requesting provider’s own name; there is no separate source string.',
    },
    absent: 'Omit.',
  },
  {
    path: 'requests[].choices[]',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(PERMISSION, 'userInputOptionSchema'), ref(PERMISSION, 'userInputQuestionSchema')],
      note: '⛔ **`multiSelect` has no slot in v2.3** and the mock’s radio group cannot express it. A multi-select question drawn as radios silently drops answers.',
    },
    absent: 'A free-text answer only.',
  },
  {
    path: 'requests[].answer',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'RespondUserInputInput')] },
    absent: 'Draw the reason instead.',
  },
  {
    path: 'requests[].reason',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'RespondPermissionInput')] },
    absent: '`No reason reported.`',
  },
  {
    path: 'requests[].decision',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'UserDecisionEvent')],
      note: '⛔ The product’s outcomes include `allow_for_session`, `allow_all_for_session` and, since `736`, `allow_always` (kept beyond the conversation); the mock has `allow-once` and `deny`. A standing grant rendered as a one-off is `086` in the dangerous direction.',
    },
    absent: 'Unknown.',
  },
  {
    path: 'requests[].actor',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'UserDecisionEvent')],
      note: 'UserDecisionEvent.by records ActedBy from the caller when an answer is taken. whoAnsweredIt displays the actor kind, never a conversation ID or an invented personal name. A person means a window answered; conversation IDs remain on the Events tab.',
    },
    absent:
      '⚑ **The sentence, not a blank and not a label.** `by` is absent for exactly one population — a row written before `477` recorded an actor (HO-029 §2.2) — and nothing backfills, so the surface says `Nothing in the ledger records who answered it`, which is `465`’s own sentence composed from `nothingRecordsWho`. ⛔ **`389 §5`’s rule survives its premise**: the retired shape was a missing-value LABEL, which promises a fact that could have been reported; this states what the ledger holds. 🔴 **A third population draws nothing at all** — a card a teardown settled was answered by nobody, so it has no actor AND no gap, and both arms would be false of it.',
  },
  {
    path: 'requests[].decisionAt',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'PersistedEventInfo')] },
    absent: '`Time not reported`.',
  },
  {
    path: 'requests[].finalAt',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'PersistedEventInfo')] },
    absent: '`Time not reported`.',
  },
  {
    path: 'requests[].providerOutcome',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'TranscriptEvent'), ref(IPC, 'UserDecisionEvent')],
      note: '⚠️ `381`’s boundary, restated so it cannot be lost: the source establishes durable decision events THROUGH A REMOUNT. It does NOT establish that a refused-but-still-pending explanatory line survives a full restart and replay. ⛔ Do not strengthen the copy past that.',
    },
    absent: '`not reported` — which is the ordinary state while the turn is still running.',
  },
  {
    path: 'messages[].role',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'UserTurnEvent'), ref(IPC, 'TranscriptEvent')] },
    absent: 'Not optional.',
  },
  {
    path: 'messages[].time',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'PersistedEventInfo')] },
    absent: 'Omit the timestamp.',
  },
  {
    path: 'messages[].text',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'TranscriptEvent')],
      note: '⛔ **`TranscriptEvent` is a union of far more than two roles** — thinking, tool calls, memory notes, compaction, workflow output, notices. v2.3 draws a two-role transcript; the product’s transcript is the union, and every arm has its own component today.',
    },
    absent: 'Not optional.',
  },
]

/* ---------------------------------------------------------------------------
   §7 · Safety, policy and the rail
   --------------------------------------------------------------------------- */

const SAFETY: readonly FieldMapping[] = [
  {
    path: 'globalStop',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(IPC, 'AgentIdentities'), ref(AGENT_STORE, 'AgentStore')],
      note: '⚠️ **Inverted, and the third state is real.** The product reports `spawningEnabled`; the mock draws `globalStop`. Before `agentIdentities` has answered there is no value at all, and the mock’s `null ⇒ Global stop · unknown` is exactly right.',
    },
    absent: 'null ⇒ `Unknown` / `Global stop · unknown`.',
  },
  {
    path: 'policy.identity',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'AgentIdentity.slug'), ref(IPC, 'AgentIdentity.displayName')],
    },
    absent: '`No identity selected`.',
  },
  {
    path: 'policy.depth',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(CAPS, 'CAPABILITY_FIELDS'), ref(CAPS, 'ProfileCapabilities')],
    },
    absent:
      'null ⇒ `Unknown`. ⛔ Never the ruled default: `CapabilityOrigin` distinguishes a row that CHOSE a value from one that follows the default, and the sheet already says which.',
  },
  {
    path: 'policy.concurrency',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(CAPS, 'CAPABILITY_FIELDS')],
      note: '⛔ **Two numbers, not one.** `maxConcurrent` is `{perParent, global}` — *how many children one conversation may run* and *how many spawned conversations this app will run at all* — and its own help text says they are two different questions. One chip cannot hold the pair.',
    },
    absent: '`Unknown`.',
  },
  {
    path: 'policy.messaging',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(CAPS, 'MESSAGING_REACH'), ref(CAPS, 'CAPABILITY_FIELDS')],
    },
    absent: '`Unknown`.',
  },
  {
    path: 'policy.interrupting',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(CAPS, 'CAPABILITY_FIELDS')],
      note: '🔴 **`interrupting` and `ending` are ONE column.** `375` widened `can_interrupt` to govern ending as well *because ending destroys more than cutting in does*, and the field’s own label is `May interrupt or end`. ⛔ Two rows in a policy grid assert two independently settable values; setting one and not the other is impossible, and a sheet that offers it is offering a narrowing that does not exist.',
    },
    absent: '`Unknown`.',
  },
  {
    path: 'policy.ending',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(CAPS, 'CAPABILITY_FIELDS')],
      note: '⛔ **The same single column as `policy.interrupting`** — `canInterrupt`, whose own label is `May interrupt or end`. A grid that gives ending its own cell invites a person to narrow one and not the other, which the schema cannot store.',
    },
    absent: '`Unknown`.',
  },
  {
    path: 'policy.source',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [ref(CAPS, 'CapabilityOrigin'), ref(CAPS, 'CapabilityOrigins')],
      note: 'Per FIELD and not per policy: each capability separately reports whether this row chose it or is following the ruled default. One `source` line for the whole grid throws that away.',
    },
    absent: '`No capability policy reported`.',
  },
  {
    path: 'policy.canSpawn',
    kind: 'fact',
    binding: {
      state: 'unhoused',
      from: [ref(CAPS, 'CAPABILITY_FIELDS'), ref(CAPS, 'ProfileCapabilities')],
      note: '⛔ **v2.3’s policy grid has five rows and the product has NINE fields, and only four of them line up.** `canSpawn` — the grant that starts a conversation — has no row at all, and it is the field the global stop is about. ⚠️ **This gloss read *bring a conversation into existence* until `464`**, which is the phrase `456` deleted from that field’s help for colliding word-for-word with `canCreateAgents`’ — so the map carried the retired wording from `456` to `464`. ⚠️ **This note said *"the product has five FIELDS"* from `382` until `455`, and *"EIGHT"* from `455` until `511`; each was true when it was written**: `canCreateAgents` arrived at `419`, `takesWorkFrom` at `440`, `canCreateProjects` at `441` and `canStaff` at `511`. ⛔ **A number outlives the derivation that justified it, and this note is on its third one.** ⛔ **Those four have no row in {@link V23_FIELD_MAP} at all** — not even an `unhoused` one — so the `unhoused` count below is a floor rather than the answer, and giving each of them a row is owed work this dispatch names and does not do.',
    },
    absent: 'n/a — the grid needs five more cells; `455` counted four and `511` added the fifth.',
  },
  {
    path: 'identities[].id',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'AgentIdentity.slug')] },
    absent: '`No identities reported.`',
  },
  {
    path: 'identities[].name',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'AgentIdentity.displayName'), ref(IPC, 'DEFAULT_PROFILE_LABEL')],
    },
    absent: 'The slug.',
  },
  {
    path: 'identities[].role',
    kind: 'fact',
    binding: {
      state: 'hole',
      note: '⚑ The rail row draws no `role` — the column exists, `AgentIdentity` has carried it back since `467`, `377` wrote the first one, and since `419` **any identity a person or an agent creates may carry one** (`createAgent`\'s `role: z.enum(AGENT_ROLES).nullable()`, and the same field on the `create_agent` tool) — and **that is correct for this surface**: standing rule 10, `role` selects text and drives display and never gates anything. A rail row must not imply otherwise. ⚠️ **This note read *"`377` writes exactly one"* in the present tense until `455`**; the past-tense fact survives, the present-tense reading a person would take does not.',
    },
    absent: 'n/a — and it should stay absent here.',
  },
  {
    path: 'identities[].foldersWithoutARow',
    kind: 'fact',
    binding: {
      state: 'unhoused',
      from: [ref(IPC, 'AgentIdentities')],
      note: '⛔ **A profile folder that no conversation has ever run as has no identity row** (`341` criterion 12), and `AgentIdentities.foldersWithoutARow` is how the product says so. v2.3 lists identities only, so a profile a person created and has not used yet is simply missing from the rail with no explanation.',
    },
    absent: 'n/a — needs a second rail state.',
  },
]

/* ---------------------------------------------------------------------------
   §8 · Project and history
   --------------------------------------------------------------------------- */

/**
 * ⚑ **D-016 · the product has no projects**, so every `project.*` field v2.3 draws is a `hole` —
 * and one no later slice closes, because nothing is meant to supply it. ⛔ The rows stay because
 * the mock still draws the fields and this map answers for every field it draws.
 */
const NO_PROJECT =
  'D-016 took projects out of the product: nothing records one, so there is nothing to draw. ⛔ Drop the field from the view model rather than drawing a placeholder project.'

const RECORDS: readonly FieldMapping[] = [
  {
    path: 'project.name',
    kind: 'fact',
    binding: { state: 'hole', note: NO_PROJECT },
    absent: 'n/a — the field does not cross into the product.',
  },
  {
    path: 'project.description',
    kind: 'fact',
    binding: { state: 'hole', note: NO_PROJECT },
    absent: 'n/a — the field does not cross into the product.',
  },
  {
    path: 'project.folder',
    kind: 'fact',
    binding: {
      state: 'hole',
      note: `${NO_PROJECT} ⚑ The folder a conversation runs in is \`launch.folder\`’s.`,
    },
    absent: 'n/a — the field does not cross into the product.',
  },
  {
    path: 'project.verified',
    kind: 'fact',
    binding: {
      state: 'hole',
      note: `${NO_PROJECT} ⚑ A folder’s check is \`launch.folderVerified\`’s.`,
    },
    absent: 'n/a — the field does not cross into the product.',
  },
  {
    path: 'project.selection',
    kind: 'fact',
    binding: {
      state: 'hole',
      note: `${NO_PROJECT} ⚠️ \`376\` put a project select in the launcher and D-016 took it out: a conversation is placed by its folder.`,
    },
    absent: 'n/a — the field does not cross into the product.',
  },
  {
    path: 'history[].id',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'LibraryEntry.id')] },
    absent: '`No history has been supplied by the host.`',
  },
  {
    path: 'history[].title',
    kind: 'fact',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'LibraryEntry.title'), ref(IPC, 'LibraryEntry.preview')],
    },
    absent: 'The preview.',
  },
  {
    path: 'history[].provider',
    kind: 'fact',
    binding: { state: 'bound', from: [ref(IPC, 'LibraryEntry.provider')] },
    absent: 'Not optional — every record has one.',
  },
  {
    path: 'history[].kind',
    kind: 'fact',
    binding: {
      state: 'derived',
      from: [
        ref(IPC, 'LibraryEntry.origin'),
        ref(IPC, 'LibraryEntry.unresumableReason'),
        ref(IPC, 'ResumableSessionInfo'),
      ],
      note: '🔴 **This is where v2.3’s biggest false sentence lives.** The mock’s `kind` is a decorative word; the product’s answer is *whether this record can be reopened*, and it is PER RECORD: `resumeRefusal` / `unresumableReason` are strings the app already writes. See `HAND_CARRIED`.',
    },
    absent: '`Read-only record`.',
  },
  {
    path: 'history[].counts',
    kind: 'fact',
    binding: {
      state: 'unhoused',
      from: [
        ref(IPC, 'LibraryCounts'),
        ref(IPC, 'LibraryPage'),
        ref(IPC, 'LibraryQuery'),
        ref(IPC, 'LibraryFilters'),
        ref(IPC, 'LIBRARY_QUERY_MAX'),
      ],
      note: '`LibraryCounts`, `LibraryPage`, `LibraryQuery`, `LibraryFilters` and `LIBRARY_QUERY_MAX` exist: history is a PAGED, FILTERED, COUNTED surface. v2.3 filters an in-memory array of four.',
    },
    absent: 'n/a — needs paging.',
  },
]

/** Every field v2.3 draws, and where the product answers it. */
export const V23_FIELD_MAP: readonly FieldMapping[] = [
  ...CONVERSATION,
  ...LAUNCH,
  ...REPORT,
  ...SOURCES,
  ...TOOLS_FIELDS,
  ...REQUESTS,
  ...SAFETY,
  ...RECORDS,
]

/* ---------------------------------------------------------------------------
   The disclosures object — v2.3's second input, and the one §2 is about
   --------------------------------------------------------------------------- */

/**
 * v2.3 takes copy through `BroBotUI.bind({disclosures})`, keyed by provider, with two slots per
 * provider: `launchText` (sign-in & continuing home) and `modes[]` (per-mode consequences).
 *
 * ⛔ **The map from those slots to the product's copy is not one-to-one, and that is the finding.**
 */
export interface DisclosureSlot {
  /** The mock's own key, as `exactBlock()` prints it when the copy is missing. */
  readonly slot: string
  readonly binding: Binding
  /** What v2.3 already draws when the product has nothing — and in one case, must keep drawing. */
  readonly absent: string
}

export const DISCLOSURE_FIELDS: readonly DisclosureSlot[] = [
  {
    slot: '<provider>.launchDisclosure',
    binding: {
      state: 'derived',
      from: [
        ref(PROVIDER_CAPABILITIES, 'ProviderCapabilities.homeCredential'),
        ref(PROVIDER_CAPABILITIES, 'ProviderCapabilities.signIn'),
        ref(PROVIDER_CAPABILITIES, 'ProviderCapabilities.reprovisionAuth'),
        ref(CREDENTIAL, 'profileCredential'),
      ],
      note: '⚠️ **Three product capabilities, one mock slot.** `329` split them deliberately: `homeCredential` answers *what has already happened to a credential*, `signIn` and `reprovisionAuth` answer *what this app may DO about one*, and a provider can plausibly have any without the others. `profileCredential()` already joins the first with a timing clause. The other two are BUTTON availabilities with their own sentences and v2.3 has nowhere to put them.',
    },
    absent: 'v2.3’s `Exact product wording not supplied` block. ⛔ Do not paraphrase.',
  },
  {
    slot: '<provider>.modes[] — the list',
    binding: {
      state: 'derived',
      from: [
        ref(IPC, 'SetApprovalModeInput'),
        ref(IPC, 'YOLO_LABEL'),
        ref(APPROVALS, 'approvalModeLabel'),
      ],
      note: '⚑ **This hole closes.** The mock says *"No mode list supplied by the runtime"*; the runtime has a closed two-member list and one place allowed to turn it into a word.',
    },
    absent: 'n/a — the list is always available.',
  },
  {
    slot: '<provider>.modes[ask].disclosure',
    binding: {
      state: 'hole',
      note: '🔴 **There is no `ask` disclosure anywhere in the product, and this is the honest reason v2.3’s slot must stay empty.** `describeApprovalMode` returns the LABEL `approvals: ask` and nothing else; every paragraph the app has about approvals is about what turning them OFF costs. ⛔ Writing an `ask` paragraph here would be inventing a guarantee — and `367` measured that what `ask` buys differs by provider in kind, so a shared one would be false on one of them.',
    },
    absent:
      'v2.3’s `Exact product wording not supplied` block, permanently, until a dispatch writes one.',
  },
  {
    slot: '<provider>.modes[auto].disclosure',
    binding: {
      state: 'bound',
      from: [
        ref(APPROVALS, 'YOLO_MEANS'),
        ref(PROVIDER_CAPABILITIES, 'ProviderCapabilities.approvals'),
      ],
      note: '⛔ **Two halves and they must both be rendered.** `YOLO_MEANS` is the SHARED sentence — nothing is asked, and a command reaches what you can — and `capabilities[provider].approvals.note` is the half that is this provider’s alone. `CardApproval.vue` draws exactly this pair, and since `500` so do the two doors a PERSON starts a conversation from — a default of `auto` means a launch can begin in the mode, so the door that begins it owes the same two halves. `a-mode-that-says-what-it-does.test.ts` pins all three by clause. A slot that took one would tell a person strictly less than the running app already does.',
    },
    absent: 'n/a — both halves always exist.',
  },
]

/* ---------------------------------------------------------------------------
   Actions — v2.3's bridge, and what in the product answers each verb
   --------------------------------------------------------------------------- */

/** One verb in `bridge.actions`, and the runtime command that would carry it. */
export interface ActionMapping {
  /** The name exactly as v2.3 passes it to `bridge.perform`. */
  readonly action: string
  readonly binding: Binding
}

export const V23_ACTIONS: readonly ActionMapping[] = [
  {
    action: 'prepareConversation',
    binding: {
      state: 'hole',
      note: '🔴 **There IS something to prepare again, and it is three fields** (435, HO-025 §5). `417` wrote here that *"there is nothing left to prepare"* — true of the door it shipped, and false since the PO corrected himself: *"the front door asks nothing and OFFERS EVERYTHING… the choices present and out of the path rather than absent."* ⚑ The state between opening the screen and pressing Send is the words plus `RuntimeScreen.launchChoices` — provider, model and reasoning effort, each of which may be left unanswered, in memory for this run of the app (`lib/launch-choices.ts`). ⛔ Still a `hole` rather than `bound`: this is local state and no host is asked until Send, which is what the v2.3 verb names and what this column records.',
    },
  },
  {
    action: 'selectProvider',
    binding: {
      state: 'hole',
      note: 'The person can choose a provider before starting a conversation, using the model picker. A running conversation keeps its provider. Changing an identity’s default affects its next conversation, not one already running.',
      // ⚠️ Left as a `hole` deliberately: v2.3's `selectProvider` is a verb the mock calls on a
      // running conversation, and THAT is what the product has no command for. The launch-time
      // choice this dispatch added is `prepareConversation`'s, one row up.
    },
  },
  {
    action: 'startConversation',
    binding: { state: 'bound', from: [ref(IPC, 'CreateSessionInput')] },
  },
  {
    action: 'sendMessage',
    binding: { state: 'bound', from: [ref(IPC, 'SendInput'), ref(IPC, 'NOTHING_TO_SEND')] },
  },
  {
    action: 'interruptTurn',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'SessionInput')],
      note: '`{kind:"interrupt"}`; `sendInterrupting` is the second, different verb v2.3 has no button for.',
    },
  },
  {
    action: 'attachFile',
    binding: { state: 'bound', from: [ref(IPC, 'ChosenAttachment'), ref(IPC, 'HandedPath')] },
  },
  {
    action: 'decidePermission',
    binding: { state: 'bound', from: [ref(IPC, 'RespondPermissionInput')] },
  },
  {
    action: 'answerQuestion',
    binding: { state: 'bound', from: [ref(IPC, 'RespondUserInputInput')] },
  },
  {
    action: 'setApprovalMode',
    binding: { state: 'bound', from: [ref(IPC, 'SetApprovalModeInput')] },
  },
  {
    action: 'setSpawnStop',
    binding: {
      state: 'bound',
      from: [ref(AGENT_STORE, 'AgentStore')],
      note: '`setSpawningEnabled`, INVERTED — the product reports whether spawning is on, the mock asks whether the stop is on. ⚠️ Getting the sense backwards here turns an emergency stop into a release.',
    },
  },
  {
    action: 'readDocument',
    binding: { state: 'bound', from: [ref(IPC, 'InstructionSourceResult')] },
  },
  { action: 'readHistory', binding: { state: 'bound', from: [ref(IPC, 'LibraryEntry')] } },
  {
    action: 'revealPath',
    binding: { state: 'bound', from: [ref(IPC, 'RevealResult'), ref(IPC, 'SessionPathTarget')] },
  },
  {
    action: 'messageAgent',
    binding: {
      state: 'bound',
      from: [ref(IPC, 'ChildSendResult'), ref(IPC, 'ChildTalkRefusal')],
      note: '`sendToChild`. ⚠️ v2.3 collects the text with `window.prompt`, which the product cannot use.',
    },
  },
  {
    action: 'spawnAgent',
    binding: {
      state: 'hole',
      note: '🔴 **A category error, not a missing command.** An agent starts a conversation only by giving work (`give_work`, since D-016 took `spawn_agent` away); a PERSON starting a conversation as an identity is `createSession`. The two are governed differently on purpose — `spawn-rails.ts` refuses a give that would start a conversation running WIDER than the agent giving it (`499`, HO-036), and nothing bounds a person’s against anything. ⛔ A `Spawn conversation` button on the capability sheet would run the ungoverned path under the governed one’s name.',
    },
  },
  {
    action: 'interruptAgent',
    binding: {
      state: 'hole',
      note: '⛔ **No person-facing command interrupts a reported child.** `interrupt` is for THIS session. The child verbs a person has are `readChildState`, `readChildWork` and `sendToChild`.',
    },
  },
  {
    action: 'endAgent',
    binding: {
      state: 'hole',
      note: '⛔ **Nothing ends a conversation** (D-017, `05` rule 2): `end_agent` is gone, a person’s Close stops the process and the conversation stays reachable, and what stops an agent is an interrupt and taking its work back. A button here is a capability proposal, not a binding.',
    },
  },
  {
    action: 'retryDelegation',
    binding: {
      state: 'hole',
      note: '⛔ **Nothing in the product retries a refused spawn.** A refusal is a rail’s answer, not a transient failure, and `368`/`341`’s refusal payloads say which rail and whether it is `permanent`. ⚠️ A retry button on a `permanent` refusal is a control that can never succeed.',
    },
  },
]

/* ---------------------------------------------------------------------------
   §9.2 · Every safety sentence v2.3 carries by hand
   --------------------------------------------------------------------------- */

/**
 * Whether the product supports what a hand-carried sentence claims.
 *
 *  - **`supported`** — true, and there is a constant to render it FROM. Replace the paste.
 *  - **`unsourced`** — true as far as anyone can tell, and no constant exists. It needs one before
 *    it ships: standing rule 5.
 *  - **`blurred`** — ⚠️ **true of MORE THAN ONE product state, printed under a label that means
 *    one of them.** Not false and not fine: the sentence reads correctly and the reader draws the
 *    wrong conclusion, which is the failure a provenance vocabulary exists to prevent. ⛔ It is a
 *    separate verdict because calling it `false` would overstate the finding and calling it
 *    `supported` would ship it.
 *  - **`false`** — ⛔ the product does not do this. It must be removed or narrowed, and `382 §3` is
 *    explicit that a removal or a narrowing ships without another round.
 */
export type SentenceVerdict = 'supported' | 'unsourced' | 'blurred' | 'false'

export interface HandCarriedSentence {
  /**
   * ⚑ **A verbatim fragment of the sentence as it appears in the v2.3 drawing.** The test asserts
   * the fragment is NOT in `renderer/` or `shared/`, which is the count that must be zero. Nothing
   * checks it against the drawing, which is not in this repository.
   */
  readonly quote: string
  /**
   * 🔴 **Which of the drawings carry this sentence.** A record: the drawings are not in this
   * repository, so nothing re-derives it (§10).
   *
   * ⛔ **This is the column that makes the audit say WHEN.** `382` enumerated 21 sentences against
   * v2.3 and nothing recorded that they were v2.3's; **v2.7 keeps exactly one of them**, so a
   * reader who took this list as *"the sentences the design carries"* would be reading a list about
   * a drawing four revisions old. ⚠️ A revision missing here is one with no bytes to read, not one
   * that dropped the sentence: v2.4, v2.5, v2.5.1 and v2.6 are cited elsewhere and have none.
   */
  readonly heldIn: readonly DrawingRevision[]
  readonly verdict: SentenceVerdict
  readonly where: string
  /** For `supported`, the constant it should be rendered from. Empty for the other two. */
  readonly renderFrom: readonly SourceRef[]
  readonly why: string
}

export const HAND_CARRIED: readonly HandCarriedSentence[] = [
  {
    quote: 'Agent-created conversations still always ask a person before acting.',
    heldIn: ['v2.3'],
    verdict: 'false',
    where: 'capabilitySheet() — the “Consent, not containment” notice',
    renderFrom: [],
    why: '🔴 **The product refuses this sentence by name.** `SPAWN_RAIL_MEANS` says the door refuses a spawned conversation that would be given MORE than the agent starting it (`499`, HO-036 — it said *open without prompts* until HO-036 withdrew that absolute) — and its own docblock records why it stops there: *"it does not say a spawned conversation cards its commands… on Codex it is FALSE: `on-request` escalates when the sandbox DENIES something, a permitted read denies nothing, so nothing escalates and nothing asks."* ⛔ Writing it is `086` in the dangerous direction — a protection claimed where none exists. ⚠️ It entered by restatement: it is the designer brief’s own §4 wording, and round two did not catch it.',
  },
  {
    quote: 'Consent, not containment.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'capabilitySheet() — the same notice',
    renderFrom: [ref(CAPS, 'SPAWN_RAIL_MEANS')],
    why: 'HO-012 §2’s own phrase, and the constant exists to carry it. ⛔ Render the constant, not the phrase: the three clauses after it are the ones that make it mean something.',
  },
  {
    quote: 'A role is display language; it grants nothing.',
    heldIn: ['v2.3'],
    verdict: 'false',
    where: 'capabilitySheet() — the same notice',
    // ⛔ **Emptied with the verdict**, because a `false` sentence that named a source would be
    // claiming the thing that makes it true — `the-map-before-the-move.test.ts` §5 asserts both
    // directions. ⚠️ It named `AGENT_ROLES` and `parseAgentRole` while it was `supported`.
    renderFrom: [],
    why: '🔴 **`supported` until `532`, and HO-052 §1 made the second clause false.** ⛔ A role now SEEDS an identity\'s capability fields at creation (`ROLE_TEMPLATES`), so a person who picks `project-manager` at the creation form grants two capabilities by doing it — `NewAgent.vue`\'s own note had to stop saying *"It allows nothing"* in the same commit. ⚑ **The half that survives is the one the mock was reaching for and is not what it wrote**: a role DECIDES nothing — every rail reads the capability fields and only the capability fields, and the column could be deleted after creation without moving a single answer. ⚠️ **Render that distinction or neither half**: *display language* is also wrong now, because the word is spent on a grant. 🔴 It is the third instance of `a-number-can-survive-the-death-of-its-derivation` in this map: the sentence was true, the world moved, and only the ledger says so.',
  },
  {
    quote: 'No policy is inferred from a role, profile picture, name or home.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'capabilitySheet() — the host-bound notice',
    renderFrom: [ref(CAPS, 'CAPABILITY_FIELDS'), ref(CAPS, 'CapabilityOrigin')],
    why: 'Every rail reads the capability fields and only the capability fields.',
  },
  {
    quote: 'Closed and discovered sessions are inspected, not resumed.',
    heldIn: ['v2.3'],
    verdict: 'false',
    where: 'renderComposer() — the lock line on a record',
    renderFrom: [],
    why: '🔴 **The product reopens closed sessions.** `ResumableSessionInfo` carries a per-record `resumeRefusal`, `listResumable` / `listUnresumable` are two commands, and `UnresumableSessionInfo` is the arm for records that genuinely cannot. ⛔ `378` said *"not a promise that the app can reopen"*; v2.3 hardened a description into a ruling. The honest render is the record’s own refusal string, or the reopen it is entitled to.',
  },
  {
    quote: 'Reading this record does not imply that it can be reopened or operated.',
    heldIn: ['v2.3'],
    verdict: 'false',
    where: 'recordView() — the record cover notice',
    renderFrom: [],
    why: 'The same defect as the composer lock line, one surface over. ⚠️ Two copies of one wrong claim is exactly what `039` predicts when a sentence is carried by hand instead of rendered.',
  },
  {
    quote: 'BroBot made it available. The provider has not confirmed availability or use.',
    heldIn: ['v2.3'],
    verdict: 'blurred',
    where: 'provenanceLegend() — the “Offered” row',
    renderFrom: [],
    why: '⚠️ **Literally true of BOTH of the product’s unconfirmed standings, and printed under the name of one.** `offered` means the provider DOES publish a list and this tool is missing from it — *"a real problem, and the state this surface exists to make visible"*; `unconfirmable` means the provider publishes nothing, which is not a problem at all. ⛔ The clause that would separate them — **on a provider that lists** — is the one the legend leaves out, so the row that needs attention and the row that never can draw identically. The legend needs two rows, not a reworded one.',
  },
  {
    quote: 'The provider does not publish this inventory. Availability cannot be inferred.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'provenanceLegend() — the “Not exposed” row',
    renderFrom: [ref(TOOLS, 'ToolStanding'), ref(TOOLS, 'InventoryReading')],
    why: 'True, and it belongs on the ROW standing `unconfirmable` as well as on the category card. v2.3 only has the card.',
  },
  {
    quote: 'Confirmation is not permission.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'provenanceLegend() — the “Confirmed” row',
    renderFrom: [ref(TOOLS, 'WHY_EVERY_CONVERSATION')],
    why: '⚑ The best sentence in v2.3 and the product already has a longer, truer version: a profile’s capabilities decide whether a CALL is admitted, not whether the tool is offered.',
  },
  {
    quote: 'Unknown does not mean enabled.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'toolsView() — the empty state',
    renderFrom: [ref(TOOLS, 'InventoryReading'), ref(TOOLS, 'WHY_EVERY_CONVERSATION')],
    why: 'True of the `untold` arm specifically.',
  },
  {
    quote: 'Loaded at launch and available on disk are not the same thing.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'contextView() — the muted line',
    renderFrom: [ref(IPC, 'InjectedInstruction')],
    why: '`reach`’s own contract: `on-request` is a statement about AVAILABILITY, never about what the model has read.',
  },
  {
    quote: 'Credential file contents are never previewed here.',
    heldIn: ['v2.3'],
    verdict: 'false',
    where: 'pathsView() — the foot of the folders fold',
    // ⛔ **Emptied with the verdict**, as `532` emptied the role row's: a `false` sentence that named
    // a source would be claiming the thing that makes it true. ⚠️ It named `CREDENTIAL_FILES_ARE_NOT_READ`
    // while it was `supported`, and that constant went in `733`.
    renderFrom: [],
    why: '🔴 **`supported` until `733`, and R92 made it false.** ⛔ The Info panel’s config rows offered Finder and never Open, and said why in a credential’s terms — `384 §1.1` wrote that promise as a constant, *“Nothing here reads a credential file”*. ⚑ **The PM, on `731` F-2: *“Offer Open as for any other file, and drop the credential wording.”*** So every config file the panel lists — `auth.json` included — now opens on the app’s own paper (`readConfigFile`), and the promise went with the rule it described. ⚠️ **What stays true is narrower and is not this sentence**: the config LIST carries no content (`ProviderConfigFile` is `{ name, path, exists, note }`); a file is read only when a person presses its Open.',
  },
  {
    quote: 'A profile is an agent’s continuing home.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'launchView() — the launch explanation',
    renderFrom: [ref(PROFILE_WORDS, 'PROFILE_OWNS')],
    why: '⚑ **Lifted in `384 §1.1`, and this row is why.** It was a component-local `const` in `NewConversation.vue` and could not be reached from a second surface, so `167 §4`’s rule — these two surfaces describe one boundary identically — was kept by a SOURCE census over two `.vue` files, and `356` had already had to repair a drift by hand. ⚠️ **`417` left ONE surface**: the launcher’s profile picker went with HO-022 §2, so `SessionInfo.vue` is the only renderer now and the cross-surface rule it was lifted for can no longer be violated. The constant stays where it is — a second surface is a slice away, in the roster.',
  },
  {
    quote:
      'Its own instructions and memory continue across conversations. It is not a role or a trust boundary.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'launchView() — the second half of the same explanation',
    renderFrom: [ref(PROFILE_WORDS, 'PROFILE_IS_NOT')],
    why: '⚑ **Was `unsourced` until `384 §1.1` wrote the constant.** The *"not a role or a trust boundary"* clause is true and is the clause a person most needs, and `PROFILE_OWNS` says nothing about what a profile is not. ⛔ The product’s wording refuses the shorter claim v2.3 invites: it does NOT say a profile grants nothing, because two ruled defaults are wider than the narrowest value — what is true is that they are the same for every identity.',
  },
  {
    quote: 'A change to approval mode does not rewrite a running turn.',
    heldIn: ['v2.3', 'v2.7'],
    verdict: 'supported',
    where: 'approvalSheet() — the sheet intro',
    renderFrom: [
      ref(IPC, 'ApprovalModeDisclosure.pendingApprovalMode'),
      ref(RUNTIME_APPROVALS, 'ApprovalModeSwitch'),
    ],
    why: 'The `pendingApprovalMode` field is that fact in data; the sentence should be rendered beside it rather than typed above it.',
  },
  {
    quote: 'These are host operations, not a local assignment queue.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'childSheet() — under the child action row',
    renderFrom: [ref(TOOLS, 'WHY_EVERY_CONVERSATION')],
    why: 'True, and the same fact as the tools sentence: having the verb is not being allowed to use it.',
  },
  {
    quote: 'It does not imply cross-project task assignment, health or orchestration.',
    heldIn: ['v2.3'],
    verdict: 'false',
    where: 'projectSheet() — the closing line',
    renderFrom: [],
    why: '🔴 **`supported` until D-016, which took projects out of the product.** ⛔ There is no project record for the sheet to describe, so the line closes a sheet that has nothing to say; it goes with the sheet.',
  },
  {
    quote: 'Open reads the document. Reveal locates it in the desktop filesystem.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'sourceCard() — the reveal fold',
    renderFrom: [ref(IPC, 'SessionPathTarget'), ref(IPC, 'RevealResult')],
    why: 'Two different commands with two different refusal shapes; `RevealResult`’s `gone` arm is a third state the sentence does not mention.',
  },
  {
    quote: 'A retry requests a new provider result; it does not erase this refusal.',
    heldIn: ['v2.3'],
    verdict: 'false',
    where: 'liveEventView() — beside the delegation refusal card',
    renderFrom: [],
    why: '⛔ There is no retry. See `V23_ACTIONS`’s `retryDelegation`: a spawn refusal is a rail’s answer and may be `permanent`, and a control that can never succeed is worse than a missing one.',
  },
  {
    quote: 'An answer or denial stays attributed, with its reason and final provider outcome.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'requestsView() — the muted line',
    renderFrom: [ref(IPC, 'UserDecisionEvent'), ref(IPC, 'TranscriptEvent')],
    why: '🔴 **The clause that failed was repaired by `477`, and this row went on saying it had not been** — the PM’s own *“two sentences that were false for a month”*. ⛔ The old reading was *“nothing is attributed to anybody”* — true when `382` wrote it, and untrue from the moment `UserDecisionEvent.by` existed; `494` F2 found the sentence still standing and `503` corrected it with the surface. ⚑ **Attributed means the KIND of caller and not a name**, which is all this app can ever know: `a-person` is *a window on somebody’s screen*. ⚠️ *Stays* is within `381`’s boundary exactly as the neighbouring supported row is — durable through a remount; a full restart and replay is not established, and the copy must not be strengthened past that.',
  },
  {
    quote: 'The refusal remains in the conversation. It is not replaced by a success message.',
    heldIn: ['v2.3'],
    verdict: 'supported',
    where: 'renderDecisionRecord() — the closing line of a refused record',
    renderFrom: [ref(IPC, 'UserDecisionEvent'), ref(IPC, 'TranscriptEvent')],
    why: '⚠️ Within `381`’s boundary: durable through a remount. ⛔ Not established through a full restart and replay, and the sentence must not be strengthened past that.',
  },
]

/* ---------------------------------------------------------------------------
   §10 · v2.7 — what each drawn surface cost to import
   --------------------------------------------------------------------------- */

/**
 * 🔴 **The inventory says WHEN, and every commit it names is resolved against `git` rather than
 * remembered** (455 §2.1).
 *
 * ## ⛔ What was wrong with everything above this line
 *
 * Everything above answers *"where does v2.3's value come from"*. ⚠️ **Nothing above says which
 * revision drew a thing or which commit imported it**, and by `444` relay 1's own argument that is
 * the same defect as a tool count with no clock: *"a person reading 15 tools cannot tell whether it
 * means as of this session's last launch or now."* ⚑ A row that says *drawn* without a revision
 * cannot be read a week later.
 *
 * ⚠️ **`444` relay 1 was about the PRODUCT's tool inventory and `444` closed it.** This section is
 * that defect's shape applied to the DESIGN inventory, which is new work; the citation is recorded
 * here so the next reader does not go looking for a closed finding.
 *
 * ## ⚑ What is checked, and what is a record
 *
 * `renders`, `importedAt` and `wiredAt` are checked against this tree and its history by
 * `the-drawing-arrives.test.ts` §4, and `state` and `stillOnlyDrawn` against those columns and each
 * other. ⚠️ **`title`, `drawnIn` and {@link HandCarriedSentence.heldIn} are a record**: the v2.3
 * and v2.7 drawings are not in this repository, so nothing re-derives them or checks them against
 * a drawing. ⛔ v2.4, v2.5, v2.5.1 and v2.6 are cited here and have no bytes in the repository, so
 * a revision missing from one of those columns says *no bytes to read*, never *that revision did
 * not draw it*. ⚠️ **The `note` strings are not checked, and saying so is part of the record**: the
 * prose beside the fields is reviewed prose, and a component pairing can be wrong in a row whose
 * every checked field is green.
 */
export type DrawingRevision = 'v2.3' | 'v2.7'

/** A surface a person can reach in the drawing: a workspace route, or a sheet over one. */
export type SurfaceKind = 'route' | 'sheet'

/**
 * How much of a drawn surface the product has.
 *
 *  - **`imported`** — the product answers the same question on a surface of its own.
 *  - **`part-imported`** — ⚠️ the DATA exists and the surface does not, or the surface exists
 *    somewhere else in the app's shape. The note says which half is missing.
 *  - **`only-drawn`** — ⛔ nothing in the product answers it.
 *  - **`review-scaffold`** — the drawing's own review chrome. ⚑ Not a product surface and never
 *    will be; a row that called it `only-drawn` would put a permanent debt on the list.
 */
export type SurfaceState = 'imported' | 'part-imported' | 'only-drawn' | 'review-scaffold'

/**
 * One surface of the drawing, and the three things `455` §2.1 asks of it.
 *
 * ⚠️ **The roster is a record of v2.7's own router** — `navigate('…')` / `route==='…'` for routes,
 * the `case '…':` labels inside `renderSheet` for sheets. The drawing is not in this repository,
 * so nothing re-derives it or refuses a surface that is missing here. ⛔ It is not a bare list of
 * the six previewed ones, which would be a roster taken from a mention.
 */
export interface SurfaceRecord {
  /** The drawing's own literal, exactly as its router spells it. */
  readonly id: string
  readonly kind: SurfaceKind
  /**
   * ⚑ **EVERY eyebrow the drawing's own arm can print, verbatim** — quoted from that arm, not from
   * the whole switch, which cannot say which arm a title belongs to.
   *
   * ⛔ **A list, because three arms are conditional.** `decision` prints one of three by request
   * kind and `document` one of two by whether the scene is a fixture; a single string recorded
   * only the first.
   *
   * ⚠️ **It is v2.7's eyebrow, and four dual-drawn sheets were RENAMED since v2.3** — `review`
   * (*DESIGN REVIEW · NOT PRODUCT STATE*), `approvals` (*LAUNCH DECLARATION & EXACT DISCLOSURE*),
   * `capabilities` (*CAPABILITY POLICY · CONSENT, NOT CONTAINMENT*) and `history` (*HISTORY &
   * READ-ONLY LIBRARY*). ⛔ So this field answers for the LATEST revision held, and `drawnIn`
   * answers for both; they are different questions and the rename is the reason to say so.
   *
   * ⛔ Empty for routes: a route has no `sheet(title, …)` call, so there is nothing to quote and a
   * hand-typed title would be a sentence pretending to be a derivation.
   */
  readonly title: readonly string[]
  /** ⚑ Which drawings draw it: a record, because the drawings are not in this repository. */
  readonly drawnIn: readonly DrawingRevision[]
  readonly state: SurfaceState
  /** Repo-relative product files. Asserted to exist. Empty for `only-drawn` and the scaffold. */
  readonly renders: readonly string[]
  /**
   * The commit each of {@link renders} was BORN in, in the same order.
   * ⚠️ Asserted THREE ways: the sha is a commit, it is an ancestor of `HEAD`, and the path exists
   * at it and not at its first parent. ⛔ A commit that merely touched the file will not pass.
   */
  readonly importedAt: readonly string[]
  /**
   * 🔴 **The commit that made those files answer the DRAWN question** — which is what `455 §2.1`
   * asks and what {@link importedAt} does not say.
   *
   * ⛔ **Several of these surfaces were born as Slice-2 fixtures.** `ProjectWorkspace.vue` first
   * appeared at `ba8e9fc` importing `PROJECTS` from `lib/fixtures` under a `PLACEHOLDER`
   * docblock. `DigestCard.vue` drew a fixture digest first, under a heading that claims coverage
   * `WINDOW_WAS_CHOSEN` (`shared/digest.ts`) says this app cannot make, and the commit that made it
   * draw a real digest is its `wiredAt`.
   * ⚠️ One column alone would have answered *when the file was born* under a heading promising
   * *when the surface arrived*.
   *
   * `null` where the file answered the drawn question from its first commit. Asserted to be a
   * real ancestor commit that TOUCHED the path.
   */
  readonly wiredAt: string | null
  /**
   * 🔴 **The third of `455 §2.1`'s three questions, typed** — *what is still only drawn*.
   *
   * ⛔ **A list rather than prose inside {@link note}, which nothing can read.** `importedAt` is
   * checked three ways; the question a plan would actually lift is this one, and it has to come
   * out as a list. ⚑ Empty for `imported` and for the scaffold; at
   * least one entry for every `part-imported` row, asserted both ways — which is also the only
   * thing that makes `imported` and `part-imported` different to a test.
   */
  readonly stillOnlyDrawn: readonly string[]
  readonly note: string
}

export const V27_SURFACES: readonly SurfaceRecord[] = [
  /* ------------------------------------------------------------------ routes */
  {
    id: 'attention',
    kind: 'route',
    title: [],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: [
      'apps/desktop/src/renderer/src/components/PersonsQueue.vue',
      'apps/desktop/src/renderer/src/components/AttentionQueue.vue',
    ],
    importedAt: ['81aca96', '10dc93c'],
    wiredAt: null,
    stillOnlyDrawn: [
      'a route of its own — the queue is a block on `waiting`, and `SurfaceName` has no member for it',
    ],
    note: '⚑ **The queue is built and global; the PAGE is not.** `SurfaceName` (`composables/useSurface.ts`) is `waiting | away | sessions | reading | tools | team | conversation | launcher` — there is no `attention`, and the queue is a block on `waiting` (*Waiting on you*) and a count on the rail’s badge. ⛔ What is only drawn is a first-class entrance, not the data behind it. ⚑ **D-016 · the delivery’s F-01 — *the age of a nonblocking decision* — meets no project on a row**: `455` relay 1 §3 found one there (the asking conversation’s open tasks, as `work[].projectSlug`), and `453` put a `project` and a `projectIs` on `PersonsQueueRow`; the product has no projects now, and neither a queue row nor its work carries one.',
  },
  {
    id: 'digest',
    kind: 'route',
    title: [],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: ['apps/desktop/src/renderer/src/lib/digest.ts'],
    importedAt: ['d60899e'],
    wiredAt: null,
    stillOnlyDrawn: [
      'the card itself — Recent activity draws dated lines, one per piece, instead',
      'a route of its own',
    ],
    note: 'The drawing’s digest card was replaced by Recent activity: dated lines of what finished, started, stopped or failed, each opening its conversation. What remains of the drawing here is its register words, which the Tools and instructions sheets still draw.',
  },
  {
    id: 'projects',
    kind: 'route',
    title: [],
    drawnIn: ['v2.7'],
    state: 'only-drawn',
    renders: [],
    importedAt: [],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '🔴 **D-016 · only drawn, on purpose.** `572` built this board as `ProjectsBoard.vue` (born `c7ef4d72`, wired `f6751216`) and D-016 deleted it with the rest of projects. ⛔ Nothing is owed here: the product has no project for a board to list.',
  },
  {
    id: 'project',
    kind: 'route',
    title: [],
    drawnIn: ['v2.7'],
    state: 'only-drawn',
    renders: [],
    importedAt: [],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '🔴 **D-016 · only drawn, on purpose.** The room was `ProjectWorkspace.vue` (born `ba8e9fc`, made real by `452` at `71d7360`) and D-016 deleted it with the rest of projects. ⛔ Nothing is owed here: the product has no project for a room to draw.',
  },
  {
    id: 'conversation',
    kind: 'route',
    title: [],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/ConversationPane.vue'],
    importedAt: ['1c20ab5'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: 'The app’s oldest surface. ⚠️ The drawing folds our `sessions`, `reading` and `launcher` surfaces into sheets, so the two shapes are not a route-for-route map in either direction.',
  },

  /* ------------------------------------------------------------------ sheets */
  {
    id: 'all-conversations',
    kind: 'sheet',
    title: ['WORKSPACE CONVERSATIONS'],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: ['apps/desktop/src/renderer/src/components/SideRail.vue'],
    importedAt: ['da4a9ed'],
    wiredAt: null,
    stillOnlyDrawn: ['the join: live conversations against identities, in one place'],
    note: '⚠️ **The rows exist and the join does not.** `SideRail`’s live sections draw who is working; the drawing’s sheet is *"Who is working where"* — those rows AGAINST identities, in one place. ⛔ A first version of this row named `SessionLibrary.vue`, which its own note simultaneously disqualified: the library is three sources keyed on the ARCHIVE, and this sheet is about live work.',
  },
  {
    id: 'create-identity',
    kind: 'sheet',
    title: ['AGENT IDENTITY'],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/NewAgent.vue'],
    importedAt: ['8ad095f'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚑ **Shipped at `423`, and its docblock already rules the delivery’s §02 omissions** — *"No capability CONTROLS … No folder … No conversation. Creation writes one row. Nothing is started."* ⛔ The wire verb is `createAgent`/`NewAgent`, not the delivery’s `createIdentity`, and three of its four fields are nullable where the delivery declares four required strings.',
  },
  {
    id: 'place-conversation',
    kind: 'sheet',
    title: ['NEW CONVERSATION'],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/StartAsAgent.vue'],
    importedAt: ['8ad095f'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚑ **D-016 · `StartAsAgent.vue` places a conversation by its FOLDER** — the app’s own workspace unless a person chooses one — where it used to quote HO-023 §3’s *"a project is where a conversation is placed"*. ⛔ There is no `startIdentityConversation` command; the product does `createSession` then `send`.',
  },
  {
    id: 'conversation-record',
    kind: 'sheet',
    title: ['LIVE CONVERSATION'],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: [
      'apps/desktop/src/renderer/src/lib/taking-over.ts',
      'apps/desktop/src/renderer/src/components/SideRail.vue',
      'apps/desktop/src/renderer/src/components/PersonsQueue.vue',
    ],
    importedAt: ['ccf039b', 'da4a9ed', '81aca96'],
    wiredAt: 'ccf039b',
    stillOnlyDrawn: [
      'a sheet — the words are drawn on a rail section and a queue row',
      'the third live state, `OPEN_IN_ANOTHER_WINDOW`, which has no gesture because `RuntimeHost` has no verb for it',
    ],
    note: '⚑ **The words are ours, verbatim** — `Take it over and open it` is `421`’s, and the drawing reproduces it. ⚠️ **D-017 · F024 — the drawing’s `running — nobody is watching it` is no longer ours**: whether a process runs is never shown (`05` rule 5), so the row says `NOT_OPEN_IN_ANY_WINDOW`. ⛔ **There is no sheet**: they are drawn on a rail section and a queue row. ⚠️ And the drawing’s two-valued `watch` loses our third state — `OPEN_IN_ANOTHER_WINDOW`, which has no gesture because `RuntimeHost` has no verb for it.',
  },
  {
    id: 'composed-instructions',
    kind: 'sheet',
    title: ['COMPOSED INSTRUCTIONS'],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: [
      'apps/desktop/src/renderer/src/components/SessionInstructions.vue',
      'apps/desktop/src/shared/told.ts',
    ],
    importedAt: ['75cb9cd', '37a7802'],
    wiredAt: '37a7802',
    stillOnlyDrawn: [],
    note: '⚑ **Built at `442` and STRICTER than the drawing.** `TOLD_LAYER_KINDS` is a closed five-member vocabulary and `ToldLayer.register` is three-valued with three constructors; the drawing’s `visibility: readable | provider-opaque` is two-valued, so the `agent-store` layer — `claimed`, while the app holds the bytes — becomes plain `readable` and the distinction the module exists for is gone. ⚠️ Ours is a drawer panel, not a workbench.',
  },
  {
    id: 'digest-window',
    kind: 'sheet',
    title: ['DIGEST WINDOW'],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: ['apps/desktop/src/shared/digest.ts'],
    importedAt: ['d60899e'],
    wiredAt: null,
    stillOnlyDrawn: [
      'an interval a person names, in a named time zone — ours is four fixed spans in epoch ms',
    ],
    note: '⚠️ **Ours is four named spans, not an interval a person types** — `ACTIVITY_WINDOWS` (Recent activity) is 1 hour / 12 hours / 24 hours / 7 days under `MAX_DIGEST_SPAN_MS`, and the wire is `digest(from, to)` in epoch ms with **no time zone**. ⛔ The drawing’s `fromLocal`/`toLocal`/`timeZone` intent has no product counterpart to bind to.',
  },
  {
    id: 'digest-gap',
    kind: 'sheet',
    title: ['MEASURED COVERAGE GAP'],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: ['apps/desktop/src/shared/digest.ts'],
    importedAt: ['d60899e'],
    wiredAt: null,
    stillOnlyDrawn: [
      'a surface that draws it — the window draws no gaps since Recent activity replaced the card',
      'a detail sheet',
      'the `unit` the drawing requires and the product does not have',
    ],
    note: '⛔ **`DigestGap` is `{kind, says, count}` over a closed six-member `DIGEST_GAP_KINDS`; the drawing’s is `{count, unit, description, detail?}` with `unit` REQUIRED.** `unit` does not exist in the product, `kind` has no slot in the drawing, and the drawing admits `count: 0` where ours says *"Never zero: a gap with no rows is not drawn."* ⚠️ Ours also counts `withheld` — the fail-closed register — which the drawing’s two registers cannot express.',
  },
  {
    id: 'decision',
    kind: 'sheet',
    title: ['PROJECT PROPOSAL', 'PERMISSION · AUTHORITY', 'QUESTION · KNOWLEDGE'],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: [
      'apps/desktop/src/renderer/src/components/PermissionCard.vue',
      'apps/desktop/src/renderer/src/components/UserInputCard.vue',
    ],
    importedAt: ['e4f04a2', 'e4f04a2'],
    wiredAt: null,
    stillOnlyDrawn: [
      'the `PROJECT PROPOSAL` arm — D-016 took proposals out of the product, so nothing answers it',
    ],
    note: '⚑ **Two of the three kinds are built.** 🔴 **D-016 took the third out**: `ProposalCard.vue` (born `af733d1`) went with proposals, so the `PROJECT PROPOSAL` arm is only drawn and stays so. ⚠️ Two lossy shapes: `decidePermission` drops three of the product’s five outcomes, and `answerQuestion` sends one string where `answers` is a map keyed by question id.',
  },
  {
    id: 'agent-message',
    kind: 'sheet',
    title: ['MESSAGE A CHILD'],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/ChildWorkViewer.vue'],
    importedAt: ['62ac595'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚑ **The composer that reaches a child is `ChildWorkViewer`’s**, handed `onSend` by `ConversationPane` and landing on `store.sendToChild(id, agentId, text)`. ⛔ **A first version of this row named `DispatchModal.vue`** — the Slice-2 dispatch gate over `lib/entities`, whose own docblock says *"The confirm is NOT wired in Slice 2"* and which contains neither `sendToChild` nor `agentId`. ⚠️ It passed every assertion here, because §4 only asks whether the file exists. ⚑ The product answers the child’s REPORT and the message to it on one surface; the drawing gives them two sheets.',
  },
  {
    id: 'agent-homes',
    kind: 'sheet',
    title: ['WORKSPACE DIRECTORY'],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/TeamWorkspace.vue'],
    importedAt: ['61fffef9'],
    wiredAt: 'ac559b33',
    stillOnlyDrawn: [],
    note: '🔴 **570 · this row was `part-imported`, rendered by `SideRail.vue`, and owed *a place*. All three are closed in one commit.** ⚠️ **What it said, kept because a ledger that quietly re-points is a ledger nobody can audit:** *"Both halves are drawn and neither is a PLACE. The rail’s AGENTS section lists `identities`, and `rail-agents-orphans` draws `foldersWithoutARow`… The drawing gathers them into a directory; we draw them as two notes in a rail."* ⛔ **`EXT-008` §4.4 ruled the rail out of that job** and `568` built the directory; `570` routed it (`RESERVED_PLACES` holds `team`, `RuntimeScreen` mounts the branch, the rail carries a destination row) and deleted the section, so the two notes are one page whose own eyebrow is this row’s `title`. ⚑ `importedAt` is `568`’s add commit and `wiredAt` is `570`’s, which is what the two columns are for. ⚠️ A first version of this row named `SessionLibrary.vue` for its `library-check-homes` button: that is `adoptSessions()`, an ACT that scans profile folders, not a reading of who lives where — the wrong pairing, and it would have passed every assertion in the test because the file exists.',
  },
  {
    id: 'review',
    kind: 'sheet',
    title: ['DESIGN REVIEW · AUTHORED EXAMPLES'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'review-scaffold',
    renders: [],
    importedAt: [],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⛔ The drawing’s own scene picker. ⚑ Never a product surface — `382` treated it the same way.',
  },
  {
    id: 'approvals',
    kind: 'sheet',
    title: ['SESSION DISCLOSURES'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/CardApproval.vue'],
    importedAt: ['d21b3125'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚑ The two exact-copy slots are still EMPTY in v2.7 and still render the refusal rather than a substitute — see {@link DISCLOSURE_FIELDS}, where the `ask` slot is ruled a permanent hole. ⛔ The delivery’s `ModeCopy.text` is a REQUIRED string, which would force an adapter to invent the `ask` paragraph this map forbids.',
  },
  {
    id: 'capabilities',
    kind: 'sheet',
    title: ['CAPABILITY POLICY'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue'],
    importedAt: ['d6ca754'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚑ This is where `SPAWN_RAIL_MEANS` is drawn. ⛔ **The drawing carried it byte-identical until `464`, which moved one word of it** (*creates* → *starts*, `456`’s verb separation reaching the sheet), and `499` then replaced its first clause when HO-036 withdrew *never `auto`, regardless of parent* — so it is a copy DIFFERENCE now rather than a reproduction, and a wide one. ⛔ The delivery’s `PolicyView` has no slot for `canSpawn`, `takesWorkFrom` or `canCreateProjects`, and booleanises `canMessage`/`canInterrupt`, which cannot distinguish `same-project` from `any`.',
  },
  {
    id: 'identity',
    kind: 'sheet',
    title: ['AGENT WORKSPACE'],
    drawnIn: ['v2.7'],
    state: 'part-imported',
    renders: ['apps/desktop/src/renderer/src/components/SessionInfo.vue'],
    importedAt: ['482a34b'],
    wiredAt: null,
    stillOnlyDrawn: ['places that hang off an IDENTITY rather than off one of its sessions'],
    note: '⚑ **The places ARE drawn** — `SessionInfo` has `cwd`, `home` and `config`, each with its own reveal (`info-reveal-cwd`, `info-reveal-home`, `config-file-*`), which is the drawing’s location grid and its Configuration locations one for one. ⛔ **They hang off a SESSION, not an identity**: `AgentIdentity` carries no `home`, no `folder` and no `role`, so there is nowhere to ask *where does this agent live* except through a conversation it is running. ⚠️ A first version of this row named `CapabilitiesSheet.vue` — which is the sheet the drawing NAVIGATES AWAY to (`Capability policy →`), and already the `capabilities` row’s file.',
  },
  {
    id: 'setup',
    kind: 'sheet',
    title: ['SESSION SETUP'],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: [
      'apps/desktop/src/renderer/src/components/SessionHeader.vue',
      'apps/desktop/src/renderer/src/components/SessionShelf.vue',
    ],
    importedAt: ['e4f04a2', 'de6e53c'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚠️ **The drawing folds into one read-only sheet what the product deliberately splits.** `setupSheet()` has NO controls — six fact rows, two path cards and a link — and the drawer says the split out loud: *"the top bar states what is true, the drawer is where you act."* ⛔ So the counterpart of a STATING sheet is the header and the shelf, not the agent card, which CHANGES three of those six facts while the conversation runs.',
  },
  {
    id: 'tool-explorer',
    kind: 'sheet',
    title: ['INVENTORY WORKBENCH · READ-ONLY'],
    drawnIn: ['v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/SessionTools.vue'],
    importedAt: ['7a27b2a'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚑ **`392` built this one and it is the only overlay in the app with gutter arithmetic** — which is why it is the surface the geometry claim is measured on. ⛔ The delivery’s `DroppedToolView {id, name, reason}` has no product counterpart: `dropped` is an integer, and `ForeignServer` carries `status: string`, not a reading. 🔴 **And `457`’s conclusion is an inventory fact about this surface**: the 200-character tool-summary bound HOLDS — `list_projects` is 353 characters of prose against **3,691** of structured payload — and `457` left the structured half with no surface anywhere in this app. ⚑ **`462` built that surface and this sentence moved with it**: `ToolAnswerViewer.vue` is an overlay raised from the tool row, on the pane’s own host, and the 200-character bound is untouched — what changed is that there is now a second place to read, not a longer row. ⚠️ **It is LIVE-ONLY on both providers**, and a replayed conversation draws the gap in words rather than an empty panel.',
  },
  {
    id: 'project',
    kind: 'sheet',
    title: ['PROJECT RECORD'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'only-drawn',
    renders: [],
    importedAt: [],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚠️ **Same id as the `project` ROUTE and a different surface** — the record sheet, not the room. The drawing keeps both. 🔴 **D-016 · only drawn, on purpose**: `ProjectSheet.vue` (born `12c8711`) went with the rest of projects, and nothing is owed here.',
  },
  {
    id: 'child',
    kind: 'sheet',
    title: ['PROVIDER-REPORTED CHILD WORK'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'imported',
    renders: ['apps/desktop/src/renderer/src/components/ChildWorkViewer.vue'],
    importedAt: ['62ac595'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⛔ The drawing still carries `child.event` as a dotted name (`child.running`, `spawn.refused`) — the invention this map refused at `382`: *"the product’s wire word is `phase`; a dotted event name is the mock’s invention and must not become a second vocabulary."*',
  },
  {
    id: 'history',
    kind: 'sheet',
    title: ['ARCHIVE · RETURN TO WORK'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'imported',
    renders: [
      'apps/desktop/src/renderer/src/components/SessionLibrary.vue',
      'apps/desktop/src/renderer/src/components/ResumableSessions.vue',
    ],
    importedAt: ['5de9201', 'e296ba9'],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚠️ `LibraryPage` has no cursors, so the drawing’s `previousCursor`/`nextCursor` bind to nothing.',
  },
  {
    id: 'unavailable',
    kind: 'sheet',
    title: ['DESIGN REVIEW · MISSING DATA'],
    drawnIn: ['v2.7'],
    state: 'review-scaffold',
    renders: [],
    importedAt: [],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⛔ The drawing’s own *"Unavailable, not invisible"* demonstration. Not a product surface.',
  },
  {
    id: 'document',
    kind: 'sheet',
    title: ['DOCUMENT · READ-ONLY', 'EXAMPLE DOCUMENT · READ-ONLY'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'imported',
    renders: [
      'apps/desktop/src/renderer/src/components/DocumentBody.vue',
      'apps/desktop/src/renderer/src/components/CanonicalDocumentViewer.vue',
    ],
    importedAt: ['a3949d6', '6679130'],
    wiredAt: '6679130',
    stillOnlyDrawn: [],
    note: 'Markdown and Raw, as the document-viewer standard requires. ⚑ **510 · the drawing’s `readDocument(documentId)` HAS a renderer-facing counterpart** — since D-016 a person-only door keyed by a resource id (`readResource`), bounded by the app’s own resources folder, with `CanonicalDocumentViewer.vue` turning the id into this paper’s `source`. ⛔ It is not the agent tool of the same name: the instruction reader beside it still keys by `(sessionId, index)` because it answers a different question. ⚑ **Both doors read one boundary** — `resourceBytes` (`main/resources/resources.ts`): the kept file is placed inside the tree and its hash re-checked on every read. ⚠️ **Two eyebrows, and the second is review chrome**: `EXAMPLE DOCUMENT · READ-ONLY` is what the drawing prints under `isFixture()`, and a row carrying only that one would have recorded the scaffold as the product-facing name.',
  },
  {
    id: 'workspace',
    kind: 'sheet',
    title: ['WORKSPACE'],
    drawnIn: ['v2.3', 'v2.7'],
    state: 'only-drawn',
    renders: [],
    importedAt: [],
    wiredAt: null,
    stillOnlyDrawn: [],
    note: '⚠️ *"A quieter overview of the workspace, without portfolio health or invented work"* — three mini-facts over the current conversation, the project record and the runtime state. 🔴 **D-016 · only drawn**: `HomeSurface.vue` answered the first two on a page and was deleted with the demo seed it drew, and the product has no project record for the second.',
  },
]
