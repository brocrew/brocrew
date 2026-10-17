<script setup lang="ts">
import { fileManagerHere } from '../lib/this-computer'
import { computed, ref, watch } from 'vue'
import type {
  AgentIdentity,
  ConfigFileResult,
  CreatedSession,
  RevealResult,
  SessionPathTarget,
  SessionRef,
} from '../../../shared/runtime-ipc'
import { agentName } from '../../../shared/runtime-ipc'
import { whereItCameFrom } from '../lib/session-record'
import { textViewFor } from '../../../shared/documents'
import DocumentBody from './DocumentBody.vue'
import { PROFILE_OWNS } from '../lib/profile-words'
import {
  ANOTHER_CALLER_IS_ON_IT,
  ANOTHER_CALLER_MAY_REACH_IN,
  HOW_THESE_GRANTS_END,
  KEPT_BEYOND_IT_SAYS,
  KEPT_BEYOND_THIS_CONVERSATION,
  NOT_ASKED_AGAIN,
  keptAndWhere,
  notKeptHere,
  type KeptHere,
} from '../lib/standing-grants'
import { SUBJECT_WORDS } from '../lib/what-survives-the-conversation'

/**
 * Where this conversation actually lives: the paths, the config as it is ON DISK, and the ref.
 *
 * Show conversation diagnostics, including cwd, in this drawer tab. Moving them out of the header changes two things:
 *
 * 1. **It is no longer behind the debug toggle.** It used to render only in debug, because debug
 *    meant "show me the machinery" and this was some of it. Since 079 that toggle means one thing —
 *    lifecycle notices inline in the conversation — and gating a tab on it would have made a tab
 *    that is sometimes not there. You open it by opening it.
 * 2. **It no longer collapses.** The disclosure existed because the strip sat across the top of the
 *    conversation and had to be able to get out of the way; a tab is already the getting out of the
 *    way, and a collapse inside it would be a second one.
 *
 * ⚠️ **`pid` lands here too** (079 §1 #5). The liveness pill up top keeps the state — live, silent,
 * errored — because that is a glance-state; which process is serving it is debug, and reading it
 * off a pill nobody can select was never the point.
 *
 * ## 🔴 356 — a path is data, an explanation is documentation
 *
 * Show each row's label, path and reveal action first. Keep the concept explanation behind a collapsed disclosure so unfamiliar paths can be explained without crowding the panel.
 *
 * ⚑ **Two affordances, and the panel says which is which.** *Finder* reveals the file where it
 * lives; *Open* reads a document onto the app's own paper. They are different acts and 356 §1 asks
 * that they never be spelled as one. ⛔ **Neither is a path this component chose** — it names the
 * ROW, and the main process looks the string up in the session it launched. Every file door in this
 * app refuses a renderer-supplied path by construction, and these two do not become the exception.
 *
 * ⛔ **Rows deliberately left alone**: `model`, `reasoning`, `process` and `ref` carry a VALUE and
 * no explanation, so there was nothing to move. 356 §1 asks for that inventory rather than a
 * uniform rewrite, and the answer is that four of the eight rows needed nothing.
 *
 * ## 🔴 527 — this is an INDEX now, and the grouping is `HO-050` §1.1
 *
 * ⚑ **The test a person can apply without being taught it:** *close the conversation; what goes
 * with it was the session's, what remains was the agent's.* ⛔ **This panel had the two piles in
 * one `<dl>`** — the working directory four rows above the agent's memory — and the PO's reading
 * of that is the reason the obvious move was forbidden: *"a surface that shows them together
 * teaches the wrong model."*
 *
 * ⚠️ **What changed is the SHAPE, not the rows.** Every row above is still here, still says the
 * same words, and still opens the same folds; they sit in two headed groups whose second line
 * states the lifetime, and the agent's instructions — the 253-character launch scope, the layer
 * list and four `DocumentBody` mounts — moved behind an index entry that opens a wide sheet.
 * `525` measured why that material could not stay: 8.5 px prose in a 368 px column, at 2.1 screens.
 *
 * ⛔ **What did NOT change, and both are rulings somebody else owns.** Nothing here reads
 * `AgentIdentity`, which still carries neither home nor folder (`525` F2) — the home on this panel
 * is `ProviderConfigInfo.home`, the isolated per-profile one, exactly as it always was. And no
 * control moved to or from the Controls tab: `HO-050` §1.2 is `529`'s.
 *
 * ## 🔴 529 — two things that are read, not pressed, and both are the CONVERSATION's
 *
 * ⚑ **`HO-050` §1.2**: *"Controls are things you press. Info is things you read."* ⛔ The blanket
 * grants and the commander disclosure were in the Approvals group and neither is pressable —
 * the drawer's controls said so themselves, *"listed, not managed"* and *"it states and does not offer"*.
 * Their words are `lib/standing-grants.ts`'s; this file renders them and spells neither.
 *
 * ⛔ **They are in the CONVERSATION group, and §1.1's own test is why**: a blanket grant is a set
 * inside the adapter that dies with the session — its own sentence ends *"they end when the
 * conversation is closed"* — and a commander is `SessionSlot.commandedBy`, fixed at reservation
 * and gone when the slot is. **Close the conversation and both go with it.**
 *
 * ⚠️ **They arrived as a block ABOVE the `<dl>` and `527` was merged underneath them**, which is
 * the PM's dispatching error rather than either agent's. ⚑ Re-landed as two ROWS in the index's
 * own idiom: a `<dt>`, a value, and the sentence behind a *what this is* — `356 §1`'s rule, and
 * the only shape that keeps this surface an index. ⛔ **They wear `527`'s roles, not `529`'s**:
 * one surface, one register, and `what-survives-the-conversation.ts` classifies them like every
 * other fact here.
 */
const props = defineProps<{
  session: CreatedSession
  /** The provider ref once announced; Claude has none until its first turn's init. */
  sessionRef: SessionRef | null
  /** Show one of this session's paths in the file manager (356 §1). Optional for the same reason. */
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
  /**
   * 🔴 **733 · read one config file onto the app's own paper** — the row's *Open* (`731` F-2, R92).
   * By the NAME the config gave the file; main looks the path up. Optional, and absent draws no
   * button, for the reason every door on this panel gives.
   */
  onReadConfigFile?: (name: string) => Promise<ConfigFileResult>
  /**
   * 🔴 **714 · R41 (`712` F-4) — the roster, so the home's line NAMES whose it is** (`agentName`).
   * ⚑ Optional and `null` until the read lands; the line then reads the slug, which is
   * `agentName`'s own answer for a roster it cannot look in.
   */
  identities?: readonly AgentIdentity[] | null
  /**
   * 🔴 **739 · `736` F-1 — the grants *Always allow* kept in this conversation**
   * (`keptInThisConversation`, off the drawer's control projection), drawn in the AGENT's group:
   * they are still there after it closes. Absent or empty draws no row.
   */
  kept?: readonly KeptHere[]
}>()

const emit = defineEmits<{
  refreshConfig: []
  /**
   * 🔴 **Open the agent's side wide** (`527` §3.3, `HO-050` §1.1).
   *
   * ⛔ **An EVENT, not a local `ref` and not an `OverlayHost` of its own.** The layer is
   * `position: fixed; inset: 0` and it draws the emergency stop for every sheet in the app
   * (`390`), so raising one here would put a second modal host inside a scrolling drawer body.
   * ⚑ `ConversationPane` already raises six and owns the *"which conversation is this sheet
   * about"* guard that `067` and `358` both needed; this travels the same two hops
   * `refreshConfig` above already travels.
   */
  openInstructions: []
}>()

const config = computed(() => props.session.config)
/**
 * ⚑ **The tools this session stopped asking about, on one line** (`031`: *a user must be able to
 * SEE what they granted*).
 *
 * ⛔ **Joined rather than a `<ul>`, and that is about the census as much as the layout.** A list
 * puts the text in `<li>`s that carry no hook, so the only classified element would be a wrapper
 * that owns no words — and `what-survives-the-conversation.ts`'s walk would wave the real text
 * through. One element, one hook, one fact.
 */
/** 🔴 739 · {@link props.kept}, or none. */
const kept = computed(() => props.kept ?? [])
const grants = computed(() => notKeptHere(props.session.blanketGrants, kept.value).join(' · '))
/** What the provider reports it is RUNNING (081) — label/value rows composed host-side. */
const agentRows = computed(() => props.session.liveness.agent ?? [])

/**
 * Which rows have their explanation open. Collapsed by default — 356 §1: *"The default state is
 * collapsed."*
 *
 * ⚠️ **A Set replaced rather than mutated**, the same shape `SessionInstructions` uses for its file
 * rows: Vue does not track a `Set`'s own mutations, so `add` alone would open nothing on screen.
 */
const open = ref<Set<string>>(new Set())

function toggle(row: string): void {
  const next = new Set(open.value)
  if (!next.delete(row)) next.add(row)
  open.value = next
}

/**
 * The last reveal that could not happen, and which row asked.
 *
 * ⛔ **A refusal has to land ON the row that was pressed**, not as a toast and not silently: `gone`
 * means the file was removed after the session read it, which is a real thing to learn from this
 * panel and the only place a person would look for it.
 */
type RevealRefusal = Extract<RevealResult, { ok: false }>['reason']

const revealRefusal = ref<{ row: string; reason: RevealRefusal } | null>(null)

const REVEAL_WORDS: Record<string, string> = {
  'no-path': 'this session has no such path',
  gone: 'there is nothing there any more',
}

/**
 * 🔴 **Everything above belongs to ONE conversation, and this component outlives one.**
 *
 * ⛔ **Found reviewing this dispatch's own diff.** `RuntimeScreen` mounts `ConversationPane` with no
 * `:key`, the pane mounts `SessionDrawer` with none, and the drawer mounts this component with none
 * — so switching conversations changes `props.session` and re-renders in place. Without this,
 * a refusal earned by conversation A's home path stays on screen under conversation B's, and the
 * folds a person opened in one conversation are open in the next.
 *
 * ⚠️ **Keyed on the session ID rather than on the whole object**, because the object is republished
 * on every liveness message — resetting on that would close a fold while somebody was reading it.
 */
watch(
  () => props.session.sessionId,
  () => {
    open.value = new Set()
    revealRefusal.value = null
    reading.value = null
    // ⛔ **…and a read still in flight is forgotten too** (`733` review): without this the answer
    // to a press made in conversation A lands under B's row of the same name.
    pressed += 1
  },
)

async function reveal(row: string, target: SessionPathTarget): Promise<void> {
  const ask = props.onRevealPath
  if (!ask) return
  revealRefusal.value = null
  const said = await ask(target)
  if (!said.ok) revealRefusal.value = { row, reason: said.reason }
}

/**
 * 🔴 **733 · the config file open on the paper, and what it read** — keyed by the file's NAME,
 * which is also the address the read takes. One at a time, as on the provider rows.
 */
const reading = ref<{ name: string; result: ConfigFileResult } | null>(null)

/** Which press is the current one — see {@link readConfig}. Not reactive; nothing renders it. */
let pressed = 0

/**
 * ⚑ **The provider rows' words where the answer is the same** (`SessionInstructions`'
 * `READ_REFUSALS`: `gone`, `not-readable`, `unreadable`). `no-path` is this panel's own — the
 * config names no such file, or this app has no record of the conversation.
 */
const READ_WORDS: Record<string, string> = {
  'no-path': 'this conversation has no such file',
  gone: 'there is nothing there any more',
  'not-readable': 'it cannot be shown as text here',
  unreadable: 'it is there, and it could not be read',
}

/**
 * 🔴 **A paper under a file that has gone** (`733` review): *re-read* can report a file absent
 * that was open — its Open button goes with it, so the paper would stay with nothing to close it.
 * ⚠️ Watched on the files' names and existence, never on the config OBJECT, which is republished
 * with the session on every liveness message.
 */
watch(
  () => config.value.files.map((file) => `${file.name}:${file.exists}`).join('\n'),
  () => {
    const open = reading.value
    if (open === null) return
    if (!config.value.files.some((file) => file.name === open.name && file.exists)) {
      reading.value = null
      pressed += 1
    }
  },
)

async function readConfig(name: string): Promise<void> {
  const ask = props.onReadConfigFile
  if (!ask) return
  // A second press on the open row closes it — the provider rows' gesture.
  if (reading.value?.name === name) {
    reading.value = null
    return
  }
  reading.value = null
  // ⛔ **The row PRESSED last wins, not the read that resolves last** — the provider rows' token.
  const token = (pressed += 1)
  const result = await ask(name)
  if (token === pressed) reading.value = { name, result }
}

const fileManager = fileManagerHere()
</script>

<template>
  <!-- 🔴 **An INDEX since `527`, and the grouping is the ruling** (`HO-050` §1.1).

       ⛔ **It was one `<dl>` with the conversation's working directory four rows above the agent's
       memory.** The PO: *"A surface that shows them together teaches the wrong model."* ⚑ **The
       fix is not a reorder** — two rows in a list are still one list — **it is two headed groups,
       each saying what its own lifetime IS**, because *"the grouping in the index is where the
       distinction gets taught."*

       ⚠️ **The index may list both; the surfaces may not mix them.** Both groups are here, which
       the ruling allows in as many words, and each one carries `data-subject` so the rail is an
       assertion rather than a convention — see `what-survives-the-conversation.ts`. -->
  <div class="session-info" data-cy="session-info">
    <!-- ⛔ **Everything here dies with the conversation**, and `HO-009` §5 names the first row by
         name: *cwd is a property of the session*. -->
    <section class="group" data-cy="session-subject-conversation" data-subject="conversation">
      <h3 class="group-title">{{ SUBJECT_WORDS.conversation.title }}</h3>
      <p class="group-says">{{ SUBJECT_WORDS.conversation.says }}</p>
      <dl>
        <template v-for="row in agentRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd :data-cy="`session-agent-${row.label}`">{{ row.value }}</dd>
        </template>

        <dt>cwd</dt>
        <dd>
          <div class="line">
            <span class="path" data-cy="session-cwd">{{ session.cwd }}</span>
            <button
              v-if="props.onRevealPath"
              class="act"
              type="button"
              data-cy="info-reveal-cwd"
              @click="reveal('cwd', { of: 'cwd' })"
            >
              <svg class="icon"><use href="#i-folder" /></svg>
              {{ fileManager }}
            </button>
          </div>
          <!-- 🔴 **357's one required change, and it is a LABEL rather than a path** (356 §3). The
               instruction files a provider finds on this chain are the PROJECT's — *"it must never be
               presented as proof that the selected profile owns it"* — and the row that names the
               directory is where that belongs, because the directory is the reason. -->
          <button
            class="why"
            type="button"
            :aria-expanded="open.has('cwd')"
            data-cy="info-why-cwd"
            @click="toggle('cwd')"
          >
            <svg class="icon chev" :class="{ down: open.has('cwd') }">
              <use href="#i-chevron" />
            </svg>
            what this is
          </button>
          <div v-if="open.has('cwd')" class="note" data-cy="info-note-cwd">
            The working directory this conversation runs in. Instruction files found here are the
            project's: they apply to this directory, whichever profile is running in it.
          </div>
          <div v-if="revealRefusal?.row === 'cwd'" class="absent" data-cy="info-refusal">
            {{ REVEAL_WORDS[revealRefusal.reason] ?? revealRefusal.reason }}
          </div>
        </dd>

        <!-- 🔴 **529 · what this conversation does when you are not the one asking** (`HO-050`
             §1.2). ⛔ **Two ROWS in the index's own idiom**, not a block of their own: a value on
             the line and the sentence behind a *what this is*, which is `356 §1`'s rule for this
             panel. ⚑ Both are the conversation's — apply the PO's test and neither survives it.
             ⚠️ **Absent when there is nothing to say**, which is the ordinary conversation. -->
        <!-- 🔴 739 · `730` F-1 — *not asked again*, and without what was KEPT here (the agent's
             group lists that). -->
        <template v-if="grants !== ''">
          <dt>{{ NOT_ASKED_AGAIN }}</dt>
          <dd>
            <!-- ⚠️ **Listed, not managed — and that is a limit, not an oversight.** `079` said
                 grants are "managed in Controls", but nothing in this app can take one back: a
                 session grant is a set inside the adapter, and there is no revoke on the handle,
                 in the IPC, or in either provider's protocol. ⛔ **Which is exactly why the row is
                 HERE since 529** — a thing you can only read is not a control. -->
            <span class="granted" data-cy="info-grants">{{ grants }}</span>
            <button
              class="why"
              type="button"
              :aria-expanded="open.has('grants')"
              data-cy="info-why-grants"
              @click="toggle('grants')"
            >
              <svg class="icon chev" :class="{ down: open.has('grants') }">
                <use href="#i-chevron" />
              </svg>
              what this is
            </button>
            <div v-if="open.has('grants')" class="note" data-cy="info-note-grants">
              {{ HOW_THESE_GRANTS_END }}
            </div>
          </dd>
        </template>

        <!-- 🔴 **Who else can give this conversation work** (`349`, HO-006 §4.5).
             ⚠️ **It states and does not offer**: there is no way to revoke a commanding
             relationship — `commandedBy` is `readonly` on the slot and the only thing that ends
             it is the conversation — so a button here would be a control that cannot do what it
             says.
             ⚑ **D-017b · drawn whether or not anything runs it**: a message from that caller starts
             it, so the capability is there either way.
             ⚑ **The line says a caller EXISTS and the fold says what it may do**, and the line
             names no verb on purpose — `395` corrected this copy once for reading as a complete
             list of what a commander can do. The argument is in `lib/standing-grants.ts`. -->
        <template v-if="session.hasACommander">
          <dt>other callers</dt>
          <dd>
            <span class="says" data-cy="info-has-a-commander">{{ ANOTHER_CALLER_IS_ON_IT }}</span>
            <button
              class="why"
              type="button"
              :aria-expanded="open.has('commander')"
              data-cy="info-why-commander"
              @click="toggle('commander')"
            >
              <svg class="icon chev" :class="{ down: open.has('commander') }">
                <use href="#i-chevron" />
              </svg>
              what this is
            </button>
            <div v-if="open.has('commander')" class="note" data-cy="info-note-commander">
              {{ ANOTHER_CALLER_MAY_REACH_IN }}
            </div>
          </dd>
        </template>

        <dt>ref</dt>
        <!-- ⛔ **`data-announced` says which of the two this is, because the TEXT cannot** (163). The
             placeholder is a non-empty string, so `textContent.length > 0` is true from the moment
             this row exists — and `smoke:ui` step 44 waited on exactly that, read the em-dash as a
             thread id, and killed the app before the provider had named anything. A test that asks
             "has the ref been announced" now gets an answer that is not a sentence it has to parse. -->
        <dd data-cy="session-ref" :data-announced="sessionRef ? 'yes' : 'no'">
          {{ sessionRef ? sessionRef.sessionId : '— (not announced yet)' }}
        </dd>
      </dl>
    </section>

    <!-- ⚑ **Everything here is still on disk tomorrow.** The home is the isolated per-profile one
         and the files are the files IN it — `ProviderConfigInfo`'s own docblock is *"what is
         actually in the provider home"*. ⛔ **`527` §0's table calls *configuration* the
         conversation's, and that is a different configuration**: the one `HO-050` §1.2 sends to the
         rail — model, effort, plan mode, approvals — which is the Controls tab. See
         `what-survives-the-conversation.ts`, where the disagreement is argued rather than silently
         resolved. -->
    <section class="group" data-cy="session-subject-agent" data-subject="agent">
      <h3 class="group-title">{{ SUBJECT_WORDS.agent.title }}</h3>
      <p class="group-says">{{ SUBJECT_WORDS.agent.says }}</p>
      <dl>
        <dt>home</dt>
        <dd>
          <div class="line">
            <span class="path" data-cy="session-home">{{ config.home }}</span>
            <button
              v-if="props.onRevealPath"
              class="act"
              type="button"
              data-cy="info-reveal-home"
              @click="reveal('home', { of: 'home' })"
            >
              <svg class="icon"><use href="#i-folder" /></svg>
              {{ fileManager }}
            </button>
          </div>
          <!-- The home IS the memory boundary, so say whose it is right next to it (085).
               ⚠️ **The same three things the launcher names, and the same label for `default`** (167
               §3).
               🔴 **356 · the sentence that used to sit here was FALSE on one provider.** It read
               *"this home, its own CLAUDE.md, and what it remembers across every project"* — and the
               instruction leaf it names is read from the home on one provider and on neither is it
               ever CREATED by this app (357: *"BroBot currently creates neither profile leaf"*). What
               is true of both is the isolation, and that is what the note below now says. The
               environment variable and the profile stay on the row because they are DATA: which
               variable, and whose home. -->
          <!-- Label the home's display identity agent; reserve profile for its slug. The home path above already shows the directory spelling. -->
          <!-- ⚑ **D-017b · a conversation this app ran as nobody says where it came from**, in the
               library's words, and never *agent: BroBot* (154). -->
          <div class="muted" data-cy="session-profile">
            {{
              whereItCameFrom(session) ??
              `agent: ${agentName(session.profileId, props.identities ?? null)}`
            }}
            · {{ config.homeEnv }}
          </div>
          <button
            class="why"
            type="button"
            :aria-expanded="open.has('home')"
            data-cy="info-why-home"
            @click="toggle('home')"
          >
            <svg class="icon chev" :class="{ down: open.has('home') }">
              <use href="#i-chevron" />
            </svg>
            what this is
          </button>
          <!-- ⛔ **The same STRING as the launcher's, not the same words typed twice** (384 §1.1).
               `167 §4` requires these two surfaces to describe one boundary identically; until the
               lift that was kept by a source census over two `.vue` files, which is what
               `the-layer-a-file-belongs-to.test.ts` says it exists for. ⚠️ **The trailing clause is this
               surface's own** — the launcher has no variable beside it — so it stays a sibling
               sentence rather than being folded into the shared one. -->
          <div v-if="open.has('home')" class="note" data-cy="info-note-home">
            {{ PROFILE_OWNS }} The variable beside it is what pins that home.
          </div>
          <div v-if="revealRefusal?.row === 'home'" class="absent" data-cy="info-refusal">
            {{ REVEAL_WORDS[revealRefusal.reason] ?? revealRefusal.reason }}
          </div>
        </dd>

        <dt>config</dt>
        <dd data-cy="session-config">
          <div
            v-for="file in config.files"
            :key="file.path"
            class="line"
            :data-cy="`config-file-${file.name}`"
            :data-exists="file.exists"
          >
            <span v-if="file.exists" class="path">{{ file.path }}</span>
            <span v-else class="absent">{{ file.name }} — not present</span>
            <!-- 🔴 **733 · Open, as for any other file — `auth.json` included** (`731` F-2, R92).
                 ⛔ This row said *"Finder and nothing else, and `auth.json` is the reason it is not
                 Open"* (356). ⚑ Two affordances now, as on the provider rows: Open reads the file
                 onto the app's own paper, Finder shows it where it lives. -->
            <button
              v-if="file.exists && props.onReadConfigFile"
              class="act"
              type="button"
              :aria-expanded="reading?.name === file.name"
              :data-cy="`info-open-config-${file.name}`"
              @click="readConfig(file.name)"
            >
              <svg class="icon"><use href="#i-eye" /></svg>
              Open
            </button>
            <button
              v-if="file.exists && props.onRevealPath"
              class="act"
              type="button"
              :data-cy="`info-reveal-config-${file.name}`"
              @click="reveal(`config:${file.name}`, { of: 'config-file', name: file.name })"
            >
              <svg class="icon"><use href="#i-folder" /></svg>
              {{ fileManager }}
            </button>
            <!-- ⛔ **Keyed by the FILE, not by the section** (found reviewing this file's own diff).
                 Two config files share this row, so a refusal drawn under the block would say *one of
                 these is gone* — which is the ambiguity the rule two rows up exists to remove. -->
            <div
              v-if="revealRefusal?.row === `config:${file.name}`"
              class="absent"
              data-cy="info-refusal"
            >
              {{ REVEAL_WORDS[revealRefusal.reason] ?? revealRefusal.reason }}
            </div>
            <div
              v-if="reading?.name === file.name"
              class="read"
              :data-cy="`info-read-config-${file.name}`"
            >
              <template v-if="reading.result.ok">
                <div class="muted">
                  Read just now, from disk — not necessarily what the provider read at launch.
                </div>
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
              <div v-else class="absent" data-cy="info-read-refusal">
                {{ READ_WORDS[reading.result.reason] ?? reading.result.reason }}
              </div>
            </div>
          </div>
          <button
            class="why"
            type="button"
            :aria-expanded="open.has('config')"
            data-cy="info-why-config"
            @click="toggle('config')"
          >
            <svg class="icon chev" :class="{ down: open.has('config') }">
              <use href="#i-chevron" />
            </svg>
            what this is
          </button>
          <!-- ⚑ **Each file's sentence stays WITH its name inside the fold** (356 §1). The prose is
               moved, not deleted, and a note detached from the file it explains would be the same
               merged blob 086 rules against — so the fold repeats the name rather than the path. -->
          <div v-if="open.has('config')" class="note" data-cy="info-note-config">
            <div>{{ config.model }}</div>
            <div v-for="file in config.files" :key="file.path" class="note-file">
              <span class="mono">{{ file.name }}</span> — {{ file.note }}
            </div>
            <div v-if="config.authNote">{{ config.authNote }}</div>
          </div>
          <button class="refresh" data-cy="refresh-config" @click="emit('refreshConfig')">
            <svg class="icon"><use href="#i-refresh" /></svg>
            re-read
          </button>
        </dd>

        <!-- 🔴 **739 · `736` F-1 — what *Always allow* kept in this conversation**, in the agent's
             group: it outlives the conversation, so it is not drawn among what ends with it. The
             fold names each file, verbatim (`740` moves a Claude rule's, R99). -->
        <template v-if="kept.length > 0">
          <dt>{{ KEPT_BEYOND_THIS_CONVERSATION }}</dt>
          <dd>
            <span class="granted" data-cy="info-kept">{{
              kept.map((one) => one.said).join(' · ')
            }}</span>
            <button
              class="why"
              type="button"
              :aria-expanded="open.has('kept')"
              data-cy="info-why-kept"
              @click="toggle('kept')"
            >
              <svg class="icon chev" :class="{ down: open.has('kept') }">
                <use href="#i-chevron" />
              </svg>
              what this is
            </button>
            <div v-if="open.has('kept')" class="note" data-cy="info-note-kept">
              <div>{{ KEPT_BEYOND_IT_SAYS }}</div>
              <div v-for="one in kept" :key="keptAndWhere(one)" class="note-file">
                {{ keptAndWhere(one) }}
              </div>
            </div>
          </dd>
        </template>
      </dl>

      <!-- 🔴 **The index ENTRY, and the whole of `527` §2.2 is in this button** (`HO-050` §1.2).

           ⛔ **It opens wide; it does not navigate.** The PO: *"a person reading a transcript who
           has to leave it to find out what the agent was told has lost the thread… an index entry
           that opens wide satisfies both; a separate screen he has to navigate to does not."* The
           pane, the transcript and this drawer stay mounted underneath — see
           `AgentInstructionsSheet.vue`, and `the-thread-a-person-does-not-leave.dom.test.ts`, which
           asserts it rather than describing it.

           ⚠️ **It states what opens and counts nothing.** A tally here would be a second derivation
           of the sheet's own layer list, and two answers to one question is how they come to
           disagree — `425`'s rule, and `525` F3's finding that scroll length was never the defect. -->
      <button
        class="index-entry"
        type="button"
        data-cy="told-index"
        @click="emit('openInstructions')"
      >
        <span class="index-copy">
          <span class="index-title" data-cy="told-index-title">What this agent was told</span>
          <span class="index-says" data-cy="told-index-says">
            Its composed instructions, its own memory, and the files the provider loaded.
          </span>
        </span>
        <svg class="icon go"><use href="#i-arrow" /></svg>
      </button>
    </section>
  </div>
</template>

<style scoped>
/* 🔴 **9 px, and it is the token file's own floor** (`527` §4; `526` F9 named this panel).
 *
 * ⛔ **It was `--text-4xs` — 8.5 px — and it set EVERYTHING**: the paths, the values, and (until
 * this dispatch moved them) four `DocumentBody` mounts and a 253-character paragraph, all
 * inheriting a size `tokens.css` §9 reserves for *"micro-labels/badges/table-heads only"*.
 * ⚠️ **Measured on the tree this branch started from: 65 of 65 visible text elements on the shut
 * Info tab were under 9 px**, and 15 of them were under 8.5.
 *
 * ⚑ **9 px mono is corroborated twice over** — the mock's smallest mono BODY (9 px/1.7) and this
 * token file's declared floor — which is the same pair
 * `526` §7.1 landed the Events detail on. ⛔ **Not one token VALUE moved**: the names are here and
 * the pixels are in `tokens.css`. */
.session-info {
  display: flex;
  flex-direction: column;
  padding: var(--space-6) var(--space-7);
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  gap: var(--space-7);
}

/* 🔴 **The two piles, each headed with what its own lifetime IS** (`HO-050` §1.1).
 *
 * ⛔ **`data-subject` is on this element and the rail is asserted against it** — see
 * `what-survives-the-conversation.ts`. A group is the smallest thing that can be *headed with a
 * fact*, so it is the thing that carries the claim. */
.group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-4);
}

/* *Tiny uppercase field labels* is `--text-6xs`'s own line in `tokens.css`, and this is one. */
.group-title {
  margin: 0;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--type-caption);
  font-weight: var(--fw-section);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* ⚑ **The sentence that TEACHES the split**, which is the PO's *"the grouping in the index is
   where the distinction gets taught"*. It is prose, so it takes a prose size and the sans face —
   `525` measured the mock's compact prose at 10 px. */
.group-says {
  margin: 0;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--type-small);
  line-height: 1.5;
}

dl {
  display: grid;
  margin: 0;
  gap: var(--space-3) var(--space-6);
  grid-template-columns: auto minmax(0, 1fr);
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

/* ⚠️ **`wrap` rather than a fixed two-column row**, and the drawer's 292px narrow width is why: a
   path and a button side by side on one line push the column into a horizontal scrollbar the
   moment the path is long, and `min-width: 0` on the path alone would ellipsise the one thing
   this panel exists to show. The button drops under the path instead. */
.line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
}

/* Click-select the whole path — these exist to be pasted into a terminal. */
.path {
  cursor: text;
  overflow-wrap: anywhere;
  user-select: all;
}

/* ⚑ **529 · the amber is INK, not a card.** On the Controls tab these four names sat in a
   bordered `--waiting-bg` box; in an index of rows a card would be the loudest thing on a surface
   whose job is to be scanned. ⛔ The colour is kept because it is the app's own register for *this
   session stopped asking*, and it is the one fact on this panel that is a standing risk. */
.granted {
  color: var(--waiting-text-label);
  overflow-wrap: anywhere;
}

/* ⚠️ **A sentence, so it takes the prose size and the sans face** — the same pair `.note` takes.
   ⛔ It sits in the value column beside mono paths, and that is the honest drawing: it is a
   different KIND of fact and the column is not a promise that everything in it is a path. */
.says {
  color: var(--text-soft);
  font-family: var(--font-sans);
  font-size: var(--type-small);
  line-height: 1.5;
}

/* A file that is not there reads as not there, never as a bare path. */
.absent {
  color: var(--muted);
  font-style: italic;
}

/* 🔴 733 · a config file's text, under its own row — the whole width of the row, since the row is a
   wrapping flex line and the paper is not one more item beside the path. */
.read {
  flex-basis: 100%;
  min-width: 0;
  margin-top: var(--space-3);
}

.read .muted {
  margin-bottom: var(--space-3);
}

.cut {
  color: var(--waiting);
}

.muted {
  color: var(--muted);
}

.mono {
  font-family: var(--font-mono);
}

/* The moved prose. Set in the sans face: it is a sentence rather than a path, and the monospace
   column is for things you copy.

   ⚑ **10 px since `527`, not 8** — `526` F9's other half. `tokens.css` §9 puts product text at
   9–12 px and reserves what this was for micro-labels; a paragraph explaining what a provider home
   is has never been one. */
.note {
  margin-top: var(--space-3);
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--type-small);
  line-height: 1.5;
}

.note-file {
  margin-top: var(--space-2);
}

/* ⚠️ **The global `button` skin has a border, a fill and an accent hover border** (`base.css`), so
   every button in this panel resets it. ⛔ The focus ring is NOT reset: `button:focus-visible`
   there is the only keyboard affordance these rows have. */
/* ⚠️ **`flex` rather than `inline-flex`, and `fit-content` beside it** — found in the shipped
   screenshot. Inline, the config row's disclosure and its `re-read` button flowed onto ONE line and
   read as a single control with two labels; block-level puts the disclosure on its own line while
   `fit-content` keeps the click target the size of its words rather than the whole column. */
.why {
  display: flex;
  width: fit-content;
  align-items: center;
  margin-top: var(--space-3);
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--type-caption);
  gap: var(--space-3);
  text-align: left;
}

.why:hover {
  color: var(--text-soft);
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

.act,
.refresh {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.refresh {
  margin-top: var(--space-3);
}

.act:hover,
.refresh:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.act .icon,
.refresh .icon {
  width: 11px;
  height: 11px;
}

/* 🔴 **The index entry — the one thing on this panel that NAVIGATES** (`HO-050` §1.1's *"a
   narrow index that navigates, wide sheets that read"*).

   ⛔ **It looks like a row you press, because that is what it is.** The rows above it are facts
   with an affordance beside them; this one is a door, and the mock draws its rail cards the same
   way — a title, a line saying what is behind it, and a chevron on the right. ⚑ `--text-base` is
   `tokens.css`'s own *rail item titles*. */
.index-entry {
  display: flex;
  width: 100%;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--text-soft);
  font-family: var(--font-sans);
  gap: var(--space-5);
  text-align: left;
}

.index-entry:hover {
  border-color: var(--line-strong);
  background: var(--wash-5);
}

.index-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
}

.index-title {
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
}

.index-says {
  color: var(--muted);
  font-size: var(--type-small);
  line-height: 1.45;
}

.index-entry .go {
  width: 11px;
  height: 11px;
  flex: none;
  color: var(--muted);
}
</style>
