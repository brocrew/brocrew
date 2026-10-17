<script setup lang="ts">
import { fileManagerHere } from '../lib/this-computer'
import { pathTail as basename } from '../../../shared/path-tail'
import { computed, ref, useId, watch } from 'vue'
import type {
  InstructionScope,
  InstructionSourceResult,
  RevealResult,
  SessionInstructions as Instructions,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import type { ToolRegistry } from '../lib/transcript'
import { layerBytes, toldView } from '../lib/told'
import { REGISTER_WORDS } from '../lib/digest'
// ⚑ **583 · the second question over the same material** — `HO-073` §4, *whose is this text*.
import {
  NOTHING_OF_YOURS_YET,
  THIS_SHEET_CANNOT_SAY_WHAT_IS_YOURS,
  whoseGroups,
  type ToldBlock,
} from '../lib/whose-groups'
import { LAYER_STAYS_IN_THE_ACCOUNT } from '../../../shared/whose-text'
import { textViewFor } from '../../../shared/documents'
import DocumentBody from './DocumentBody.vue'
import { refusalWords } from '../lib/refusal-words'

/**
 * **What this conversation's model was told before it was asked anything** (158).
 *
 * Expose the custom instructions and system hints supplied to the agent. Text appended to a session's system prompt must have a visible renderer representation.
 *
 * ## Three rules this block obeys
 *
 * 1. **The source AND the text, per item** — never a merged blob. 086: name what it is and where it
 *    came from. Each row is one file, at its real path, and its bytes open on the same paper every
 *    other document in this app opens on.
 * 2. **Nothing where nothing was injected.** No heading, no "none", no empty list — an empty
 *    section is 086 in the other direction, and a conversation that was told nothing extra should
 *    look exactly like one that has no such feature.
 *
 *    ⚠️ **It is about the ROWS, and `536` had to establish that before it could land a
 *    sentence.** ⛔ **A row is a FILE and a layer is a CLAIM about the prompt**, and the *what it
 *    was told* block at the top of this component is a claim to have accounted for the prompt —
 *    which is why `442` draws the opaque layers rather than omitting them, and why
 *    `appendedNothing` states an absence in words instead of drawing an empty layer. ⚑ **The same reasoning covers the agent's memory**
 *    (`TOLD_REMEMBERS_NOTHING`): the store's absence is stated once, in the account, and the file
 *    list below stays exactly as empty as this rule requires.
 * 3. **Ours and the provider's are different claims.** What BroBot read and appended is one list;
 *    what Codex reports it loaded by itself is another, with paths and no text, and it says so. We
 *    did not choose those files and must not appear to have.
 *
 * ⚠️ **It says THAT it was read at launch.** These files are read at launch; editing one takes
 * effect the next time the conversation is opened. A panel that looked live would be claiming a
 * thing the live-profile semantic explicitly does not do (158 §2).
 *
 * 🔴 **599 · and that is not the same claim as saying WHEN, which this panel still does not make.**
 * ⛔ **This sentence read *"It says when it was read"* until 599 and it was about the DISCLOSURE**
 * — `TOLD_IS_THE_LAST_LAUNCH`'s *"from the files as they were then"*, drawn above the rows.
 * ⚠️ **Nothing here has ever printed a moment**, and a reader arriving from `HO-084` §3 —
 * *"whatever BroBot itself appends says WHEN it was read"* — would have read the old wording as
 * *already done*. ⚑ **Corrected rather than deleted** (142): what it meant is kept and the word
 * that overclaimed is gone.
 *
 * ⚑ **The number now exists and this panel does not draw it.** `InjectedInstruction.readAt` carries
 * the moment this app asked for each appended file's bytes; `HO-087` §2 queues the surface for the
 * UI pass. ⛔ **Two things that pass need deciding there rather than here**: the agent's memory rows
 * carry no such stamp on purpose (the provider read those, not us), and the account already states
 * one as-of in words — *"a second as-of would be two answers"*, which is the note
 * `what-an-agent-was-told.test.ts` leaves beside `ToolRegistry.at`.
 */
const props = defineProps<{
  instructions: Instructions
  /**
   * Read one file the provider reported, on request (356 §2).
   *
   * ⛔ **An INDEX into {@link Instructions.provider}, and the position is the address.** The list is
   * the provider's; naming a row by where it sits in the list this component drew is the only
   * address that cannot become an arbitrary-file read. ⚠️ **Optional, and its absence draws no
   * button** — a panel with no door must not offer one.
   */
  onReadInstruction?: (index: number) => Promise<InstructionSourceResult>
  /** Show one of this session's paths in the file manager (356 §1). Optional for the same reason. */
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
  /**
   * 🔴 **The conversation's own tool registry, for the derived verb count** (442 §3.3).
   *
   * ⚠️ **Optional, and its absence is not zero.** A mount that supplies none gets the layer's
   * *"this conversation has not reported which verbs it was handed"* wording, which is what a
   * conversation that has not started really is — see `verbsPublished` in `lib/told.ts`.
   */
  tools?: ToolRegistry | null
  /**
   * ⛔ **Whether this conversation has an EARLIER LIFE whose composition nobody kept** (442 §1).
   *
   * ⚡ **Required rather than defaulted**, because the default would be the reassuring one. The
   * caller derives it from `SessionRecord.liveFrom`, whose own contract is *"null means this
   * session was never reopened and there is no previous life to leave behind"* — so every mount
   * states a fact instead of inheriting a `false` nobody chose.
   */
  relaunched: boolean
}>()

/**
 * 🔴 **The agent's own memory, normalised rather than trusted** (317).
 *
 * ⛔ The field is `InjectedInstruction[]` now and was `InjectedInstruction | null` until 314, and
 * before 165 it did not exist. ⚠️ **All three shapes really reach this component** — a host that
 * predates the field sends none, and the type is a promise about NEW values, not about the object
 * in front of us. `v-for` over 165's single object would have iterated its own keys and drawn a row
 * per property; the `Array.isArray` is what makes that unreachable rather than unlikely.
 */
const agentMemory = computed(() =>
  Array.isArray(props.instructions.agentMemory) ? props.instructions.agentMemory : [],
)

/**
 * 🔴 **One launch's composition, as LAYERS — including the ones this app cannot see** (442,
 * criterion 24).
 *
 * ⛔ **Derived here rather than sent, and the difference matters for exactly one field.** The
 * layer list is a LABELLING of facts already on the wire; {@link SessionInstructions.composed} is
 * the one thing that could not be labelled into existence, so main sends it — the same string it
 * handed the adapter. ⚠️ A renderer that reassembled it from the rows below would be showing a
 * reconstruction where the criterion asks for what was sent (`430`: the Observer *"can display
 * them, not reconstruct missing provider layers"*).
 */
const told = computed(() => toldView(props.instructions, props.tools, props.relaunched))

/**
 * 🔴 **The same launch, asked the OTHER question** (583, `HO-073` §4): not *what reached the
 * model* but *whose each part of it is*.
 *
 * ⛔ **Fed the account's OWN layers rather than re-deriving them**, so the fail-closed filter runs
 * once — a layer this window could not label is withheld from both readings or from neither.
 */
const grouped = computed(() => whoseGroups(props.instructions, told.value.layers))

/**
 * ⚑ **The layers that stay in the account, because they belong to no owner** — today exactly one,
 * the composition as sent, which is this app's account of the prompt rather than a part of it.
 *
 * ⛔ **Derived from the same table the groups filter on**, so a layer given an owner leaves this
 * list in the same edit rather than being drawn twice or not at all.
 */
const accountLayers = computed(() =>
  told.value.layers.filter((layer) => LAYER_STAYS_IN_THE_ACCOUNT.includes(layer.kind)),
)

/**
 * 🔴 **One tab per owner, and the last of them is the prompt itself** (583, relay 2).
 *
 * Group instruction owners into tabs with light text and visual summaries, and offer the final rendered input as sent.
 *
 * ⚠️ **Six headings stacked down one column is the same wall with rules drawn in it.** ⚑ A tab
 * shows one owner's rows and nothing else, so the page a person is on is always short — and
 * {@link AS_SENT} is the thing the sheet never had: the composed prompt, whole, on paper.
 */
const AS_SENT = 'as-sent'
/** Files the walk refused. They have no owner — nothing was read, so there is nothing whose. */
const NOT_READ = 'not-read'

/**
 * Which tab a person has PICKED — empty until they pick one.
 *
 * ⛔ **Empty rather than a default spelled twice.** {@link current} answers *which tab is on
 * screen* from the live list, so the landing tab is decided in one place and a selection that
 * stops existing falls back rather than drawing an empty sheet.
 */
const tab = ref<string>('')

/**
 * One tab: what it is called, how much is under it, and its share of what this sheet holds.
 *
 * ⚠️ **{@link Tab.count} counts LAYERS AND BLOCKS, which is not every element on the tab** (found
 * in review). The `not shown` tab also draws one row per file the provider reported, and those
 * are counted by their own layer's own count — so the badge says *three things named here* and
 * the layer under it says *two of them are files*. ⛔ A badge that summed both would count the
 * same files twice.
 */
interface Tab {
  readonly key: string
  readonly label: string
  readonly count: number | null
  readonly bytes: number
}

/**
 * ⛔ **Derived from the groups, never typed** — a tab whose group is not drawn is not a tab, and
 * the two cannot come apart because there is one list.
 */
const tabs = computed<Tab[]>(() => {
  const out: Tab[] = grouped.value.groups
    .filter((group) => group.drawn)
    .map((group) => ({
      key: group.whose,
      label: group.heading,
      count: group.layers.length + group.blocks.length,
      bytes: group.bytes,
    }))
  if (props.instructions.refused.length > 0) {
    out.push({
      key: NOT_READ,
      label: 'not read',
      count: props.instructions.refused.length,
      bytes: 0,
    })
  }
  out.push({ key: AS_SENT, label: 'as sent', count: null, bytes: 0 })
  return out
})

/**
 * ⚑ **The tab a person lands on: the first owner with something in it.**
 *
 * ⛔ **Not {@link AS_SENT}**, which is 2.5 KB of markdown — the wall this dispatch exists to take
 * down, restored as a default. ⚠️ It is one press away and it is the last tab, which is where a
 * *show me the whole thing* affordance belongs.
 */
function firstTab(): string {
  return tabs.value[0]?.key ?? AS_SENT
}

/**
 * 🔴 **The tab actually on screen.**
 *
 * ⛔ **Resolved against the live list rather than trusted**, because the list moves under it: a
 * conversation's memory arriving makes `the agent's own` appear and nothing removes a tab, but a
 * host one build behind can send a shape where the selected owner has nothing in it. ⚠️ A
 * selection pointing at a tab that is not there would draw an empty sheet with no way back.
 */
const current = computed(() =>
  tabs.value.some((one) => one.key === tab.value) ? tab.value : firstTab(),
)

/** The group the current tab is showing, or `null` on the two tabs that are not a group. */
const showing = computed(
  () => grouped.value.groups.find((group) => group.whose === current.value) ?? null,
)

/**
 * ⚑ **A tab's share of what this app appended, as a percentage** — the one picture on this sheet.
 *
 * ⛔ **Of what this sheet HOLDS, and the caption says so beside itself.** The provider's own layer
 * is the largest part of a real prompt and has no size we can put in a bar; a bar that omitted it
 * while looking like the whole prompt would be `442` §2.1's false claim drawn rather than written.
 *
 * ⚠️ **`<1%` rather than `0%` for a group that has something** (found in review). `Math.round`
 * printed the same number and the same empty bar for a 40-byte file as for the group that holds
 * nothing at all, which is the one distinction this picture exists to make.
 */
function share(bytes: number): string {
  const whole = grouped.value.held
  if (whole === 0 || bytes === 0) return '0%'
  const part = Math.round((bytes / whole) * 100)
  return part === 0 ? '<1%' : `${String(part)}%`
}

/** How wide to draw the fill. A group with something always draws a sliver. */
function fill(bytes: number): string {
  const whole = grouped.value.held
  if (whole === 0 || bytes === 0) return '0%'
  return `${String(Math.max(1, Math.round((bytes / whole) * 100)))}%`
}

/** Which layer explanations are open. Collapsed by default — 356 §1, the same rule as the rows. */
const openLayers = ref<Set<string>>(new Set())

/** Whether the current tab's full membership sentence is open. One press, `356` §1's rule. */
const whyGroup = ref(false)

/**
 * ⚑ **Move to a tab, and close the sentence that belonged to the last one.**
 *
 * ⛔ **One `whyGroup` for all of them rather than a set keyed by tab**, because only one tab is on
 * screen: a set would remember a fold nobody can see and reopen it under a different heading.
 */
function pick(key: string): void {
  tab.value = key
  whyGroup.value = false
}

/**
 * 🔴 **A `role="tablist"` PROMISES arrow keys, and a promise a control does not keep is worse
 * than a plainer control** (`a-custom-focus-trap-is-the-tab-order`, one pattern over).
 *
 * ⛔ **Roving tabindex with it**: the strip is ONE stop in the page's tab order and the arrows
 * move within it, which is what the role tells a screen reader to expect. ⚠️ Without both halves
 * the announcement and the behaviour disagree, and the one a person can check is the behaviour.
 */
function steer(event: KeyboardEvent, at: number): void {
  const keys = tabs.value.map((one) => one.key)
  const to =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? (at + 1) % keys.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? (at - 1 + keys.length) % keys.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? keys.length - 1
            : -1
  if (to < 0) return
  event.preventDefault()
  const key = keys[to]
  if (key === undefined) return
  pick(key)
  // ⚑ **Focus follows selection**, which is the pattern's own default for a tablist whose panels
  // are already in the document — nothing is fetched, so there is no reason to make a person
  // press twice.
  strip.value?.querySelector<HTMLButtonElement>(`[data-cy="told-tab-${key}"]`)?.focus()
}

/** The strip itself, so {@link steer} can move focus inside it without a document-wide query. */
const strip = ref<HTMLElement | null>(null)

/**
 * ⚑ **Ids for the tab/panel pairing**, minted per mount — this component can be on screen beside
 * another copy of itself and two `id="told-tab"`s would make `aria-controls` ambiguous.
 */
const tabId = useId()
const panelId = useId()

/** `1,204 B` / `12.3 KB` — the size of a thing, said the way every row here says it. */
function bytesLabel(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * ⛔ **Whether the composition's own explanation is open** — 356 §1 again: *a path is data, an
 * explanation is documentation*. ⚠️ Its own ref rather than `why`, which belongs to the block
 * below and is reset on the same watcher for a different subject.
 */
const whyTold = ref(false)

function toggleLayer(id: string): void {
  const next = new Set(openLayers.value)
  if (!next.delete(id)) next.add(id)
  openLayers.value = next
}

/*
 * ⚑ **`anything` is gone, and rule 2 is not** (583). ⛔ The boolean gated one `instructions`
 * section over four empty lists; every group now decides for itself from what is in it
 * ({@link WhoseGroup.drawn}), which is the same rule per heading instead of per panel — and it is
 * what lets the one group that must be drawn empty say so.
 */

/**
 * Which rows are open. Collapsed by default: the PATHS are the disclosure, the text is the read.
 *
 * ⚠️ **Keyed by {@link ToldBlock.key} since `583`, not by path.** The compiled bundle is one path
 * and several rows now — one per section — and a path key would have opened all of them at once.
 */
const open = ref<Set<string>>(new Set())

function toggle(key: string): void {
  const next = new Set(open.value)
  if (!next.delete(key)) next.add(key)
  open.value = next
}

/**
 * ⛔ **Truncation says a different thing about a file the MODEL was given and about one the agent
 * can go and fetch** — and the difference was carried by which loop a row was in until `583`
 * merged them.
 *
 * ⚑ **`reach` is the discriminant and it is not a proxy**: it is set on exactly the rows whose
 * text may never have reached the prompt (`317` §2.2), which is the same set the softer sentence
 * was written for. ⚠️ *"The model was given this much"* on a note the model has never opened
 * would be `009`'s rule broken — the defect `REACH_WORDS` exists to prevent, arriving through the
 * truncation line instead.
 */
function truncatedWords(block: ToldBlock): string {
  return block.reach === undefined
    ? 'cut at the size limit — the model was given this much and no more'
    : 'cut at the size limit — this much was shown here'
}

const LABELS: Record<ToldBlock['kind'], string> = {
  // 🔴 **The app's own instructions for this profile** (377) — factory rules and the person's own
  // configured text — which `582` gave them somewhere to write — compiled at every launch.
  //
  // ⛔ **It must not read as `profile memory`, which is the file one line down and one directory
  // over.** That one the AGENT writes and this one the APP overwrites every launch: two owners, two
  // doors, and 086's rule is that a reader who cannot tell them apart edits the wrong file — here,
  // by putting a durable rule in the file that is about to be regenerated over it.
  'profile-instructions': 'profile instructions — written by BroCrew at this launch',
  'profile-memory': 'profile memory',
  'project-memory': 'project memory',
  // 🔴 **A repository's shared `AGENTS` file, read for Claude because Claude does not read it**
  // (377, from `364` §2.3). ⛔ **Named as SHARED rather than as a Claude file**, because that is the
  // whole reason the row exists: Codex discovers these natively, so this app reads the same
  // selection for the other engine and the two agents get the same conventions. ⚠️ A person seeing
  // it here should be able to tell that BroBot chose to send it — which is what separates it from
  // the provider's own list below.
  'repository-conventions': 'repository conventions — the file both engines share, read by BroCrew',
  // ⚠️ Named as the app's own, not as the user's. The app generates this file and overwrites it on
  // every launch, so presenting it as something found in the working directory would be a lie by
  // omission — the same provenance point 086 makes about merged blobs.
  'workspace-instructions': 'workspace instructions — written by BroCrew',
  // ⛔ **The only rows on this panel whose author is the AGENT** (165). Both halves are said because
  // both are surprising: the model wrote this file, and the provider — not BroBot — is what loads
  // it. A user who reads "memory" and assumes BroBot chose to send it would edit the wrong thing,
  // which is the same provenance point 086 makes about a merged blob.
  //
  // ⚠️ **It said "loaded by Claude itself" until 317, and that went false at 314** — the dispatch
  // that gave Codex a memory too. ⚑ The provider NAME is what goes; the distinction it was
  // protecting is what stays, and it stays twice over: "loaded by the provider" here, and
  // {@link REACH_WORDS} below saying which files the provider actually put in the prompt.
  'agent-memory': 'agent memory — written by the agent, loaded by the provider',
  // Distinguish a memory note the agent was asked to write from memory it chose to keep. The author is the same, but the provenance differs.
  'agent-memory-note': 'agent memory — a note the agent was asked to write',
  // ⛔ **One memory, in its own file** (322). Not the row above, and the difference is the DOOR: a
  // note is what somebody asked for, and this is what the agent filed — most of them unprompted,
  // because the provider tells it to. ⚠️ **And not the `agent-memory` row either**, which says
  // *"loaded by the provider"* and is true of exactly one file in this store. The provider loads
  // the index; these it leaves on disk, and `REACH_WORDS` below says so on every row.
  'agent-memory-topic': 'agent memory — one memory the agent filed, in its own file',
  // 🔴 **D-024 · R1 — what is true of this conversation, composed for its launch alone** — read from
  // no file, so its row names no path: the profile's file is shared by every conversation of the
  // profile, and this text never lands in it.
  'this-conversation': 'this conversation — composed by BroCrew at this launch',
}

/**
 * 🔴 **In the prompt, or merely on disk** (317 §2.2) — and the panel must never blur the two.
 *
 * 312 measured Codex injecting exactly one file of its memory store and leaving the rest for the
 * `memories__*` tools to fetch **if the model chooses to**. ⛔ Rendering a note the agent has never
 * opened as though the model had read it is 009's rule broken and 305's defect repeated, so the
 * on-request wording says what is true of it — that it is available — and stops there.
 */
const REACH_CHIP: Record<string, string> = {
  prompt: 'in the prompt',
  'on-request': 'on request',
}

const REACH_WORDS: Record<string, string> = {
  prompt: 'the provider put this in the prompt — BroCrew did not',
  'on-request': 'in the agent’s memory store — it reads this one only if it chooses to',
}

/**
 * 🔴 **Which layer a provider-reported file belongs to** (356 §3) — 357's one required change.
 *
 * ⛔ **Two words, and they answer the question the panel was getting wrong.** 357 measured a session
 * whose only instruction file was the project's and found this block presenting it as though the
 * selected profile owned it: *"it must never be presented as proof that the selected profile owns
 * it."*
 *
 * ⚠️ **`elsewhere` is a real answer, not a fallback that never fires.** A provider may load a file
 * from neither this session's home nor its working directory; saying so is the honest version of a
 * label we cannot justify. ⛔ **And the scope is decided in MAIN** — this map only names it. See
 * `main/runtime/instruction-scope.ts`.
 */
const SCOPE_WORDS: Record<InstructionScope, string> = {
  profile: 'this profile',
  project: 'this project',
  // ⚠️ **`unknown` is the host's word and `elsewhere` is the reader's.** The host must not guess, so
  // its value says *we did not establish this*; a person reading a row wants to know where the file
  // is, and *elsewhere* answers that without claiming the layer nobody could name. ⛔ Exhaustive by
  // type: a fourth scope does not compile until it has a word here.
  unknown: 'elsewhere',
}

/**
 * ⚑ **Whether any file above is this profile's own** (356 §3).
 *
 * ⛔ **An absence has to READ as an absence.** 357's finding is that this app authors no profile
 * instruction file, so on an ordinary session every row here is the project's — and a list of
 * project files with nothing said about the other layer reads as *"this is what the profile has"*.
 * ⚠️ Said only where the provider reported something, because a block that is not drawn cannot be
 * misread, and an absence stated about an empty list is 086 in the other direction.
 */
const noProfileLayer = computed(
  () =>
    props.instructions.provider.length > 0 &&
    !props.instructions.provider.some((item) => item.scope === 'profile'),
)

/**
 * The one provider file being read right now, and what came back.
 *
 * ⛔ **One at a time, keyed by INDEX**, which is also the address the read takes: two open papers in
 * a 320px column is a scroll, and the row that was pressed is the only one a person is reading.
 */
const reading = ref<{ index: number; result: InstructionSourceResult } | null>(null)

/** Which press is the current one — see {@link readProvider}. Not reactive; nothing renders it. */
let pressed = 0

const READ_REFUSALS: Record<string, string> = {
  'no-source': 'this conversation does not report that file',
  gone: 'there is nothing there any more',
  // ⚑ 731 · refused only when it cannot be drawn as text (a binary, UTF-16, a folder); until `731` a
  // file that was not Markdown was refused too, and this read *"this app will not open that file"*.
  'not-readable': 'it cannot be shown as text here',
  unreadable: 'it is there, and it could not be read',
}

async function readProvider(index: number): Promise<void> {
  const ask = props.onReadInstruction
  if (!ask) return
  // A second press on the open row closes it — the same gesture the file rows above use.
  if (reading.value?.index === index) {
    reading.value = null
    return
  }
  reading.value = null
  // ⛔ **The row that was PRESSED last wins, not the read that resolves last.** Two quick presses on
  // different rows race, and without the token the slower answer lands under the other row's path.
  const token = (pressed += 1)
  const result = await ask(index)
  if (token === pressed) reading.value = { index, result }
}

/** The last reveal that could not happen, and which row asked. */
const revealRefusal = ref<{ index: number; reason: string } | null>(null)

const REVEAL_WORDS: Record<string, string> = {
  'no-path': 'this conversation does not report that file',
  gone: 'there is nothing there any more',
}

async function revealProvider(index: number): Promise<void> {
  const ask = props.onRevealPath
  if (!ask) return
  revealRefusal.value = null
  const said = await ask({ of: 'instruction-source', index })
  if (!said.ok) revealRefusal.value = { index, reason: said.reason }
}

/**
 * Whether the block's own explanation is open. Collapsed by default (356 §1).
 *
 * ⚠️ **Separate from {@link open}, which is keyed by PATH.** These are two disclosures with two
 * subjects: one opens a file's text, this one opens the paragraph about the list.
 */
const why = ref(false)

/**
 * 🔴 **A read belongs to the conversation it was made in, and this component outlives one.**
 *
 * ⛔ **Found reviewing this dispatch's own diff.** Nothing between here and `RuntimeScreen` carries a
 * `:key`, so switching conversations changes `props.instructions` and re-renders in place — and
 * `reading` is keyed by INDEX. Row 0 of the next conversation would have shown the previous one's
 * file text, under the previous one's bytes, beneath the sentence *"Read just now, from disk"*.
 * That is the exact lie 356 §2 was careful to avoid, arriving through the back door.
 *
 * ⚠️ **Watched on the instructions OBJECT**, which is a launch fact and is replaced only when the
 * conversation is — the liveness channel does not touch it, so this cannot close a fold under
 * somebody's hands. {@link open} is keyed by PATH and is reset for the same reason.
 */
watch(
  () => props.instructions,
  () => {
    reading.value = null
    revealRefusal.value = null
    open.value = new Set()
    why.value = false
    whyGroup.value = false
    // ⚑ **Back to the landing tab**, not to whatever the previous conversation was showing — a
    // tab is a place on THIS sheet, and the sheet is about that conversation. ⚠️ Cleared rather
    // than set: the groups for the new conversation have not been derived at this point, and
    // {@link current} is what decides where empty lands.
    tab.value = ''
    // ⚠️ **The layer folds too** (442), and AFTER the four above rather than among them: `356 M34`
    // anchors on those exact lines in that exact order, and an insertion between them would retire
    // somebody else's row over a blank line (`correct-a-stale-mutation-anchor-dont-retire-it`).
    // ⛔ **The rule is the same one** — an open *"what BroBot appended"* body left standing across a
    // conversation switch would be the previous conversation's prompt under the next one's heading.
    openLayers.value = new Set()
    whyTold.value = false
  },
)

const fileManager = fileManagerHere()
</script>

<template>
  <!-- 🔴 **What this agent was told — one tab per owner, and the last one is the prompt itself**
       (442; 583, `HO-073` §4, and its relay).

       Use one owner per tab, with a bar showing its share of the prompt. Put explanations longer than a line behind a disclosure so ownership is visible without a column of paragraphs.

       ⚠️ **Nothing was removed** (583 §6). The account keeps the layer only it can answer for and
       it lives on `as sent`, which is also the thing the sheet never had: the composed prompt,
       whole, on paper.

       ⚑ **`data-subject="agent"` heads it, and it is the rail** (`HO-050` §1.1). ⛔ **A tab
       called *this conversation's* is not a breach of it, and the axes are why**: `HO-050` sorts
       facts by LIFETIME and `HO-009` §2 sorts instruction text by WHO MAY WRITE. ⚠️ Not one
       `conversation` entry in `WHOSE_FACT` is drawn inside this component, which is the thing the
       rail actually measures. -->
  <div class="told-and-told-with" data-cy="agent-instructions" data-subject="agent">
    <!-- 🔴 **Withheld, and counted, ABOVE the tabs** (438's fail-closed rule, inherited). ⛔ A
         layer this window could not label belongs to no owner, so there is no tab it could sit
         behind — and a silent drop is the omission HO-024 §5.3 forbids. -->
    <div v-if="told.withheld > 0" class="refused" data-cy="told-withheld">
      {{ told.withheld }}
      {{ told.withheld === 1 ? 'layer was' : 'layers were' }} withheld: this app would not say how
      it knew {{ told.withheld === 1 ? 'it' : 'them' }}.
    </div>

    <!-- 🔴 **The scope of everything below it, and NOT behind a press** — `442` §2.2 calls this
         sentence the deliverable even if nothing else lands, and its own rule is that *a scope a
         reader has to open is a scope most readers never see*. ⛔ **A tab is a press**, so putting
         it on `as sent` was that rule broken with a different lid (found reviewing this diff).
         ⚠️ It is the one paragraph on this sheet that earns its place unasked. -->
    <div class="muted standing" data-cy="told-sentence">{{ told.says }}</div>
    <div v-if="told.earlier" class="muted absent" data-cy="told-earlier">{{ told.earlier }}</div>

    <!-- ⚑ **The tabs.** ⛔ `role="tab"` and `aria-selected` rather than a pressed look alone:
         `578`'s rule is that a control is a box, and this is the one place on this sheet where
         what a person presses decides what they are reading. -->
    <div
      ref="strip"
      class="tabs"
      role="tablist"
      aria-label="What this agent was told"
      data-cy="told-tabs"
    >
      <button
        v-for="(one, at) in tabs"
        :key="one.key"
        class="tab"
        :class="{ on: one.key === current }"
        type="button"
        role="tab"
        :id="`${tabId}-${one.key}`"
        :aria-selected="one.key === current"
        :aria-controls="panelId"
        :tabindex="one.key === current ? 0 : -1"
        :data-cy="`told-tab-${one.key}`"
        @click="pick(one.key)"
        @keydown="steer($event, at)"
      >
        {{ one.label }}
        <span v-if="one.count !== null" class="tab-count">{{ one.count }}</span>
      </button>
    </div>

    <div
      :id="panelId"
      class="panel"
      role="tabpanel"
      :aria-labelledby="`${tabId}-${current}`"
      data-cy="session-instructions"
    >
      <!-- ─────────────────────────────────────────────────── one owner's tab -->
      <template v-if="showing">
        <!-- 🔴 **The one picture: how much of what BroBot appended this tab is.**
             ⛔ **Of what this app HOLDS, and the line beside it says so.** The provider's own layer is
             the largest part of a real prompt and has no size we can put in a bar; a bar that omitted
             it while looking like the whole prompt would be `442` §2.1's false claim, drawn. -->
        <div v-if="showing" class="size" data-cy="told-size">
          <div class="size-bar" :aria-hidden="true">
            <span class="size-fill" :style="{ width: fill(showing.bytes) }"></span>
          </div>
          <div class="size-says" :data-cy="`told-share-${showing.whose}`">
            {{ share(showing.bytes) }} of the {{ bytesLabel(grouped.held) }} this sheet
            holds<template v-if="showing.whose === 'not-held'">
              — none of it is theirs, because this sheet holds no text of theirs</template
            >
          </div>
        </div>

        <!-- ⛔ **The half of the role's promise that is about WHICH panel** (found by a re-aiming
             agent). ⚠️ `aria-selected` and the roving tabindex were both here; without `aria-controls`
             and `aria-labelledby` a screen reader is told there is a tab strip and never told what any
             tab owns — the announcement and the structure disagreeing, which is the same shape as
             `a-custom-focus-trap-is-the-tab-order` one pattern over. -->

        <div class="lead-short" :data-cy="`told-group-says-${showing.whose}`">
          {{ showing.short }}
          <button
            class="why inline"
            type="button"
            :aria-expanded="whyGroup"
            :data-cy="`told-group-why-${showing.whose}`"
            @click="whyGroup = !whyGroup"
          >
            more
          </button>
        </div>
        <div v-if="whyGroup" class="note muted" :data-cy="`told-group-more-${showing.whose}`">
          {{ showing.says }}
        </div>

        <!-- ⛔ **A layer whose owner this is** — `442`'s account row, under its owner. -->
        <div
          v-for="layer in showing.layers"
          :key="layer.id"
          class="item"
          :data-cy="`told-layer-${layer.kind}`"
        >
          <button
            class="head"
            type="button"
            :aria-expanded="openLayers.has(layer.id)"
            :data-cy="`told-why-${layer.kind}`"
            @click="toggleLayer(layer.id)"
          >
            <svg class="icon chev" :class="{ down: openLayers.has(layer.id) }">
              <use href="#i-chevron" />
            </svg>
            <span class="layer-title">{{ layer.title }}</span>
            <span class="spacer"></span>
            <span v-if="layer.count !== null" class="count" :data-cy="`told-count-${layer.kind}`">{{
              layer.count
            }}</span>
            <span
              class="register"
              data-cy="told-register"
              :data-register="layer.register"
              :title="REGISTER_WORDS[layer.register].title"
            >
              {{ REGISTER_WORDS[layer.register].label }}
            </span>
          </button>
          <div v-if="openLayers.has(layer.id)" class="layer-body">
            <div class="muted" :data-cy="`told-says-${layer.kind}`">{{ layer.says }}</div>
          </div>
        </div>

        <!-- 🔴 **One block of the prompt: a whole file, or one section of the compiled bundle.**
             ⛔ **`data-whose` and `data-kind` as well as the words, and 163 is why**: a test that
             has to parse a heading to learn which tab a row landed in is a test that passes on the
             placeholder. The attributes are the answer; the words are for the person. -->
        <div
          v-for="block in showing.blocks"
          :key="block.key"
          class="item"
          data-cy="told-block"
          :data-kind="block.kind"
          :data-whose="block.whose"
          :data-heading="block.heading ?? ''"
          :data-truncated="block.truncated"
        >
          <button
            class="head"
            type="button"
            :aria-expanded="open.has(block.key)"
            data-cy="told-block-toggle"
            @click="toggle(block.key)"
          >
            <svg class="icon chev" :class="{ down: open.has(block.key) }">
              <use href="#i-chevron" />
            </svg>
            <span class="name">{{ block.name }}</span>
            <span class="spacer"></span>
            <!-- ⚠️ **Whether the model was given this, or could go and get it** (317 §2.2), as a
                 chip rather than a sentence — it is true of every row in this tab and reading it
                 six times is what a chip is for. -->
            <span v-if="block.reach" class="chip" :data-cy="`memory-reach-${block.reach}`">
              {{ REACH_CHIP[block.reach] ?? block.reach }}
            </span>
            <span v-if="block.truncated" class="chip cut" data-cy="told-block-truncated">cut</span>
            <span class="bytes">{{ layerBytes(block.text) }}</span>
          </button>
          <div v-if="open.has(block.key)" class="opened">
            <!-- ⛔ **The path is rule 1 of this panel** (`086`: *each row is one file, at its real
                 path*) and it is HERE rather than in the resting row. ⚑ Seven sections of one
                 bundle printed a 104-character path seven times and buried the headings the split
                 exists to show; a person who wants the address is a person who has opened the row. -->
            <div class="where">
              <!-- 🔴 **The file's own provenance, kept** (`086`; `165`, `317` §2.1, `322`, `377`).
                   ⛔ **The group heading says whose a row is; this says WHICH of that owner's
                   things it is** — *a note the agent was asked to write* and *one memory the agent
                   filed* are two provenances under one owner, and `086`'s rule is that a reader
                   who cannot tell them apart edits the wrong file. ⚠️ **Found because the tab
                   rewrite dropped it**: six mutation rows mutate these strings, and a line nothing
                   renders is a line no mutation can kill
                   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ Behind the press
                   rather than on the row, because it is a second-order distinction and the tab
                   above already carries the first. -->
              <span class="label" data-cy="told-block-label">{{ LABELS[block.kind] }}</span>
              <span v-if="block.path !== null" class="path">{{ block.path }}</span>
              <!-- 🔴 **733 · WHO followed it.** The agent's memory is loaded by the provider, which
                   follows the link itself (170 §2); since `733` every file BroBot appends follows
                   one too, and there it is BroBot that did. -->
              <span v-if="block.link" class="refused" data-cy="told-block-link">
                · a link —
                {{
                  block.kind.startsWith('agent-memory')
                    ? 'the provider followed it and read'
                    : 'BroCrew followed it and read'
                }}
                <span class="path">{{ block.link }}</span>
              </span>
            </div>
            <div v-if="block.reach" class="muted" :data-cy="`memory-reach-says-${block.reach}`">
              {{ REACH_WORDS[block.reach] ?? block.reach }}
            </div>
            <div v-if="block.truncated" class="cut" data-cy="told-block-truncated-says">
              {{ truncatedWords(block) }}
            </div>
            <DocumentBody :source="block.text" :filename="block.name" compact />
          </div>
        </div>

        <!-- 🔴 **The state every identity is in until somebody writes one** (`HO-073` §2). -->
        <!-- ⛔ **Two sentences, because an empty group means two different things** (found
             reviewing this diff). ⚠️ `readSessionInstructions` returns `injected: []` for every
             non-Claude provider — that engine reads the leaf BroBot published, itself — so there
             the group is empty whether or not a person has written rules, and their rules really
             are in the agent's prompt. 🔴 *Nothing of yours reaches this agent yet* was the
             opposite of the truth on that provider, which is the worst thing this sheet can say:
             that a standing rule is not reaching an agent that is following it. ⚑ **D-024 · R1 —
             asked of NO FILE sent**: that provider is now sent this conversation's own text. -->
        <div
          v-if="showing.whose === 'configured' && showing.blocks.length === 0"
          class="muted absent"
          data-cy="told-nothing-of-yours"
        >
          {{ told.appendedNoFile ? THIS_SHEET_CANNOT_SAY_WHAT_IS_YOURS : NOTHING_OF_YOURS_YET }}
        </div>

        <!-- ⚑ **The agent's store, and what this app may not say about it.** -->
        <template v-if="showing.whose === 'learned'">
          <div v-if="told.remembers" class="muted absent" data-cy="told-remembers-nothing">
            {{ told.remembers }}
          </div>
          <div
            v-if="agentMemory.length > 0"
            class="muted lead"
            data-cy="memory-store-not-a-reading"
          >
            Nothing here says which of these the agent has actually looked up.
            <span v-if="instructions.recallsReported" data-cy="memory-store-recall-is-shown">
              When it does look one up, it says so in the conversation, where it happened.
            </span>
            <span v-if="instructions.writesReported" data-cy="memory-store-write-is-shown">
              When it writes one, the conversation shows the write itself.
            </span>
          </div>
        </template>

        <!-- …and what the PROVIDER says it read by itself. Paths, and no content — which is why
             it is in this tab and not in one with an owner's name on it. -->
        <template v-if="showing.whose === 'not-held' && instructions.provider.length > 0">
          <div class="muted lead" data-cy="provider-instructions-lead">
            Reported by the provider.
          </div>
          <div
            v-for="(item, index) in instructions.provider"
            :key="item.path"
            class="item flat"
            data-cy="provider-instruction"
          >
            <div class="line">
              <span class="path">{{ item.path }}</span>
              <span class="scope" data-cy="provider-scope" :data-scope="item.scope">
                {{ SCOPE_WORDS[item.scope] }}
              </span>
            </div>
            <div v-if="props.onReadInstruction || props.onRevealPath" class="acts">
              <!-- ⚑ **Two affordances, and the panel says which is which** (356 §1). -->
              <button
                v-if="props.onReadInstruction"
                class="act"
                type="button"
                :aria-expanded="reading?.index === index"
                data-cy="provider-open"
                @click="readProvider(index)"
              >
                <svg class="icon"><use href="#i-eye" /></svg>
                Open
              </button>
              <button
                v-if="props.onRevealPath"
                class="act"
                type="button"
                data-cy="provider-reveal"
                @click="revealProvider(index)"
              >
                <svg class="icon"><use href="#i-folder" /></svg>
                {{ fileManager }}
              </button>
            </div>
            <div v-if="reading?.index === index" class="read" data-cy="provider-read">
              <template v-if="reading.result.ok">
                <!-- ⛔ **The sentence that keeps this honest, drawn WITH the paper** (357). -->
                <div class="muted">
                  Read just now, from disk — not necessarily the text the provider loaded at launch.
                </div>
                <!-- ⚑ 731 · any text file can be read here now, so the pane it opens on is
                     chosen the way every text viewer chooses it (`textViewFor`). -->
                <DocumentBody
                  :source="reading.result.text"
                  :filename="reading.result.name"
                  :raw="textViewFor(reading.result.name).raw"
                  :source-only="textViewFor(reading.result.name).sourceOnly"
                  compact
                />
                <div v-if="reading.result.truncated" class="cut">
                  · cut at the size limit — this much was read
                </div>
              </template>
              <div v-else class="refused">
                {{ READ_REFUSALS[reading.result.reason] ?? reading.result.reason }}
              </div>
            </div>
            <div v-if="revealRefusal?.index === index" class="refused" data-cy="provider-refusal">
              {{ REVEAL_WORDS[revealRefusal.reason] ?? revealRefusal.reason }}
            </div>
          </div>
          <!-- 🔴 **357's verdict, drawn** (356 §3). -->
          <div v-if="noProfileLayer" class="muted absent" data-cy="provider-instructions-absent">
            Nothing above is this profile's own — every file the provider named belongs to the
            project or to somewhere else.
          </div>
        </template>
      </template>

      <!-- ──────────────────────────────────────────────────── what was not read -->
      <template v-else-if="current === NOT_READ">
        <div class="lead-short">Files on the walk BroCrew would not read, and why.</div>
        <div
          v-for="item in instructions.refused"
          :key="item.path"
          class="item flat"
          data-cy="refused-instruction"
        >
          <span class="path">{{ item.path }}</span>
          <span class="refused"> · {{ refusalWords(item.reason) }}</span>
          <!-- 314 §3: a broken link's target is the one fact `realpath` cannot recover. -->
          <span v-if="item.link" class="refused">
            · it pointed at <span class="path">{{ item.link }}</span>
          </span>
        </div>
      </template>

      <!-- ──────────────────────────────────────────────────────────── as sent -->
      <template v-else>
        <div data-cy="told-composition">
          <!-- ⛔ **The layer that belongs to no owner: the composition itself, in full** —
               criterion 24's *"composed, as sent"*. ⚑ Open on this tab rather than behind a
               press, because this tab IS the press.

               ⚠️ **It is what BROBOT appended, and not the whole prompt** (found in review, where
               an earlier version of this comment and a commit message both overclaimed). The
               provider's own instructions, the tool definitions and the memory the provider loads
               itself are all in the model's prompt and in none of these bytes — which is exactly
               what the `not shown` tab is for, and why it is a tab rather than a footnote. -->
          <div
            v-for="layer in accountLayers"
            :key="layer.id"
            class="item"
            :data-cy="`told-layer-${layer.kind}`"
          >
            <div class="note muted" :data-cy="`told-says-${layer.kind}`">{{ layer.says }}</div>
            <template v-if="layer.text !== null">
              <DocumentBody :source="layer.text" filename="as sent" compact />
              <div class="cut" :data-cy="`told-bytes-${layer.kind}`">
                {{ layerBytes(layer.text) }} — the text as it was sent
              </div>
            </template>
          </div>
          <!-- ⛔ **A POSITIVE fact, said once, rather than a phantom layer.** -->
          <div v-if="told.appendedNothing" class="muted absent" data-cy="told-appended-nothing">
            BroCrew appended nothing to this conversation’s prompt.
          </div>
          <button
            class="why"
            type="button"
            :aria-expanded="whyTold"
            data-cy="told-why"
            @click="whyTold = !whyTold"
          >
            <svg class="icon chev" :class="{ down: whyTold }"><use href="#i-chevron" /></svg>
            how this is ordered
          </button>
          <div v-if="whyTold" class="note muted" data-cy="told-order">{{ told.order }}</div>
          <button
            v-if="instructions.provider.length > 0 || instructions.note"
            class="why"
            type="button"
            :aria-expanded="why"
            data-cy="instructions-why"
            @click="why = !why"
          >
            <svg class="icon chev" :class="{ down: why }"><use href="#i-chevron" /></svg>
            what this is
          </button>
          <div v-if="why" class="note" data-cy="instructions-why-body">
            <div v-if="instructions.provider.length > 0">
              The provider reports it loaded these itself, and this app did not fetch them to build
              the list — it holds no text of its own for them. Open reads one now, at your ask.
            </div>
            <div v-if="instructions.note" class="muted" data-cy="instructions-note">
              {{ instructions.note }}
            </div>
          </div>
        </div>
      </template>

      <!-- 🔴 **A bundle this app could not split, drawn whole and SAID to be unsplit** (583).
           ⛔ On every tab, because it belongs to none of them: filing three authors' text under
           one of them would land it in `factory`, the reassuring answer. -->
      <div v-if="grouped.unsplit" class="unsplit" data-cy="told-unsplit">
        <div class="muted">{{ grouped.unsplit.says }}</div>
        <div
          class="item"
          data-cy="told-block"
          :data-kind="grouped.unsplit.block.kind"
          data-whose=""
          data-heading=""
          :data-truncated="grouped.unsplit.block.truncated"
        >
          <button
            class="head"
            type="button"
            :aria-expanded="open.has(grouped.unsplit.block.key)"
            data-cy="told-block-toggle"
            @click="toggle(grouped.unsplit.block.key)"
          >
            <svg class="icon chev" :class="{ down: open.has(grouped.unsplit.block.key) }">
              <use href="#i-chevron" />
            </svg>
            <span class="name">{{ basename(grouped.unsplit.block.path) }}</span>
            <span class="spacer"></span>
            <!-- ⛔ **Every mark an ordinary row carries, because a row that is not in a group is
                 still a row** (found by a re-aiming agent reading this block). ⚠️ The first version
                 of this fail-closed arm drew the name, the bytes and the path and nothing else —
                 so a bundle that was CUT read as a bundle that was short, on the one path that
                 exists for a host whose bytes we do not trust. 🔴 `one-tab-at-a-time.dom.test.ts`
                 §5 asserts this row's hooks against an ordinary row's, so the two cannot drift. -->
            <span
              v-if="grouped.unsplit.block.truncated"
              class="chip cut"
              data-cy="told-block-truncated"
              >cut</span
            >
            <span class="bytes">{{ layerBytes(grouped.unsplit.block.text) }}</span>
          </button>
          <div v-if="open.has(grouped.unsplit.block.key)" class="opened">
            <div class="where">
              <span class="label" data-cy="told-block-label">{{
                LABELS[grouped.unsplit.block.kind]
              }}</span>
              <span class="path">{{ grouped.unsplit.block.path }}</span>
            </div>
            <div
              v-if="grouped.unsplit.block.truncated"
              class="cut"
              data-cy="told-block-truncated-says"
            >
              {{ truncatedWords(grouped.unsplit.block) }}
            </div>
            <DocumentBody
              :source="grouped.unsplit.block.text"
              :filename="basename(grouped.unsplit.block.path)"
              compact
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 🔴 **The root this block did not have until `527`** — see the template's own note.
 *
 * ⛔ **It declares its face and its size rather than inheriting them.** Sized by `SessionInfo`'s
 * mono 8.5 px root, every sentence in this component was a micro-label: `525` Q5 measured it
 * (*"Instructions inherits that 8.5 px and explicitly gives explanatory notes/actions 8 px"*) and
 * `526` F9 named it as the defect the PO ruling would inherit. ⚑ **It is `--font-sans` now,
 * because most of what is in here is SENTENCES**; the paths and the bytes ask for mono by name,
 * the way `DocumentBody` does.
 *
 * ⚠️ **These are READING sizes because this component is on a reading surface now** (`HO-050`
 * §1.1: *"a narrow index that navigates, wide sheets that read"*). `525` measured the mock's
 * reading prose at 11–12 px on a 716 px page; `--text-base` is 11.5. ⛔ **Nothing here would be
 * defensible back in a 380 px column** — which is the point, and why the move and the sizes are
 * one change rather than two.
 */
.told-and-told-with {
  display: flex;
  flex-direction: column;
  color: var(--text-soft);
  font-family: var(--font-sans);
  font-size: var(--type-body);
  gap: var(--space-7);
  line-height: 1.55;
}

.item {
  margin-bottom: var(--space-3);
}

.item:last-of-type {
  margin-bottom: 0;
}

.head {
  display: flex;
  width: 100%;
  align-items: baseline;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-soft);
  font: inherit;
  gap: var(--space-3);
  text-align: left;
}

.head:hover .path {
  color: var(--text);
}

.chev {
  width: 9px;
  height: 9px;
  flex: none;
  transition: transform var(--dur-fast) var(--ease-out);
}

/* `#i-chevron` points RIGHT at rest, which is closed; open turns it down. */
.chev.down {
  transform: rotate(90deg);
}

/* Click-select the whole path — these exist to be pasted into a terminal, like every other path
   on this surface.

   ⛔ **It NAMES the mono face since `527`, and that is not tidying.** The face used to arrive from
   `SessionInfo`'s root; with a root of its own this block is sans, and a path that inherited it
   would have gone proportional without one rule changing. ⚑ **10.5 px is this app's standard for
   a dense mono reading column** — `DocumentBody.vue:243`'s `.view-raw` and `ChildWorkViewer`'s
   copy of it, which `526` §7.1 read as a standard rather than as one component's taste. */
.path {
  cursor: text;
  font-family: var(--font-mono);
  font-size: var(--type-small);
  overflow-wrap: anywhere;
  user-select: all;
}

.muted {
  color: var(--muted);
}

.lead {
  margin-top: var(--space-4);
}

/* ⚑ **Secondary prose, not micro material** (`527`; `526` F9 named this exact rule). It is a
   PARAGRAPH — the thing `tokens.css` §9 says the 9–12 px band is for — and it was at 8 px, one
   step off the smallest size in the file. `--text-md` keeps it a step below the body around it,
   which is what *secondary* is supposed to mean. */
.note {
  margin-top: var(--space-3);
  color: var(--muted);
  font-size: var(--type-small);
  line-height: 1.5;
}

.flat {
  padding-left: calc(9px + var(--space-3));
}

/* A file we would not read reads as refused, never as a bare path — the same register `.absent`
   uses in `SessionInfo` for a file that is not there. */
.refused {
  color: var(--waiting);
  font-style: italic;
}

.cut {
  color: var(--waiting);
}

/* ⚠️ **`wrap` rather than one line**, for the reason `SessionInfo` gives beside its own: a path and
   a chip side by side push the 292px narrow drawer into a horizontal scrollbar the moment the path
   is long, and ellipsising the path would hide the one thing the row exists to show. */
.line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
}

/* The layer, as a chip. Quiet on purpose: it is a fact about the row, not a warning about it. */
.scope {
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-2xs);
  color: var(--muted);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.acts {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-3);
  gap: var(--space-3);
}

/* ⚠️ The same rule `SessionInfo.act` uses, copied rather than shared — `<style scoped>` means a
   class name matches nothing in another component, and borrowing the NAME would render an unstyled
   button that a screenshot would not flag. */
.act {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-small);
  gap: var(--space-3);
}

.act:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.act .icon {
  width: 11px;
  height: 11px;
}

.read {
  margin-top: var(--space-3);
}

.read .muted {
  margin-bottom: var(--space-3);
  font-size: var(--type-small);
}

.why {
  display: inline-flex;
  align-items: center;
  margin-top: var(--space-4);
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: var(--type-small);
  gap: var(--space-3);
  text-align: left;
}

.why:hover {
  color: var(--text-soft);
}

.absent {
  font-style: italic;
}

/* ⛔ **The one paragraph above the strip** — `442` §2.2's scope, which may not be behind a press.
   `--text-md` is the same secondary register `.lead-short` and `.note` use, so it reads as the
   frame around the tabs rather than as a sixth thing to read. */
.standing {
  margin-bottom: var(--space-5);
  font-size: var(--type-small);
  line-height: 1.5;
}

/* ───────────────────────────────────────────────────────────────────── 583 · the tabs */

/* ⛔ **Controls are boxes** (`578`'s rule on the bar next door, applied here): what a person
   presses to change what they are reading has to look pressable at rest, not only when it is on.
   ⚑ The active one is filled and inked; the rest are outlined and muted. */
.tabs {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
  gap: var(--space-3);
}

.tab {
  display: inline-flex;
  align-items: center;
  padding: 3px var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-small);
  gap: var(--space-3);
  white-space: nowrap;
}

.tab:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.tab.on {
  border-color: var(--accent-border);
  background: var(--accent-fill);
  color: var(--accent-text);
}

/* The count is a fact about the tab, not a badge demanding attention — same ink, one step down. */
.tab-count {
  color: inherit;
  font-size: var(--type-caption);
  opacity: 0.75;
}

/* ───────────────────────────────────────────────── 583 · the one picture on this sheet */

.size {
  display: flex;
  min-width: 0;
  flex-direction: column;
  margin-bottom: var(--space-5);
  gap: var(--space-3);
}

/* ⚠️ **A share, not a gauge.** No ticks, no numbers inside it: the sentence under it carries the
   percentage and what it is a percentage OF, which is the half a bar cannot say. */
.size-bar {
  overflow: hidden;
  height: 4px;
  border-radius: var(--radius-bar);
  background: var(--wash-5);
}

.size-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-bar);
  background: var(--accent);
  transition: width var(--dur-fast) var(--ease-out);
}

.size-says {
  color: var(--faint);
  font-size: var(--type-small);
}

/* ───────────────────────────────────────────────────────────── 583 · one tab's contents */

.panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

/*
 * Keep the always-visible lead to one readable line; longer explanations belong behind disclosure.
 */
.lead-short {
  margin-bottom: var(--space-5);
  color: var(--muted);
  font-size: var(--type-small);
  line-height: 1.5;
}

/* A row's name: the section heading the file itself carries, or the file's last segment. Mono,
   because half of them ARE filenames and a proportional face would make the two look unrelated. */
.name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--type-small);
}

.head:hover .name {
  color: var(--text);
}

.bytes {
  flex: none;
  color: var(--faint);
  font-size: var(--type-caption);
  font-variant-numeric: tabular-nums;
}

/* ⚑ **A fact about the row, as a chip** — the same quiet register `.scope` uses next door, and
   for the same reason: it is a statement, not a warning. The sentence it stands for is drawn in
   full when the row is opened, so nothing load-bearing lives only in three words. */
.chip {
  flex: none;
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-2xs);
  color: var(--muted);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.chip.cut {
  border-color: var(--waiting-pill-border);
  color: var(--waiting);
}

.opened {
  display: flex;
  flex-direction: column;
  padding-left: calc(9px + var(--space-3));
  gap: var(--space-3);
}

/* The address and what kind of file it is, where a person who asked for them will find them.
   The path stays selectable, for the terminal. */
.where {
  display: flex;
  flex-wrap: wrap;
  padding-top: var(--space-3);
  font-size: var(--type-small);
  gap: var(--space-3) var(--space-4);
}

.label {
  color: var(--muted);
}

/* ⛔ **Four classes the layer rows have carried since `442` with no rule behind them**, found
   photographing this sheet: the "register" chip was unstyled inline text sitting beside a real
   chip. ⚑ Given the register `.scope` and `.chip` already use, so one vocabulary draws one way. */
.layer-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.register {
  flex: none;
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-2xs);
  color: var(--muted);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.count {
  flex: none;
  color: var(--faint);
  font-size: var(--type-caption);
  font-variant-numeric: tabular-nums;
}

.layer-body {
  padding-top: var(--space-3);
  padding-left: calc(9px + var(--space-3));
}

.spacer {
  flex: 1;
}

/* ⛔ **A bundle nobody could split, marked off from the tab it is sitting in** — it belongs to
   none of them, so it may not read as part of one. */
.unsplit {
  margin-top: var(--space-6);
  padding-top: var(--space-5);
  border-top: var(--border-width) dashed var(--line-strong);
}

/* ⚑ **The composition tab stacks**, so its two folds are rows rather than two chevrons jammed
   onto one line — found photographing the tab. */
.panel [data-cy='told-composition'] {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
}

/* The *more* press, inline at the end of the short line rather than on a line of its own. */
.why.inline {
  margin-top: 0;
  margin-left: var(--space-3);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
