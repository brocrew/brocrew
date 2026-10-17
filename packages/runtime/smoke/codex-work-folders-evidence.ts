/**
 * ⚑ **W4.189 · what `codex-work-folders-probe.smoke.ts` reads off the wire and the model-bound
 * requests, as pure functions** — so the rig only COLLECTS, and a cheap gate can hold these to
 * planted frames (`pin-a-live-only-instrument-from-a-cheap-gate`).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The `writableRoots` of a tagged `workspaceWrite` sandbox policy, or null for anything else. */
export function writableRootsOf(sandbox: unknown): readonly string[] | null {
  if (!isRecord(sandbox) || sandbox['type'] !== 'workspaceWrite') return null
  const roots = sandbox['writableRoots']
  if (!Array.isArray(roots)) return null
  return roots.filter((root): root is string => typeof root === 'string')
}

/** The `input` items of a Responses request body. */
export function inputOf(body: unknown): readonly unknown[] {
  return isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
}

/** The text of a message item, its parts joined; empty for anything that is not a message. */
export function messageText(item: unknown): string {
  if (!isRecord(item) || !Array.isArray(item['content'])) return ''
  return item['content']
    .map((part: unknown) =>
      isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
    )
    .join('\n')
}

/**
 * ⚑ The newest turn marker a USER message names — searched from the end, because Codex can put its
 * own context items (a settings update, an environment block) beside the person's message.
 */
export function newestMarker(body: unknown, pattern: RegExp): string | undefined {
  const input = inputOf(body)
  for (let at = input.length - 1; at >= 0; at -= 1) {
    const item = input[at]
    if (!isRecord(item) || item['role'] !== 'user') continue
    const found = pattern.exec(messageText(item))?.[1]
    if (found !== undefined) return found
  }
  return undefined
}

/** The type of the last input item — `custom_tool_call_output` when Codex is answering a call. */
export function lastInputType(body: unknown): string {
  const input = inputOf(body)
  const last = input[input.length - 1]
  return isRecord(last) && typeof last['type'] === 'string' ? last['type'] : '(none)'
}

/** Every `custom_tool_call_output` in a request, by its call id — what a scripted call returned. */
export function toolOutputsOf(body: unknown): Record<string, string> {
  const outputs: Record<string, string> = {}
  for (const item of inputOf(body)) {
    if (!isRecord(item) || item['type'] !== 'custom_tool_call_output') continue
    const output = item['output']
    const text =
      typeof output === 'string'
        ? output
        : Array.isArray(output)
          ? output
              .map((part: unknown) =>
                isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
              )
              .join('\n')
          : JSON.stringify(output)
    outputs[String(item['call_id'])] = text
  }
  return outputs
}

/** A message the provider ADDED to the model's input since the request before it. */
export interface ToldItem {
  readonly role: string
  readonly text: string
}

/**
 * ⚑ **What Codex added to the model's context between two requests** — the message items of
 * `body` (any role: developer, user, system) that `before` did not carry, compared as whole items.
 * ⚠️ Codex sends the whole history every request, so an item that is new here is one it added for
 * this request: the person's message, and any context update riding beside it. Tool calls and
 * their outputs are not messages and are left out.
 */
export function addedMessages(before: unknown, body: unknown): ToldItem[] {
  const seen = new Map<string, number>()
  for (const item of inputOf(before)) {
    const key = JSON.stringify(item)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const added: ToldItem[] = []
  for (const item of inputOf(body)) {
    const key = JSON.stringify(item)
    const left = seen.get(key) ?? 0
    if (left > 0) {
      seen.set(key, left - 1)
      continue
    }
    if (!isRecord(item) || item['type'] !== 'message' || typeof item['role'] !== 'string') continue
    added.push({ role: item['role'], text: messageText(item) })
  }
  return added
}

/** The tags Codex tells its model about roots and permissions in — what the probe searches for. */
export const ROOT_TAGS = [
  '<environment_context>',
  '<workspace_roots>',
  '<writable_roots>',
  '<permission_profile>',
  '<permissions instructions>',
  '<sandbox_mode>',
] as const

/** Which of {@link ROOT_TAGS} a text carries, and whether it names `folder`. */
export function rootMentions(
  text: string,
  folder: string,
): { readonly tags: readonly string[]; readonly namesFolder: boolean } {
  return { tags: ROOT_TAGS.filter((tag) => text.includes(tag)), namesFolder: text.includes(folder) }
}

/** Every place `needle` appears in `text`, each with `radius` characters either side. */
export function excerptsAround(text: string, needle: string, radius = 240): string[] {
  const found: string[] = []
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    found.push(text.slice(Math.max(0, at - radius), at + needle.length + radius))
  }
  return found
}
