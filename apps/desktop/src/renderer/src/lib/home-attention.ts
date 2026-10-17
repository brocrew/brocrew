import type { AttentionRequest } from './attention'

/**
 * **What needs the user — decided ONCE, for every summary that says so** (305 §1, from `304`'s
 * ranked BROKEN row).
 *
 * ## ⛔ The screen that disagreed with itself
 *
 * `304` measured a screen that said *"Nothing needs you. The workspace is quiet"* in its header,
 * **All clear** in its stat and *"Nothing needs you"* in its panel, while the rows below them read
 * another population — and the rail's badge was not drawn at all. ⚠️ **Nothing was lying about its
 * own source**: one boolean, `quiet`, had been redefined under four consumers, and the rows went on
 * reading something else.
 *
 * ⛔ **So the fix is not a filter on each summary; it is this file.** Every count and every sentence
 * about what needs the user is decided here, from EVERY population, and each surface renders what it
 * is handed — `WaitingOnYou.vue`, and the rail's badge from the same call. There is no second
 * predicate left to drift — the same remedy shape as `permission-offer.ts` (299 §1) and
 * `user-input-offer.ts` (214 §3).
 *
 * ## ⚑ The populations stay named, because they are different kinds of thing
 *
 * ⚠️ **Stated without a COUNT**, `396`'s correction applied here: a sentence that enumerates a list
 * it does not own goes quietly wrong the first time the list grows.
 *
 * `live` is answerable here and now: real pending requests on real open conversations. `onlyYou` is
 * what nobody else may settle — a question that is a person's, or a request that was never routed to
 * anybody else at all — real, and not answerable on this screen. ⚠️ **Ordinarily raised inside a
 * conversation this window is not running, which is why `live` cannot see it, and *ordinarily*
 * rather than *always*:** nothing filters on it, and a person who takes such a conversation over is
 * running it a second later.
 *
 * ⛔ **They are added together and never blended.** A summary may say that several things need you,
 * because several do, but no surface may present an escalated row as a card it can answer. That is
 * `HO-002` acceptance #7 and it is why {@link HomeAttention} carries each number rather than a total
 * the caller cannot take apart again.
 *
 * ⚠️ **`quiet` means the SCREEN is quiet, not that one of its lists is.** It is the only state in
 * which any summary is allowed to say "nothing needs you", and it is the reason this type exists.
 */

/** Amber when something is waiting; green only when nothing is. */
export type HomeTone = 'ok' | 'waiting'

/**
 * 🔴 **688 · F3 — the stat's word and tone when an AMBER line stands on the same page.**
 *
 * ⚑ **Ruled (`688` §3.1): a green *All clear* never sits beside an amber line.** A wall (*"Claude is
 * near its weekly limit; …"*, UI-009) and stopped work are drawn amber on the *Waiting on you* page, and
 * neither is owed by the person (`533`), so `homeAttention` stays quiet — its words agree with the
 * line, and its GREEN did not: a person reads the tone first. ⚑ **So the stat says what is true of
 * the person, in the neutral ink**: nothing is owed by them — {@link NOTHING_OWED}.
 *
 * ⛔ **Asked OUTSIDE `homeAttention({ … })`**, whose call sites a census keeps free of every hole
 * and band (`persons-queue.test.ts` §9.6): a wall does not change how much the person owes, only
 * the tone the answer may be drawn in. ⚠️ `null` is the neutral ink — no class.
 */
export const NOTHING_OWED = 'Nothing'

export function theStatBesideTheLines(
  attention: Pick<HomeAttention, 'quiet' | 'stat' | 'statTone'>,
  anAmberLineStands: boolean,
): { readonly stat: string; readonly tone: HomeTone | null } {
  return attention.quiet && anAmberLineStands
    ? { stat: NOTHING_OWED, tone: null }
    : { stat: attention.stat, tone: attention.statTone }
}

export interface HomeAttention {
  /** Real pending requests across open conversations — answerable on this screen. */
  live: number
  /**
   * 🔴 **What only a PERSON may settle, from conversations this window is ordinarily not
   * running** (401 for the first half, `403` for the second, criterion 11).
   *
   * ⛔ **Two readers behind one number, and it is one number because it is one LIST.** A question
   * that reached a person may still be answered by the parent that was asked — which is `HO-088`
   * §2.3's own ruling since `611`, and was a deadline's accident before it; a request refused entry
   * to the question channel was never anybody else's. ⚠️ **`401` shipped only the first**,
   * and `402` measured live that the second is the population a spawned child actually lands in —
   * every spawned child is `ask` by rail, so it parks on a permission card that no escalation can
   * ever reach. ⛔ **Named `onlyYou` since `403` rather than `escalated`**, because the old name
   * described one of the two and a name that describes drifts every time the thing changes.
   *
   * ⛔ **Leaving it out is `304` again.** `398` measured the hole in its own words: *"the
   * renderer's `attentionQueue()` only covers sessions the window OWNS, so a question escalated
   * from an unclaimed child is genuinely invisible to a person today."* ⚠️ *Ordinarily* invisible
   * rather than always — nothing here filters on it. A screen that counted only what it could see
   * would go on saying *"Nothing needs you"* over a worker that has been frozen on an unanswered
   * question for as long as the app has been open.
   *
   * ⚠️ **It counts ROWS, which is what every number on this object counts.** `live` is
   * `requests.length` — *how many rows are in the list*, not how many distinct conversations they
   * concern. ⚑ **D-017 · R19 — and no request is two rows any more**: `live` is only the cards no
   * host read lists (`listedNowhereElse`), so a request the person's queue lists is counted there
   * once.
   */
  onlyYou: number
  /**
   * 🔴 **At least one of the person's own populations could not be READ** (403, from the review) —
   * `PersonsQueueView.partial`, carried through so every summary on this screen knows.
   *
   * ⛔ **It is not a count and it adds to none.** What it does is forbid {@link quiet}: *"Nothing
   * needs you."* over a list the app failed to look at is the strongest false claim this screen
   * can make, and it is the one `086`'s rule is about.
   */
  unread: boolean
  /** Everything waiting on a person: `live + onlyYou`. */
  total: number
  /** ⛔ Nothing on the screen needs the user. The ONLY state any summary may say so in. */
  quiet: boolean
  /**
   * The **NEEDS YOU** stat: "All clear", "Not known", or "4 items".
   *
   * ⚑ **606 · drawn by `WaitingOnYou`'s header**, which is where `EXT-008` §3 put the population
   * it counts.
   */
  stat: string
  statTone: HomeTone
  /** The introduction over the queue. */
  intro: string
}

/**
 * The introduction over a page where every item waiting is a request for a permission — said only
 * then, so a question or a request of another kind is never called a permission.
 */
export function permissionsIntro(count: number): string {
  return count === 1
    ? '1 request needs your permission.'
    : `${String(count)} requests need your permission.`
}

/** "4 items", "1 item" — the plural said once. */
function items(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`
}

/**
 * ⛔ **The whole attention state, from the lists a screen draws.**
 *
 * Pure and total: hand it a world and it says what the screen may claim about it. That is what lets
 * a test drive the contradiction directly.
 */
export function homeAttention(world: {
  /** The live queue, exactly as `attention.ts` projected it. */
  requests: readonly AttentionRequest[]
  /**
   * 🔴 **At least one of the person's own populations is not being answered for** —
   * `PersonsQueueView.partial` **or** `.stale` (403, from the review; widened by 434).
   *
   * ⚠️ **Two holes, one consequence here.** `partial` is *a list has never been read* and `stale`
   * is *a list has stopped being read*; the sentences a person sees for them differ and are the
   * queue's own, but `quiet` is forbidden by either — a screen cannot say the workspace is quiet
   * over a list it stopped hearing from an hour ago any more than over one it never heard from.
   *
   * ⛔ **It exists because `quiet` is a CLAIM and this screen would otherwise make it out of a
   * failure.** With one read refused and the other genuinely empty there are no rows to count,
   * so every number here is zero and `quiet` was `true` over a list the app never managed to look
   * at. ⚑ `086`'s rule: not knowing is not an all-clear, and this is the one input that says *not
   * knowing*.
   *
   * ⚠️ **It does not add to any COUNT**, because it is not a row. What it does is forbid `quiet`
   * and give the summaries a sentence for the state.
   */
  unread?: boolean
  /**
   * ⛔ **Rows in the person's own queue, BOTH populations** — `PersonsQueueView.count` — ⚑ **and
   * since D-017 (R19) the instruction asks drawn beside it**, added at each call site.
   *
   * ⚠️ **Optional, and `401` measured what that costs.** Leaving it off compiles, runs, and makes
   * the caller's arithmetic silently one population short — which is how the rail came to draw no
   * badge over a question the screen it opens was listing. ⛔ It is kept optional because
   * `home-attention` is called from tests, and the guard is the source census in
   * `persons-queue.test.ts` **§7**, which walks both production call sites — `RuntimeScreen.vue`
   * and `WaitingOnYou.vue`.
   */
  onlyYou?: number
}): HomeAttention {
  const live = world.requests.length
  const onlyYou = world.onlyYou ?? 0
  const unread = world.unread ?? false
  const total = live + onlyYou
  // ⛔ **Nothing needs you AND this screen knows it.** See {@link homeAttention}'s `unread`.
  const quiet = total === 0 && !unread

  return {
    live,
    onlyYou,
    unread,
    total,
    quiet,
    // ⚠️ **"Not known" rather than "0 items"** — the stat is the screen's one-word summary and
    // there is no number to give when a list did not answer.
    stat: quiet ? 'All clear' : total === 0 ? 'Not known' : items(total),
    statTone: quiet ? 'ok' : 'waiting',
    /**
     * ⚠️ **Three states, not two, and the middle one is the whole defect.** With a live request
     * waiting the panel invites an answer; with none it says which half is quiet.
     */
    intro: quiet
      ? 'Nothing here is blocked on an answer from you.'
      : // ⛔ **First, because it is the only arm that is about not KNOWING**, and every arm below
        // it states something about what is on the screen. See `unread`.
        total === 0
        ? 'One of the lists that would say what needs you could not be read just now. Nothing else on this screen is blocked on you.'
        : live > 0
          ? 'Answer here, or open the card for the full disclosure.'
          : // ⚑ **401's clause.** With nothing answerable on this screen and something waiting on a
            // person from a conversation it is not running, the true sentence is this one.
            //
            // ⛔ **It names no population and no location, and `403` is why for both.** The number
            // folds two kinds of thing, so *"questions"* would be false of half of it; and
            // *"conversations it is not running"* was only ever ORDINARILY true. ⚑ **UI-009 (F052) ·
            // and it no longer explains the machinery** — *"No conversation on this screen is
            // blocked on you … and each is settled on its own card"* told a person how the page
            // works; what they need is that something is below, waiting on them.
            `${items(onlyYou)} below ${onlyYou === 1 ? 'is' : 'are'} waiting on you.`,
  }
}
