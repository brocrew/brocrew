export const REQUEST_MARKER = '## My request for Codex:'

/** The tail the CLI appends to a preamble it sends without a request. */
export const ENVIRONMENT_CLOSE = '</environment_context>'

/**
 * A message that is one wrapped element, whole (`<skill>…</skill>`, `<heartbeat>…</heartbeat>`).
 * Structural rather than a list of tags, so it also catches wrappers Codex has not invented yet:
 * anything that wraps a whole message is something a harness put there.
 */
const WHOLLY_WRAPPED = /^\s*<([a-zA-Z][a-zA-Z0-9_-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>\s*$/

/**
 * The one wrapper a person writes and must never be swallowed: `<image name=[Image #1] path="…"></image>`
 * is somebody attaching a picture with nothing else to say, and treating it as harness chatter
 * would delete their only message. An exemption rather than an allow-list, so a new harness wrapper
 * is caught by default.
 */
const PERSON_AUTHORED_TAGS = new Set(['image'])

/** The CLI's own instruction preamble, which it sometimes sends without an `<environment_context>` tail, so rule 3 alone does not cover it. */
const AGENTS_HEADING = '# AGENTS.md instructions'

/**
 * Who wrote each block, as Codex itself records it: `internal_chat_message_metadata_passthrough`
 * `.content_item_kinds` on nearly every message. `user.*` is what the person sent; anything else
 * (`agents_md.instructions`, `environments.environment_context`, `generic.turn_aborted`) is the
 * harness. When present it decides, so a person's own `<note>…</note>` stays theirs; files without
 * it keep the text rules.
 */
const isTyped = (kind: unknown): boolean => typeof kind === 'string' && kind.startsWith('user.')

function recordedKinds(metadata: unknown): readonly unknown[] | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const kinds = (metadata as Record<string, unknown>)['content_item_kinds']
  return Array.isArray(kinds) && kinds.length > 0 ? kinds : null
}

/** What one `message` line really contains. */
export interface CodexMessageParts {
  /** True when any part of this line was put there by the harness rather than typed. */
  injected: boolean
  /**
   * What the person said, or `null` when they said nothing in this line. Never the empty string: an
   * empty request is the same as no request.
   */
  said: string | null
}

/**
 * Split one Codex `message` into what the harness supplied and what the person typed.
 *
 * `role` is passed as the raw value off the line — `unknown`, because the file is input and a role
 * this build has never heard of must land in rule 1 rather than in a `default` that means "user".
 * `metadata` is the line's raw `internal_chat_message_metadata_passthrough`.
 */
export function splitCodexMessage(
  role: unknown,
  text: string,
  metadata?: unknown,
): CodexMessageParts {
  // 1. Not the user's role at all: `developer` today, whatever Codex adds next tomorrow.
  if (role !== 'user') return { injected: true, said: null }

  // 2. The CLI's own separator: everything above it is ambient, everything below it is the ask.
  const marker = text.indexOf(REQUEST_MARKER)
  if (marker !== -1) {
    const said = text.slice(marker + REQUEST_MARKER.length).trim()
    // `injected` is what is above the marker, not the marker's presence: a message of only the
    // separator and the prompt has no preamble to keep.
    return { injected: text.slice(0, marker).trim() !== '', said: said === '' ? null : said }
  }

  // Codex's own record of who wrote it — see {@link isTyped}. A mix (never seen) falls to the rules.
  const kinds = recordedKinds(metadata)
  if (kinds?.every(isTyped)) return { injected: false, said: text }
  if (kinds?.every((kind) => !isTyped(kind))) return { injected: true, said: null }

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
