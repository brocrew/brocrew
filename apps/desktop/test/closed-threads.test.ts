import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  type ResumableSessionInfo,
  type UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'
import { agoWords } from '../src/renderer/src/lib/clock'
import {
  conversationList,
  type ConversationListInput,
} from '../src/renderer/src/lib/conversation-list'

/**
 * **151 · the rule behind a rail row that the host lists**, without a browser.
 *
 * `conversation-list.ts` supplies the shared list; `closed-threads.ts` has no separate
 * projection. List every host conversation newest first, named and placed, with its derived
 * state and any ownership by another window. There is no reopen/read split. The two kinds of
 * row never started here remain excluded.
 *
 * ⚠️ **The markup half is in `test/dom/closed-rail.dom.test.ts` and has to be.** What a row IS —
 * `BUTTON` or not, one `<small>` or two, the same grid as the row above it — is a question only a
 * real engine answers.
 */

const NOW = 1_800_000_000_000

const RESUMABLE: ResumableSessionInfo = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/Users/alex/dev/alpha',
  status: 'idle',
  // 🔴 **421 · `idle` AND not running** — a crashed run's row is settled to `idle` and this app is
  // not running it; a live conversation is `idle` between turns and it is. ⛔ The column cannot tell
  // them apart, so the host answers separately and the row carries the answer.
  running: 'not-running',
  // ⚑ **D-017b · the one state the host derives** — what the row says and draws.
  state: { is: 'idle' },
  // ⚑ **D-016 · commit 7 · R2 — the work that names it**: none, so the row keeps its agent's name.
  named: null,
  approvalMode: 'ask',
  profileId: DEFAULT_PROFILE_ID,
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  ref: { provider: 'claude', sessionId: 'thread-1', cwd: '/Users/alex/dev/alpha', rotation: 0 },
  resumeRefusal: null,
  lastEnding: 'completed',
  updatedAt: NOW - 120_000,
}

/**
 * A conversation THIS APP ran that nonetheless cannot be reopened — a ref we can no longer read.
 *
 * ⚠️ **App-owned since 154**, so the assertions below are about rows that reach the surface; the
 * adopted case is {@link ADOPTED}, and it has its own block.
 */
const UNRESUMABLE: UnresumableSessionInfo = {
  sessionId: 'sess_2',
  provider: 'codex',
  cwd: '/Users/alex/dev/beta',
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  named: null,
  profileId: DEFAULT_PROFILE_ID,
  adoptedAt: null,
  updatedAt: NOW - 3_600_000,
  hasTranscript: true,
  lastEnding: 'completed',
  foundInUserHome: false,
  restoredFromBundle: false,
  reason: 'we can no longer read where this conversation lives, so it cannot be reopened',
}

/**
 * An adopted personal Claude conversation has `profile_id` NULL and `adopted_at` set. Its
 * fixture shape includes 1,875 events and a project cwd; adoption must not place it on the
 * app’s conversation rail.
 */
const ADOPTED: UnresumableSessionInfo = {
  sessionId: 'sess_3',
  provider: 'claude',
  cwd: '/Users/alex/dev/perso/coverdisc-catalog',
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  named: null,
  profileId: null,
  adoptedAt: NOW - 86_400_000,
  updatedAt: NOW - 7_200_000,
  hasTranscript: true,
  lastEnding: 'completed',
  foundInUserHome: true,
  restoredFromBundle: false,
  reason:
    "one of your own Claude conversations, found in Claude's own folder — BroBot can read it " +
    "here, but a reopen would start Claude in BroCrew's own folder, where this conversation is not",
}

const input = (over: Partial<ConversationListInput> = {}): ReturnType<typeof conversationList> =>
  conversationList({ resumable: [], unresumable: [], ...over })

describe('what the rail is allowed to show at all', () => {
  /**
   * ⚑ **D-017b · newest first** — it said *"in the order they came"*, which was the closed list's
   * order under the open one; ⚑ the one list is ordered by when each record last moved, whichever
   * of the host's two halves it came from.
   */
  it('folds both host lists into one, newest first', () => {
    const rows = input({ resumable: [RESUMABLE], unresumable: [UNRESUMABLE] })
    expect(rows.map((row) => row.sessionId)).toEqual(['sess_1', 'sess_2'])
    expect(rows[1]?.place).toBe('beta')
    // ⚑ **The order is the TIME, not the half**: the unresumable row, made newer, comes first.
    const newer = input({
      resumable: [RESUMABLE],
      unresumable: [{ ...UNRESUMABLE, updatedAt: NOW }],
    })
    expect(newer.map((row) => row.sessionId)).toEqual(['sess_2', 'sess_1'])
  })

  /**
   * ⚑ **D-017b · re-aimed from *"hides a conversation that is running"* (090)** — ⛔ there is no
   * running population to hide: a conversation nothing runs, one nobody is watching and one another
   * window holds are all in the one list, each saying the host's state.
   */
  it('⛔ lists a conversation whatever its process is doing, from BOTH halves', () => {
    const rows = input({
      resumable: [
        RESUMABLE,
        { ...RESUMABLE, sessionId: 'sess_unwatched', running: 'unwatched' },
        { ...RESUMABLE, sessionId: 'sess_held', running: 'in-a-window' },
      ],
      unresumable: [{ ...UNRESUMABLE, running: 'unwatched' }],
    })
    expect(rows.map((row) => row.sessionId).sort()).toEqual(
      ['sess_1', 'sess_2', 'sess_held', 'sess_unwatched'].sort(),
    )
  })

  /**
   * 🔴 **449 · it was the LABEL that was read off the directory, and it is the PLACE now.** ⚑ What
   * can be absent is the place, and the row then says one fewer thing.
   */
  it('places a row by its directory, and says nothing at all when it has none', () => {
    expect(input({ resumable: [RESUMABLE] })[0]?.place).toBe('alpha')
    expect(input({ resumable: [{ ...RESUMABLE, cwd: '' }] })[0]?.place).toBeNull()
    // ⚑ **The name survives the empty directory**, which is what makes the null above an absence
    // of one fact rather than of the row.
    expect(input({ resumable: [{ ...RESUMABLE, cwd: '' }] })[0]?.label).toBe(DEFAULT_PROFILE_LABEL)
    // A trailing separator is not a nameless directory.
    expect(input({ resumable: [{ ...RESUMABLE, cwd: '/Users/alex/dev/alpha/' }] })[0]?.place).toBe(
      'alpha',
    )
  })
})

/**
 * **154 · the rail is conversations you can pick up, not everything we ever saw.**
 *
 * > *"I found 3 closed conversations, displaying correctly. I was able to resume two of them.
 * > However, I have no clue what the read only is doing there? I know for a fact that it was not
 * > created inside brobot."*
 */
describe('⛔ a conversation found in the user’s own folder is not a rail row (154 §1)', () => {
  it('is dropped, and the app-owned row beside it is not', () => {
    const rows = input({ unresumable: [UNRESUMABLE, ADOPTED] })
    // ⚠️ **The paired positive is the whole of the assertion.** "The adopted row is gone" is also
    // true of a rule that dropped every unresumable row, or of a fold that returned nothing at all.
    expect(rows.map((row) => row.sessionId)).toEqual(['sess_2'])
  })

  it('⛔ takes the COUNT with it, on a mixed list', () => {
    // Of three input rows, draw only the app-reopenable and read-only rows; exclude the
    // personal conversation adopted from `~/.claude`. The rail count must equal the rows
    // actually drawn, including after a scan.
    const rows = input({ resumable: [RESUMABLE], unresumable: [UNRESUMABLE, ADOPTED] })
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.sessionId)).toEqual(['sess_1', 'sess_2'])
  })

  it('⚑ reads the row’s ANSWER, and does not work the rule out for itself (032)', () => {
    // ⛔ This combination cannot occur in production — `session-store.ts` computes the field from
    // exactly these two columns — and that is why it is the assertion worth making. If this file's
    // rule ever re-derived `adoptedAt !== null && profileId === null` instead of reading what the
    // store sent, there would be two implementations of one question, one of them in a process
    // that has never seen the row. The store's answer wins here, both ways.
    const asIfOwned = { ...ADOPTED, foundInUserHome: false }
    expect(input({ unresumable: [asIfOwned] }).map((row) => row.sessionId)).toEqual(['sess_3'])
    const asIfAdopted = { ...UNRESUMABLE, foundInUserHome: true }
    expect(input({ unresumable: [asIfAdopted] })).toEqual([])
  })
})

describe('how long ago, in the reader’s terms', () => {
  it('crosses each threshold where it says it does', () => {
    expect(agoWords(NOW, NOW)).toBe('0s ago')
    expect(agoWords(NOW - 59_000, NOW)).toBe('59s ago')
    expect(agoWords(NOW - 60_000, NOW)).toBe('1m ago')
    expect(agoWords(NOW - 3_599_000, NOW)).toBe('60m ago')
    expect(agoWords(NOW - 3_600_000, NOW)).toBe('1h ago')
    expect(agoWords(NOW - 86_399_000, NOW)).toBe('24h ago')
    expect(agoWords(NOW - 86_400_000, NOW)).toBe('1d ago')
    expect(agoWords(NOW - 8 * 86_400_000, NOW)).toBe('8d ago')
  })

  it('⚠️ never reports the future as a negative age', () => {
    // A row whose `updated_at` is ahead of this machine's clock is not impossible — an imported
    // conversation carries the provider's timestamps, and clocks disagree.
    expect(agoWords(NOW + 60_000, NOW)).toBe('0s ago')
  })
})

/**
 * # 🔴 The rail's list has TWO classes it must drop (214 §1)
 *
 * ⛔ **Found by an adversarial review.** `fold()` dropped only `foundInUserHome`, so a restored
 * bundle entered the list whose entire purpose is picking things up — and which of the two it landed
 * in depended on what the bundle's `meta` happened to say about a profile. ⚠️ **The same origin chip
 * got opposite treatment on the same surface**, which is worse than either answer alone.
 */
describe('214 §1 · a restored bundle is not something to pick up again', () => {
  const unresumable = (over: Record<string, unknown> = {}): UnresumableSessionInfo =>
    ({
      sessionId: 'sess_r',
      provider: 'claude',
      cwd: '/work/x',
      status: 'ended',
      running: 'not-running',
      state: { is: 'idle' },
      named: null,
      profileId: DEFAULT_PROFILE_ID,
      adoptedAt: 5,
      updatedAt: 2_000,
      hasTranscript: true,
      foundInUserHome: false,
      restoredFromBundle: true,
      reason: 'restored from a bundle — BroCrew has the whole conversation and can show it',
      ...over,
    }) as UnresumableSessionInfo

  it('🔴 is dropped whichever way its bundle described a profile', () => {
    // Both halves of the class, because the defect was that they were treated differently.
    expect(input({ unresumable: [unresumable()] })).toEqual([])
    expect(
      input({ unresumable: [unresumable({ profileId: null, foundInUserHome: true })] }),
    ).toEqual([])
  })

  it('⚑ …and a conversation that CAN be picked up is still listed', () => {
    // The paired positive: a fold that dropped everything would pass the test above.
    const kept = input({ unresumable: [unresumable({ restoredFromBundle: false })] })
    expect(kept).toHaveLength(1)
    expect(kept[0]?.sessionId).toBe('sess_r')
  })
})

/**
 * # 🔴 421 · A conversation the app is RUNNING is never drawn as ended — D-017b: nor is any other
 *
 * ⛔ **HO-023 §2.3, in the PO's words:** *"Listing it under **Closed conversations**, labelling it
 * **ended**, and offering **Reopen** — then refusing the reopen by naming **a window that does not
 * exist** — is four surfaces lying in sequence."*
 *
 * ⚑ **D-017b · re-aimed.** `421` fixed that for a live conversation and kept *ended* for a recording;
 * D-017b removed the word for both — whether a process runs is never said (`05` rule 5). ⚑ What a
 * row carries now is the host's ONE state, passed through untouched, and the one fact about WHERE a
 * conversation is that a person acts on: another window has it open. ⛔ **Each assertion has its
 * control one fact over**, so none passes by the fixture already saying the answer.
 */
describe('421 · the one state, and the one fact about where it is', () => {
  /** The same row, three times over, differing in exactly the field the host answers. */
  const as = (running: ResumableSessionInfo['running']): ResumableSessionInfo => ({
    ...RESUMABLE,
    sessionId: `sess_${running}`,
    running,
  })

  it('🔴 the row says the state the HOST derived — never one it works out from the status column', () => {
    // ⚠️ **The status column says `working` and the host says `idle`**: the row believes the host.
    const [stale] = input({ resumable: [{ ...as('not-running'), status: 'working' }] })
    expect(stale?.state).toEqual({ is: 'idle' })
    // ⚑ The control: the host's other word comes through as it was said.
    const [busy] = input({
      resumable: [{ ...as('unwatched'), status: 'idle', state: { is: 'active' } }],
    })
    expect(busy?.state).toEqual({ is: 'active' })
    // ⚑ …on the unresumable half too — a live Claude conversation has no ref until its first
    // turn's init lands, so for that whole turn it is on this half.
    const [early] = input({
      unresumable: [{ ...UNRESUMABLE, running: 'unwatched', state: { is: 'active' } }],
    })
    expect(early?.state).toEqual({ is: 'active' })
  })

  it('⛔ another WINDOW holding it is said, and only that — not *nobody is watching*, not *not running*', () => {
    const [held] = input({ resumable: [as('in-a-window')] })
    expect(held?.inAnotherWindow).toBe(true)
    // ⚑ The controls, one fact over each: nobody holds it, and nothing runs it — neither is said.
    const [unwatched] = input({ resumable: [as('unwatched')] })
    const [recorded] = input({ resumable: [as('not-running')] })
    expect(unwatched?.inAnotherWindow).toBe(false)
    expect(recorded?.inAnotherWindow).toBe(false)
    // ⚑ …and the unresumable half carries it too.
    const [elsewhere] = input({ unresumable: [{ ...UNRESUMABLE, running: 'in-a-window' }] })
    expect(elsewhere?.inAnotherWindow).toBe(true)
  })
})
