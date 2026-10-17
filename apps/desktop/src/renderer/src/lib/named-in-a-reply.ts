/**
 * 🔴 **The WALK that turns a name a model wrote into a control this app authored** (439, 562).
 *
 * ⚑ **The POLICY stays with the caller and only the walk is here.**
 * `the-documents-a-reply-names.ts` decides what a name is — an id carrying `doc:` is never an
 * ordinary word. ⛔ That decision does not belong to a tag walker, and folding it in here would be
 * the shared-guard mistake (`extracting-a-shared-guard-exports-its-policy`): this module must not
 * acquire an opinion about what a name IS.
 *
 * ## ⚠️ Why the HTML and not the Markdown
 *
 * ⛔ **`renderChatMarkdown` runs with `html: false`**, which is the invariant `AssistantMessage.vue`
 * rests on: *"this string cannot contain markup from the reply"*. ⚑ Transforming the SOURCE would
 * put a `<button>` through a renderer whose whole job is to escape one. ⛔ **Transforming the OUTPUT
 * keeps that invariant exactly true** — the only markup in the result that did not come from
 * markdown-it is the markup a {@link MarkPlan.mark} wrote, from a value this app already holds,
 * escaped on the way out.
 *
 * ## 🔴 Three places it deliberately does not look
 *
 * ⛔ **Inside a tag** — an attribute value that happened to spell a name is not a person's prose,
 * and rewriting one would corrupt the markup. ⛔ **Inside `<pre>`** — a name in a fenced block is a
 * string somebody is quoting, and a button in a code sample is a lie about what the sample says; an
 * INLINE `<code>` is the opposite signal and is walked. ⛔ **Inside `<a>`** — a control inside a link
 * is two destinations in one target, and the link was already there.
 */

/**
 * ⛔ **Elements whose text is a thing to COPY, is already a destination, or is already a control.**
 *
 * ⚠️ **`code` is deliberately NOT here.** A fenced block is a command somebody is meant to copy and
 * `<pre>` covers it; an INLINE code span is the opposite signal — the strongest in a reply that a
 * word is a name.
 *
 * 🔴 **`button`, because a control is never walked into.** ⛔ **markdown-it cannot emit one** —
 * `html: false` — so the only `<button>` in this string is one this walk wrote, and its text is a
 * value this app already resolved.
 */
const LEAVE_ALONE: ReadonlySet<string> = new Set(['pre', 'a', 'button'])

/**
 * ⛔ **An HTML entity, as one atom** — markdown-it escapes `&`, `<`, `>` and `"` into `&amp;`,
 * `&lt;`, `&gt;` and `&quot;` before this function ever sees the text (its own `escapeHtml`).
 *
 * 🔴 **Found by `439`'s review, and the failure is visible mojibake rather than a missed match.** A
 * roster holding `amp` — a legal slug — would match the middle of `&amp;` in *"Use A & B"* and emit
 * `Use A &<button …>amp</button>; B`, which a browser renders as a bare ampersand, a clickable word
 * and a semicolon. ⚠️ **That is markup at a position markdown-it did not put one**, which is the one
 * thing this file exists not to do.
 */
const AN_ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#[xX][0-9a-fA-F]+);/g

/**
 * ⛔ **A roster member's own characters, made literal.** Nothing validates a document id against a
 * regex vocabulary before it reaches here — so a row holding `a.b` would otherwise match `axb`.
 */
export function literal(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** ⛔ The four characters that could reopen markup, in text and in an attribute alike. */
export function escaped(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * ⚑ **What an `Element` can do that an `EventTarget` cannot** — see {@link markedValueAt}.
 *
 * ⛔ **A structural type and not `instanceof Element`** (`562`). ⚠️ The reason is measured rather
 * than stylistic: `Element` is a DOM global, so naming it made this
 * module — and every module that imports it — uncheckable by the node TypeScript project and
 * unloadable in a node test, where `instanceof Element` throws `ReferenceError` before it can
 * answer. ⚑ Nothing is weakened: `closest` is on `Element` and on nothing else a click can land
 * on, and `window` and `document` both fail this check exactly as they failed the old one.
 */
interface CanBeAskedForAnAncestor {
  closest(selector: string): { getAttribute(name: string): string | null } | null
}

/**
 * ⛔ **The value a click landed on, or `null`** — the delegation half, shared so the `closest`
 * ruling is written once.
 *
 * ⚠️ **`closest` and not `target`**, because a person clicks the text inside the button as often as
 * the button itself.
 *
 * @param attribute the data attribute a caller's own {@link MarkPlan.mark} wrote.
 */
export function markedValueAt(target: unknown, attribute: string): string | null {
  const asked = target as Partial<CanBeAskedForAnAncestor> | null | undefined
  if (asked === null || asked === undefined || typeof asked.closest !== 'function') return null
  return asked.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null
}

/** 🔴 **The caller's vocabulary.** Everything this walk needs that is not the walk. */
export interface MarkPlan {
  /** ⛔ **What may match**, in running prose and inside an inline `<code>` span alike. */
  readonly pattern: RegExp
  /**
   * ⚠️ **What counts as part of a name here**, tested against the character before and after a hit.
   * ⛔ A caller's vocabulary and never this module's: a document id does not end at a `:`.
   *
   * ⛔ **It may not carry `g`.** `RegExp.test` on a global pattern advances `lastIndex`, so the same
   * object would answer differently on its second call and every other hit in a run would be let
   * through. ⚑ The match pattern above is the opposite — it is stepped with `exec` and therefore
   * MUST carry it.
   */
  readonly boundary: RegExp
  /** ⛔ **The markup to put in its place.** The caller escapes; this walk never writes a tag. */
  mark(found: string): string
}

/**
 * 🔴 **Wrap every whole-word hit in the markup its caller writes.**
 *
 * @param html the output of `renderChatMarkdown`, and nothing else.
 * @param plan the caller's vocabulary — see {@link MarkPlan}.
 */
export function markNamesIn(html: string, plan: MarkPlan): string {
  let out = ''
  let index = 0
  let quiet = 0
  while (index < html.length) {
    const open = html.indexOf('<', index)
    const text = open === -1 ? html.slice(index) : html.slice(index, open)
    // ⛔ **Two readings of one text run**: inside `<pre>`, `<a>` or a `<button>` nothing is
    // touched; everywhere else the caller's pattern applies.
    out += quiet > 0 ? text : mark(text, plan.pattern, plan)
    if (open === -1) break
    const close = html.indexOf('>', open)
    // ⚠️ **An unterminated `<` is copied and the walk ends.** markdown-it does not emit one; a
    // reader arriving here with hand-written html gets its text back rather than a rewrite of it.
    if (close === -1) {
      out += html.slice(open)
      break
    }
    const tag = html.slice(open, close + 1)
    out += tag
    const name = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)?.[1]?.toLowerCase()
    if (name !== undefined && !tag.endsWith('/>')) {
      // ⛔ **COUNTERS and not booleans**, because these nest — `<pre><code>` is markdown-it's own
      // shape for a fence — and a boolean would reopen the walk at the inner close tag, marking
      // the tail of every fenced block.
      const step = tag.startsWith('</') ? -1 : 1
      if (LEAVE_ALONE.has(name)) quiet = Math.max(0, quiet + step)
    }
    index = close + 1
  }
  return out
}

/**
 * One text run, with every whole-word hit wrapped.
 *
 * ⛔ **Entities are walked AROUND rather than into** — see {@link AN_ENTITY}. ⚑ The run is split
 * into plain segments and entity segments, and only the plain ones are matched.
 */
function mark(text: string, pattern: RegExp, plan: MarkPlan): string {
  AN_ENTITY.lastIndex = 0
  let out = ''
  let at = 0
  for (let found = AN_ENTITY.exec(text); found !== null; found = AN_ENTITY.exec(text)) {
    out += markPlain(text.slice(at, found.index), pattern, plan) + found[0]
    at = found.index + found[0].length
  }
  return out + markPlain(text.slice(at), pattern, plan)
}

/**
 * One run with no entity in it.
 *
 * ⚠️ **The reset is REDUNDANT today and is kept deliberately — measured at `562`.** ⛔ This loop
 * ends only when `exec` returns `null`, and a failing `exec` sets `lastIndex` back to `0` itself,
 * so no row in `562`'s table can make the line matter and it is not carrying a rule
 * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ It stays because the day anything
 * leaves this loop early — a `break`, a `return`, a throw a caller catches — a shared pattern
 * resumes from the middle of the next run and every name after it goes silently unmarked. **The
 * cost of keeping it is one assignment; the cost of the failure is invisible.**
 */
function markPlain(text: string, pattern: RegExp, plan: MarkPlan): string {
  pattern.lastIndex = 0
  let out = ''
  let last = 0
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    const start = hit.index
    const end = start + hit[0].length
    const before = start === 0 ? '' : (text[start - 1] ?? '')
    const after = end >= text.length ? '' : (text[end] ?? '')
    if (plan.boundary.test(before) || plan.boundary.test(after)) continue
    out += text.slice(last, start) + plan.mark(hit[0])
    last = end
  }
  return out + text.slice(last)
}
