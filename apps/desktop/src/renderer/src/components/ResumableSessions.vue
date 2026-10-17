<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AgentIdentity,
  ExportedSession,
  ImportedRecording,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../../shared/runtime-ipc'
import { agentName, providerName } from '../../../shared/runtime-ipc'
import { appClosing } from '../lib/app-closing'
import { approvalModeLabel } from '../lib/approval-mode'
import { childLabel } from '../lib/child-descent'
import { agoWords } from '../lib/clock'
import { endedUnfinished, endingLabel } from '../lib/ending'
import { scanSummary, useHomeScan } from '../lib/home-scan'
import { readableError } from '../lib/session-record'

/**
 * The conversations this app recorded. It answers the question that started this — *"I closed a
 * chat, why can't I get it back?"* — and since D-017b the answer is one press: every row opens the
 * conversation in its full view, whatever it is doing, and a message sent there continues it.
 *
 * The ones a message cannot continue are listed too, with the reason. Leaving them out would answer
 * the original question with silence, which is what it was asking about in the first place.
 */
const sessions = ref<ResumableSessionInfo[]>([])
const unresumable = ref<UnresumableSessionInfo[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
/**
 * What the last scan of the provider homes did — including what it would not touch.
 *
 * ⚑ **The operation moved out of this file in 121, and nothing about this lane changed** (`120`
 * §7). `Sessions` needed the same scan — it back-fills the descent its **Kind** facet reads — and
 * *"two scan buttons that look alike and behave differently is `061` finding 6 in control form"*.
 * So there is one {@link useHomeScan} and one {@link scanSummary}, called from both. The link, the
 * wording and the refresh that follows it are exactly as they were.
 */
const homeScan = useHomeScan()
const { scanning, lastScan } = homeScan
/** The last export, per row — where it went and what it is good for. */
const exports = ref<Record<string, ExportedSession | string>>({})
/** Per session, not one at a time: exporting row B must not re-enable row A's buttons. */
const exporting = ref<Record<string, boolean>>({})
/** What the last Import said, per row — the host's own sentence, not a word chosen here (119). */
const imports = ref<Record<string, ImportedRecording | string>>({})
const importing = ref<Record<string, boolean>>({})

const emit = defineEmits<{
  /**
   * ⚑ **D-017b · open a conversation in its one full view** — an id, and the screen draws it: every
   * row's press, whatever the conversation is doing. Starting nothing.
   */
  open: [sessionId: string]
}>()

const props = withDefaults(
  defineProps<{
    /**
     * 🔴 **714 · R41 (`712` F-4) — the roster, so a row NAMES who it reopens as** (`agentName`).
     * ⚑ `null` until the read lands, and then a row reads the slug, which is `agentName`'s own
     * answer for a roster it cannot look in.
     */
    identities?: readonly AgentIdentity[] | null
  }>(),
  { identities: null },
)
/** ⚑ **D-017b · every recorded conversation, whatever it is doing** — one list, one press. */
const offered = computed(() => sessions.value)

/*
 * ⛔ **`count` was emitted here and NOTHING listened** — removed in `301`'s acceptance-#7 sweep.
 *
 * It fed *"a collapsed summary"* — the shape this list had while it lived in the left rail. `151`
 * moved it onto a page, where it is never collapsed, and the emit came with it: a live output with
 * no consumer, which is `235`'s *"live mechanism with no live input"* the other way round. ⚠️ The
 * hazard is not cost, it is READING: the next person to want a count beside "Reopen a closed
 * conversation" finds a wire that looks connected and is not.
 *
 * ⚠️ **A `looked` flag went with it, and finding that was the point of re-reading this diff.**
 * It existed only to gate the emit — *"until it has looked it has no count to give, not a count of
 * 0"* — and once the emit went it was WRITTEN AND NEVER READ, which eslint does not flag because an
 * assigned ref counts as used. ⛔ The first version of this comment claimed {@link isEmpty} needed
 * it; {@link isEmpty} reads `loading`, `offered` and `unresumable` and has never read `looked`. A
 * dead flag left behind by a sweep for dead wires is the joke `301` was one step from committing.
 */

async function refresh(): Promise<void> {
  // 🔴 **Not while the app is closing** (273 §2, from `272` finding 1) — the same rule and the same
  // reason as `SideRail`'s `refreshClosed`, because the same watcher drives both of them and `272`
  // caught the pair after `close its database`. ⚠️ Before `loading`, deliberately: setting it and
  // returning would leave this list saying "looking…" for the rest of the window's life.
  if (appClosing.value) return
  loading.value = true
  loadError.value = null
  try {
    const [open, closed] = await Promise.all([
      window.api.runtime.listResumable(),
      window.api.runtime.listUnresumable(),
    ])
    sessions.value = open
    unresumable.value = closed
  } catch (cause) {
    loadError.value = readableError(cause)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

/**
 * Look through the provider homes for conversations this app never recorded, and record a
 * pointer to each so it can be reopened. Only a pointer: the messages stay with the provider,
 * which is why an adopted row says so rather than pretending its transcript is ours.
 */
async function scan(): Promise<void> {
  // This lane's own follow-up, and it stays this lane's: the rows a scan changes here are the
  // resumable and unresumable lists, which is not what the library page re-reads.
  //
  // ⚠️ **Passed IN rather than awaited after, so the link stays disabled through it** (review).
  // The first version cleared `scanning` before `refresh()` ran, so for two more round trips the
  // button read "scan for existing sessions" and was pressable while the list below said
  // "looking…" — and `refresh()` has no race guard, so two of them can land out of order. That is
  // a behaviour change to the reopen lane, which `120` §9.10 says to leave alone.
  //
  // ⚠️ And `loadError` is cleared HERE and set only on failure, never cleared after — `refresh()`
  // runs inside the scan and sets `loadError` itself when the list read fails, so clearing it on
  // the way out would wipe an error the follow-up had just reported.
  loadError.value = null
  const result = await homeScan.scan(refresh)
  if (result !== null && 'error' in result) loadError.value = result.error
}

/**
 * Write a session out: a copy of the provider's own file, or one self-contained document. The result says where it went and whether that file is something a
 * provider could resume — "exported" must not be left to read as "restored".
 */
// ⚠️ **633 · this surface offers the two kinds MAIN composes and not the readable one.** ⛔ A
// readable export is composed from `TranscriptItem[]` — the fold the CONVERSATION holds — and this
// screen lists sessions that are not open. ⚑ The button for `reading` belongs on the conversation,
// where the fold is; `633` §4.2 boards it.
async function exportSession(
  session: ResumableSessionInfo,
  exportKind: 'native' | 'bundle',
): Promise<void> {
  if (exporting.value[session.sessionId]) return
  exporting.value = { ...exporting.value, [session.sessionId]: true }
  try {
    const result = await window.api.runtime.exportSession({
      sessionId: session.sessionId,
      exportKind,
    })
    exports.value = {
      ...exports.value,
      [session.sessionId]: result,
    }
  } catch (cause) {
    exports.value = {
      ...exports.value,
      [session.sessionId]: readableError(cause),
    }
  } finally {
    exporting.value = { ...exporting.value, [session.sessionId]: false }
  }
}

/**
 * **Bring one adopted conversation's prior messages in from its provider file** (119, `118` §8.3).
 *
 * ⚑ **The control the meta line above it had been naming since 087.** That line says *"prior
 * messages not imported yet"* — an action, with nothing anywhere that performed it: the Library's
 * Import is for a file that has no row here, and this row is ours. `106` forbade a control that
 * looks like it does something and does not; a sentence naming an action with no control is the
 * same lie told by omission, so this is the control rather than the sentence being deleted.
 *
 * ⚠️ **The list is refreshed only when something actually landed.** `hasTranscript` is what decides
 * whether this row offers Read, and it is a fact read back from the store — so the refresh is how
 * the row catches up with itself. Re-fetching after an outcome that changed nothing would just
 * make a no-op look like work.
 */
async function importMessages(session: ResumableSessionInfo): Promise<void> {
  if (importing.value[session.sessionId]) return
  importing.value = { ...importing.value, [session.sessionId]: true }
  try {
    const result = await window.api.runtime.importRecordedSession({ sessionId: session.sessionId })
    imports.value = { ...imports.value, [session.sessionId]: result }
    if (result.readable) await refresh()
  } catch (cause) {
    imports.value = {
      ...imports.value,
      [session.sessionId]: readableError(cause),
    }
  } finally {
    importing.value = { ...importing.value, [session.sessionId]: false }
  }
}

defineExpose({ refresh })

/**
 * "3 adopted, 2 already known" — what the scan actually did, not just that it ran.
 *
 * ⚑ **The sentence itself moved to `home-scan.ts` in 121** so Sessions says the identical thing
 * about the identical press. It is unchanged apart from one new clause, which is the number that
 * made surfacing this button on Sessions worth doing: how many descents it recorded.
 */
const scanNote = computed(() => scanSummary(homeScan.lastScan.value))

const isEmpty = computed(
  () => !loading.value && offered.value.length === 0 && unresumable.value.length === 0,
)

/**
 * "4m ago" — precise enough to pick the right session, without a date library.
 *
 * ⚑ **The thresholds moved to `lib/clock.ts` in 151**, where the rail's closed rows read them too.
 * Two copies of one scale is the shape of defect 099 is about, at a smaller size: they agree today
 * and nothing would notice the day one of them was edited.
 */
const ago = agoWords
</script>

<template>
  <section class="resumable" data-cy="resumable-sessions">
    <header>
      <button type="button" class="link" data-cy="refresh-resumable" @click="refresh">
        refresh
      </button>
      <button
        type="button"
        class="link"
        :disabled="scanning"
        data-cy="scan-sessions"
        title="Look in every profile's folder for conversations this app never recorded"
        @click="scan"
      >
        <!-- 154 §2b · one noun. The title above this button has said "conversations" since it was
             written, so the label was the inconsistency inside its own control. -->
        {{ scanning ? 'scanning…' : 'scan for existing conversations' }}
      </button>
      <span v-if="scanNote" class="muted scan-summary" data-cy="scan-summary">
        {{ scanNote }}
      </span>
    </header>

    <p v-if="loadError" class="err" data-cy="resumable-error">{{ loadError }}</p>
    <p v-else-if="loading" class="muted">looking…</p>
    <p v-else-if="isEmpty" class="muted" data-cy="resumable-empty">
      Nothing recorded yet. A conversation is listed here once its provider has given it an id — on
      Claude that is after its first message.
    </p>

    <ul v-else>
      <li
        v-for="session in offered"
        :key="session.sessionId"
        class="row"
        data-cy="resumable-row"
        :data-session-id="session.sessionId"
      >
        <div class="what">
          <span class="provider">{{ session.provider }}</span>
          <span class="mono cwd">{{ session.cwd }}</span>
        </div>
        <div class="meta muted mono">
          <span :data-cy="`resumable-status-${session.sessionId}`">{{ session.status }}</span>
          <!-- ⛔ **222 · what `220` had to open a conversation to find out.** `status` says the
               conversation is over; this says whether the work in it finished, and they are
               different questions. Absent for a row we hold no closed turn for — never a
               placeholder, and never back-filled as `finished` (086).
               The `title` is the whole sentence; the cell is the glance. -->
          <span
            v-if="endingLabel(session.lastEnding)"
            :data-cy="`resumable-ending-${session.sessionId}`"
            :data-ending="session.lastEnding"
            :class="{ unfinished: endedUnfinished(session.lastEnding) }"
            :title="endingLabel(session.lastEnding)?.sentence"
          >
            {{ endingLabel(session.lastEnding)?.word }}
          </span>
          <!-- ⛔ **The LABEL, not the enum** (171 §2). This row rendered `session.approvalMode`
               raw, so a session that had run allow-all came back on the resume list saying `auto` —
               the one word 168 H1 is about. The enum is untouched on the wire and in the ledger;
               `approvalModeLabel` is where the renderer turns it into a word, and it keeps
               `unrecorded` distinct from both modes rather than defaulting a silent row to `ask`. -->
          <span data-cy="resumable-approvals">
            approvals: {{ approvalModeLabel(session.approvalMode) }}
          </span>
          <!-- Name the agent a session will reopen as; equal cwd values do not imply equal identities. `resumable()` excludes user-home rows, so a remaining null profile is a legacy default-profile session, named BroBot by `agentName`. Label the display name agent, reserving profile for its slug. -->
          <span data-cy="resumable-profile"
            >agent: {{ agentName(session.profileId, props.identities) }}</span
          >
          <!-- What it will come back thinking with (024). `provider default` is the honest word
               for a session that asked for nothing: reopening it does not impose a level it never
               ran with. -->
          <span data-cy="resumable-reasoning">
            reasoning: {{ session.reasoningEffort ?? 'provider default' }}
          </span>
          <!-- Adopted sessions were never run here: their messages and approvals belong to the
               provider, and saying so is the difference between an empty chat that is a bug and
               an empty chat that is expected. -->
          <!-- ⚑ **"not imported yet" now names something a button does** (119). It said it for
               eleven dispatches with no control anywhere that performed it — see `importMessages`. -->
          <span v-if="session.adoptedAt" class="adopted" data-cy="resumable-adopted">
            adopted — found in this profile's folder, not run here
            <template v-if="!session.hasTranscript"> · prior messages not imported yet </template>
          </span>
          <!-- Mark provider children as sub-agent conversations rather than conversations the person started, using the same wording function as the Library. -->
          <span
            v-if="session.child"
            class="child"
            :data-cy="`resumable-child-${session.sessionId}`"
          >
            {{ childLabel(session.child) }}
          </span>
          <span>{{ ago(session.updatedAt) }}</span>
        </div>
        <!-- ⚑ **D-017b · one press, whatever the conversation is doing** — it opens in its full view,
             and a message sent there continues it; a row a message cannot continue opens too, and
             its view says why in the host's words. ⛔ **`sessions-open-`, never a bare `open-`**: a
             family head that short admits the rail's `open-session-` rows as its own members, and a
             census asking whether a dead rail hook is still drawn would read it alive. -->
        <button
          type="button"
          class="primary"
          :data-cy="`sessions-open-${session.sessionId}`"
          @click="emit('open', session.sessionId)"
        >
          Open
        </button>
        <div class="row-actions">
          <!-- ⚠️ Gated on the same two facts the sentence above is: it was adopted, so there is a
               provider file, and we do not hold its messages. On a row that already has them there
               is nothing to import, and a button that reports "already here" is 106's control that
               does nothing wearing a friendlier word. -->
          <button
            v-if="session.adoptedAt && !session.hasTranscript"
            type="button"
            class="link"
            :disabled="importing[session.sessionId]"
            :data-cy="`import-messages-${session.sessionId}`"
            title="Copy this conversation's messages out of the provider file we adopted it from"
            @click="importMessages(session)"
          >
            {{ importing[session.sessionId] ? 'importing…' : 'import messages' }}
          </button>
          <button
            type="button"
            class="link"
            :disabled="exporting[session.sessionId]"
            :data-cy="`export-native-${session.sessionId}`"
            @click="exportSession(session, 'native')"
          >
            export file
          </button>
          <button
            type="button"
            class="link"
            :disabled="exporting[session.sessionId]"
            :data-cy="`export-bundle-${session.sessionId}`"
            @click="exportSession(session, 'bundle')"
          >
            export bundle
          </button>
        </div>
        <!-- ⚠️ **The sentence the missing button owes the reader** (118). Not an error and not
             styled as one: nothing failed, and the row is whole — it exports, it reads, and every
             recorded setting on it is still true. The one thing it cannot do is take a turn, and
             this says which one thing that is, in the host's own words rather than composed here. -->
        <p
          v-if="session.resumeRefusal"
          class="muted row-error"
          :data-cy="`resume-refused-${session.sessionId}`"
        >
          {{ session.resumeRefusal }}
        </p>
        <!-- What the import did, in the host's words. ⚠️ Not styled as an error unless it threw:
             "already here" and "nothing readable in the file" are both correct things to have
             happened, and a red line would call a working import a fault. -->
        <p
          v-if="imports[session.sessionId]"
          class="row-error"
          :class="typeof imports[session.sessionId] === 'string' ? 'err' : 'muted'"
          :data-cy="`import-result-${session.sessionId}`"
        >
          <template v-if="typeof imports[session.sessionId] === 'string'">
            {{ imports[session.sessionId] }}
          </template>
          <template v-else>{{ (imports[session.sessionId] as ImportedRecording).note }}</template>
        </p>
        <p
          v-if="exports[session.sessionId]"
          class="row-error mono exported"
          :class="{ err: typeof exports[session.sessionId] === 'string' }"
          data-cy="export-result"
        >
          <template v-if="typeof exports[session.sessionId] === 'string'">
            {{ exports[session.sessionId] }}
          </template>
          <template v-else>
            {{ (exports[session.sessionId] as ExportedSession).path }}
            <span class="muted">
              ·
              {{
                (exports[session.sessionId] as ExportedSession).resumable
                  ? 'a provider can resume this'
                  : 'a copy, not a restored session'
              }}
              — {{ (exports[session.sessionId] as ExportedSession).note }}
            </span>
          </template>
        </p>
      </li>

      <!-- Recorded, but with nothing to resume from. Shown with the reason rather than dropped. -->
      <li
        v-for="session in unresumable"
        :key="session.sessionId"
        class="row gone"
        data-cy="unresumable-row"
        :data-session-id="session.sessionId"
      >
        <div class="what">
          <span class="provider">{{ session.provider }}</span>
          <span class="mono cwd">{{ session.cwd }}</span>
        </div>
        <div class="meta muted mono">
          <span :data-cy="`unresumable-status-${session.sessionId}`">{{ session.status }}</span>
          <!-- ⚑ **The SAME cell as the offerable half above** (222). A row that cannot be reopened
               is exactly as likely to have been cut off mid-turn, and this list is the one surface
               that shows both halves — so an ending on only one of them would have been a
               difference between two rows that has nothing to do with how either ended. -->
          <span
            v-if="endingLabel(session.lastEnding)"
            :data-cy="`unresumable-ending-${session.sessionId}`"
            :data-ending="session.lastEnding"
            :class="{ unfinished: endedUnfinished(session.lastEnding) }"
            :title="endingLabel(session.lastEnding)?.sentence"
          >
            {{ endingLabel(session.lastEnding)?.word }}
          </span>
          <!-- Same reason as the rows above: two of these can differ only by profile.
               🔴 **`?? 'default'` was FALSE on this list, and 167 §4's check is what found it.** This
               half is the only surface that shows rows the sweep took out of the user's OWN provider
               folder, and for those `profileId` is `null` because there IS no profile — the store's
               `foundInUserHome` is literally `adoptedAt !== null && profileId === null`. Reading
               that null as `default` put a conversation from `~/.claude` under the name of a BroBot
               home it has never been in, which is 086 in one word. The row carries the answer, so
               this asks the row rather than re-deriving the predicate (032). -->
          <!-- 🔴 **714 · R41 — NAMED**, as the row above — except for the two rows this app ran as
               nobody, which say where they came from instead of taking the word *agent*.
               ⛔ **A row restored from a bundle FIRST** (714's review): another machine ran it, and
               the slug its bundle carries is an identity on THAT machine — `agentName`'s own note
               (*"Any OTHER caller owes the same check"*) and `LibraryEntry.profileId`'s (*"absent is
               this app did not run it as anybody"*). ⚠️ First because an import sets `adopted_at`,
               so a bundle that names no profile is ALSO `foundInUserHome` — `session-library.ts`
               and `whyNotResumable` ask the bundle first for the same reason.
               ⛔ Then a row from the person's own folder, which ran as no agent at all. -->
          <span data-cy="unresumable-profile">
            <template v-if="session.restoredFromBundle">from a bundle</template>
            <template v-else-if="session.foundInUserHome"
              >from {{ providerName(session.provider) }}'s own folder</template
            >
            <template v-else>agent: {{ agentName(session.profileId, props.identities) }}</template>
          </span>
          <span>{{ ago(session.updatedAt) }}</span>
        </div>
        <span class="muted why" data-cy="unresumable-reason">{{ session.reason }}</span>
        <!-- ⚑ **D-017b · the same one press** — its view draws what the ledger holds and says, in the
             reason above, why a message there would not continue it. -->
        <button
          type="button"
          class="primary"
          :data-cy="`sessions-open-${session.sessionId}`"
          @click="emit('open', session.sessionId)"
        >
          Open
        </button>
      </li>
    </ul>

    <!-- Found in a home and deliberately NOT adopted. Nothing else will ever mention these, and
         a session that is quietly dropped is exactly the silence this feature exists to end. -->
    <details v-if="lastScan && lastScan.skipped.length > 0" class="skipped" data-cy="scan-skipped">
      <summary class="muted">{{ lastScan.skipped.length }} found but not adopted — why</summary>
      <ul>
        <li v-for="entry in lastScan.skipped" :key="entry.path" class="muted mono">
          <span class="provider">{{ entry.provider }}</span>
          {{ entry.reason }}
          <div class="path">{{ entry.path }}</div>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
header {
  display: flex;
  gap: var(--space-5);
  align-items: baseline;
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--muted);
  font-size: var(--type-caption);
}

.link:hover {
  color: var(--accent-text);
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  align-items: center;
  padding: var(--space-3) var(--space-2);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-1) var(--space-4);
  grid-template-columns: minmax(0, 1fr) auto;
}

.what {
  display: flex;
  gap: var(--space-4);
  align-items: baseline;
  min-width: 0;
}

.provider {
  color: var(--accent-text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.cwd {
  overflow: hidden;
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1;
  font-size: var(--type-caption);
  gap: var(--space-2) var(--space-4);
}

/* ⚠️ **222 · `--waiting`, and deliberately NOT `--danger`.** An unfinished ending is not an error —
   most of them are a person closing a window — and painting four of the five endings red would make
   the list shout at its own ordinary case. Amber is this app's "there is something here for you",
   which is exactly what an unfinished turn is. `081`'s rule, on the one surface that lists both
   halves. A `finished` cell inherits `.meta`'s muted colour and says its word quietly. */
.meta .unfinished {
  color: var(--waiting);
}

.row > button {
  grid-column: 2;
  grid-row: 1 / span 2;
}

.gone .what,
.gone .meta {
  opacity: 0.55;
}

.why {
  grid-column: 2;
  grid-row: 1 / span 2;
  max-width: 24ch;
  font-size: var(--type-caption);
  text-align: right;
}

.row-error {
  grid-column: 1 / -1;
  margin: var(--space-1) 0 0;
  font-size: var(--type-caption);
}

.row-actions {
  display: flex;
  grid-column: 1;
  gap: var(--space-5);
}

.exported {
  overflow-wrap: anywhere;
  font-size: var(--type-caption);
}

.err {
  color: var(--danger);
}

.adopted {
  color: var(--accent-text);
}

/* ⚠️ Not a colour alone (082's standing rule, and the same reason the library's chip carries a
   word): the text itself says "sub-agent", so a reader who cannot separate these hues still gets
   the fact. ⛔ And never `--waiting`: a child row is not asking for anything. */
.child {
  color: var(--accent-text);
  font-weight: var(--fw-bold);
}

.scan-summary {
  font-size: var(--type-caption);
}

.skipped {
  margin-top: var(--space-4);
  font-size: var(--type-caption);
}

.skipped li {
  padding: 3px 0;
  border-top: var(--border-width) solid var(--line);
}

.skipped .path {
  overflow-wrap: anywhere;
  opacity: 0.75;
}
</style>
