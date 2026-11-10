import type { TranscriptEvent } from '../../shared/conversation-events'

import type { ImportedTranscript as PortableTranscript, ImportedEntry as PortableEntry } from '@brobot2/runtime/provider-module'
import type { DesktopProviderValues } from '../providers/desktop-values'

export type ImportedEntry = PortableEntry<DesktopProviderValues>
export type ImportedTranscript = PortableTranscript<DesktopProviderValues>

/** Whether an imported entry is CONVERSATION, as opposed to the file's own bookkeeping. */
export function isConversation(event: TranscriptEvent): boolean {
  return (
    event.type === 'user_turn' ||
    event.type === 'assistant_message' ||
    event.type === 'assistant_delta' ||
    event.type === 'tool_call' ||
    event.type === 'tool_result' ||
    // A picture the model made is the most literal thing a turn can produce (065). It is here so
    // this list and the store's `CONTENT_EVENTS` — which added `image` in 067 for the same reason —
    // cannot disagree about whether a generated image counts as something happening. Neither is
    // exhaustiveness-checked, so the only thing keeping them in step is saying so.
    event.type === 'image'
  )
}

/**
 * The same 200-character cap every tool summary already uses. Exported so the Codex importer bounds
 * a provider string the same way rather than growing a fourth copy of two lines (065).
 */
export function truncate(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * Turn one generated image's own claim into a path this app is willing to serve, or null (065).
 *
 * ⚠️ **Injected rather than done here, because this module parses lines and touches no file.**
 * `saved_path` arrives from a process running model-authored code, and 067 established that such a
 * path is *input*: it may only propose a file, and the proposal is checked — an absolute, regular
 * file of an image type (`726` · R92: no longer one inside the provider home the session ran in). So
 * a caller that can check supplies the check, and a caller that does not supplies nothing — in which
 * case no image event carries a path at all, which reads as "the picture is not here" and is the
 * truthful answer.
 *
 * Passing the provider's string straight through would be the other choice, and it is the wrong one:
 * `image.path` means *"resolved and checked by whoever emitted this"* everywhere else in the app,
 * and one importer quietly writing an unchecked absolute path into that field would make the
 * guarantee false without making anything fail.
 */
export type { ResolveImagePath } from '@brobot2/runtime/provider-module'
