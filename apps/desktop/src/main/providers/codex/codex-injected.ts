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
