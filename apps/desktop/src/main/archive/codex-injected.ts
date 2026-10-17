import { WHAT_CHANGED_HEADER } from '../runtime/codex-lead'
import { SAVED_METHODS_HEADING } from '../runtime/factory-text'
import { THIS_CONVERSATION_HEADER } from '../runtime/instructions'
import {
  savedMethodsLinesInSection,
  withTheLinesKept,
  withTheLinesKeptIn,
  type SavedMethodsLines,
} from '../saved-methods'

/**
 * # ⛔ Which parts of a Codex `message` line the PERSON actually said (214 §2)
 *
 * `213`, on the adoption path: a one-line provider-only Codex session, adopted with *"Check
 * homes"*, opened as a transcript. Before the actual one-line prompt, BroBot rendered
 * `<skills_instructions>`, `<permissions instructions>`, app/plugin material,
 * `<recommended_plugins>` and `<environment_context>` as ⛔ **multiple `"You (per the transcript)"`
 * messages** — *"the most annoying moment"*, and *"it buries the human's actual prompt underneath
 * it"*.
 *
 * ⚑ **The provenance qualifier was doing its job. `You` was still the wrong speaker.** `074`'s mark
 * says *a file claimed this, we did not watch it*; it does not say *somebody else wrote this*. So
 * the fix is not a better qualifier, it is not attributing the line to the user at all.
 *
 * ## ⚠️ What the sibling importer has done since 074
 *
 * `import-claude.ts` already refuses this: `isMeta` and array-of-text content both become
 * `unknown{category:'echo'}` — *"kept, classified, and not spoken: the record is carried whole in
 * `raw`, so nothing is lost"*. That category is invisible in BOTH transcript modes
 * (`transcript-mode.ts`) and whole in the Events tab. ⛔ **This file is the Codex importer learning
 * what its sibling already knew**, which is why it adds no event type, no wire field and no
 * component: the vocabulary for *"the harness spoke in the user's name"* has existed for six
 * dispatches and one of the two importers was not using it.
 *
 * ## 🔴 Measured on the WHOLE corpus — 2,345 rollouts under `~/.codex/sessions`
 *
 * ⛔ **The first version of this module was built from a 120-rollout SAMPLE and the sample lied.**
 * It concluded the leftover bucket was *"the human's own prompts, untouched by every rule here"*;
 * an adversarial review measured the full corpus and found **542** harness messages in it, including
 * `<skill>` blocks of up to **22,018 characters** rendered as "You" ahead of a 99-character prompt —
 * `213`'s complaint verbatim, still reproducible after the first fix. Rules 4 and 5 exist because of
 * that, and every number below is now the whole corpus rather than a slice of it.
 *
 * | | count | verdict |
 * |---|---:|---|
 * | `role: 'developer'` | **7,013** | ⛔ every one is harness material — `<skills_instructions>`, `<permissions instructions>`, `<multi_agent_mode>`, `<app-context>`, `You are /root…` |
 * | `role: 'user'`, wholly injected | **5,633** | the environment tail, a whole wrapped element, or the AGENTS.md preamble |
 * | `role: 'user'`, preamble **+ the person's request** | **3,296** | ⚑ split on {@link REQUEST_MARKER}: the wall goes to Events, the ask stays a user turn |
 * | `role: 'user'`, the person | **30,300** | ⛔ untouched, and the ONLY ones that still open with a tag are `<image …>` — see {@link PERSON_AUTHORED_TAGS} |
 *
 * ⛔ **12,646 messages were rendering as `You` and were not**, and a further **3,296** had the
 * person's words buried under a preamble in the same bubble.
 *
 * ## The three rules, and which are structural
 *
 *  1. **The role** — anything that is neither `user` nor `assistant` is not the user. ⚑ Structural,
 *     provider-neutral, and it is `lineEvents`' own comment come true: *"the test is `role !==
 *     'assistant'`, so EVERY role Codex ever adds — and every role a writer of this file invents —
 *     speaks in the user's name by default."*
 *  2. **{@link REQUEST_MARKER}** — Codex's own separator. The block above it says of itself *"This
 *     block is automatically supplied ambient UI state, not part of the user's request"*; the
 *     marker is where the CLI stops speaking and the person starts. ⚑ This is the rule that
 *     delivers §2's *"show the human prompt once"*: the words below it become the user turn, and
 *     the wall above it does not.
 *  3. **{@link ENVIRONMENT_CLOSE}** — a preamble the CLI appends `<environment_context>` to and
 *     sends with no request attached. The whole line is context.
 *  4. **{@link WHOLLY_WRAPPED}** — the message IS one element. ⚑ Structural, and the rule that makes
 *     this module survive Codex inventing another wrapper: a new one is caught by default.
 *  5. **{@link AGENTS_HEADING}** — the instruction preamble on the ~8% of occurrences that arrive
 *     with no environment block behind them.
 *
 * ⚠️ **2, 3 and 5 are Codex's vocabulary, and that is stated rather than hidden** — which is why this
 * module sits beside `import-codex.ts` and is named for it. 1 and 4 are structural and are what the
 * module leans on. A person who types {@link REQUEST_MARKER} at the start of a line in their own
 * prompt would have that prompt split; measured across 2,345 rollouts that has never happened. It is
 * a real residual and it is far smaller than the defect it replaces.
 */

/** Codex's own separator between the ambient block it supplied and what the person asked for. */
export const REQUEST_MARKER = '## My request for Codex:'

/** The tail the CLI appends to a preamble it sends without a request. */
export const ENVIRONMENT_CLOSE = '</environment_context>'

/**
 * 🔴 **A message that is ONE wrapped element, whole** — `<skill>…</skill>`, `<heartbeat>…</heartbeat>`.
 *
 * ⛔ **This rule was missing, and an adversarial review measured what that cost.** The first version
 * of this module was built from a 120-rollout sample and claimed the leftover bucket was *"the
 * human's own prompts, untouched by every rule here"*. Over the WHOLE corpus — **2,345 rollouts,
 * 39,271 `role:'user'` messages** — that is false: **542** of them are harness material that fell
 * through, including `<skill>` blocks of up to **22,018 characters** rendered as "You" ahead of a
 * 99-character prompt. That is `213`'s complaint verbatim, still reproducible after the first fix.
 *
 * ⚑ **Structural, so it does not rot.** Not a list of tags: *any* element that wraps a whole message
 * is something a harness put there, including ones Codex has not invented yet. Measured on the full
 * corpus, this rule alone catches **292** — `<turn_aborted>` 151, `<heartbeat>` 72, `<skill>` 47,
 * `<subagent_notification>` 20, `<user_instructions>` 2 — and **28,595** plain prose messages are
 * untouched by it.
 */
const WHOLLY_WRAPPED = /^\s*<([a-zA-Z][a-zA-Z0-9_-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>\s*$/

/**
 * ⛔ **The one wrapper a PERSON writes, and it must never be swallowed.**
 *
 * `<image name=[Image #1] path="…"></image>` is somebody attaching a picture with nothing else to
 * say. Two such messages in the corpus are wholly wrapped and would otherwise match the rule above —
 * and turning a person's only message into harness chatter is a worse failure than the one this
 * module exists to fix, because it does not misattribute the message, it DELETES it.
 *
 * ⚠️ **An exemption rather than an allow-list, deliberately.** A list of harness tags would need
 * extending every time Codex adds one, and the failure of a stale list is silent. This way a new
 * wrapper is caught by default and only a new PERSON-authored one would need a line here.
 */
const PERSON_AUTHORED_TAGS = new Set(['image'])

/**
 * The CLI's own instruction preamble, which it sends without an `<environment_context>` tail on
 * about 8% of occurrences — **107** of 1,341 measured, so rule 3 alone does not cover it.
 */
const AGENTS_HEADING = '# AGENTS.md instructions'

/** What one `message` line really contains. */
export interface CodexMessageParts {
  /** True when any part of this line was put there by the harness rather than typed. */
  injected: boolean
  /**
   * What the person said, or `null` when they said nothing in this line.
   *
   * ⚠️ **Never the empty string.** An empty request is the same fact as no request, and two spellings
   * of it would give the caller a bubble to draw with nothing in it.
   */
  said: string | null
}

/**
 * Split one Codex `message` into what the harness supplied and what the person typed.
 *
 * `role` is passed as the raw value off the line — `unknown`, because the file is input and a role
 * this build has never heard of must land in rule 1 rather than in a `default` that means "user".
 */
export function splitCodexMessage(role: unknown, text: string): CodexMessageParts {
  // 1 · Not the user's role at all. `developer` today; whatever Codex adds next, tomorrow.
  if (role !== 'user') return { injected: true, said: null }

  // 2 · The CLI's own separator: everything above it is ambient, everything below it is the ask.
  const marker = text.indexOf(REQUEST_MARKER)
  if (marker !== -1) {
    const said = text.slice(marker + REQUEST_MARKER.length).trim()
    // ⚠️ **`injected` is what is ABOVE the marker, not the marker's presence.** A message that is
    // nothing but the separator and the prompt has no preamble to keep, and reporting one made the
    // Events tab hold a second full copy of the person's words labelled "injected context".
    return { injected: text.slice(0, marker).trim() !== '', said: said === '' ? null : said }
  }

  // 3 · A preamble with the environment block appended and no request attached.
  if (text.trimEnd().endsWith(ENVIRONMENT_CLOSE)) return { injected: true, said: null }

  // 4 · One element, wrapping the whole message — see {@link WHOLLY_WRAPPED}.
  const wrapper = WHOLLY_WRAPPED.exec(text)
  if (wrapper !== null && !PERSON_AUTHORED_TAGS.has(wrapper[1]!.toLowerCase())) {
    return { injected: true, said: null }
  }

  // 5 · The instruction preamble that arrived without an environment block behind it.
  if (text.trimStart().startsWith(AGENTS_HEADING)) return { injected: true, said: null }

  return { injected: false, said: text }
}

/** How the lead this app puts in front of a Codex message opens: the whole of it, or what changed. */
const LEAD_OPENS_WITH = [THIS_CONVERSATION_HEADER, WHAT_CHANGED_HEADER].map((line) => `${line}\n\n`)

const SAVED_METHODS_SECTION = `\n\n## ${SAVED_METHODS_HEADING}\n\n`

/**
 * The saved methods' lines in the lead this app put in front of a message's text, and what a record
 * keeps in their place; `null` when the text opens with no lead, or its lead lists none. The lead and
 * the message's words are handed over as one text, so they are one block of the message.
 */
export function savedMethodsLinesInLead(text: string): SavedMethodsLines | null {
  const opens = LEAD_OPENS_WITH.find((line) => text.startsWith(line))
  if (opens === undefined) return null
  // The section may be the lead's first, right after its opening line.
  const at = text.indexOf(SAVED_METHODS_SECTION, opens.length - 2)
  if (at === -1) return null
  return savedMethodsLinesInSection(text.slice(at + SAVED_METHODS_SECTION.length))
}

/** A text block's text, of either direction. */
const TEXT_BLOCKS = new Set(['input_text', 'output_text', 'text'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A Codex `message` as this app's records keep it: the saved methods' lines in a lead this app put in
 * front of it replaced, in every string, by their kept form. The same value when it holds none.
 */
export function codexMessageAsKept(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload['role'] !== 'user') return payload
  const content = payload['content']
  const texts =
    typeof content === 'string'
      ? [content]
      : Array.isArray(content)
        ? content.flatMap((block: unknown) =>
            isRecord(block) &&
            typeof block['type'] === 'string' &&
            TEXT_BLOCKS.has(block['type']) &&
            typeof block['text'] === 'string'
              ? [block['text']]
              : [],
          )
        : []
  let kept = payload
  for (const text of texts) {
    const lines = savedMethodsLinesInLead(text)
    if (lines !== null) kept = withTheLinesKeptIn(kept, lines) as Record<string, unknown>
  }
  return kept
}

/** One block's text as this app's records keep it ({@link codexMessageAsKept}). */
export function codexTextAsKept(text: string): string {
  return withTheLinesKept(text, savedMethodsLinesInLead(text))
}
