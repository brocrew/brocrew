import type { Provider } from '@brobot2/shared'

/**
 * 🔴 **W4.164 · F093 R3 — what each bundled provider puts in front of its model on its own**: its
 * system prompt, the fixed parts of its context, and its built-in tools — captured from the
 * provider's own model-bound request, per bundled version and per model, by
 * `pnpm run snapshots:providers` (`apps/desktop/smoke/provider-snapshots.smoke.ts`).
 *
 * ⚑ **The provider's parts only.** What BroBot adds — its instructions, its tools, the lines around
 * each message — is BroBot's to show, and is cut out of every part here; where it sat inside one of
 * the provider's own texts, a placeholder says so. ⚑ **What changes from one conversation to the
 * next** — a folder, today's date, the model's name, the agent's memory — is a placeholder too,
 * written `⟨like this⟩`.
 */

/** Where a part sits in the request the provider sends its model. */
export type SnapshotPlace =
  /** Claude: the system prompt, sent with every request. */
  | 'system-prompt'
  /** Claude: the model-visible tools; Codex: the request's tools, or Codex's tool declarations. */
  | 'tools'
  /** Claude: a reminder at the head of the first message. */
  | 'first-message'
  /** Claude: the context message Claude Code sends after the first message. */
  | 'context-message'
  /** Codex: the request's own instructions. */
  | 'instructions'
  /** Codex: one of its developer messages. */
  | 'developer-message'
  /** Codex: a user message it writes itself (its environment, the wrapper around AGENTS files). */
  | 'user-message'

/** One tool, as the provider declared it to its model. */
export interface SnapshotTool {
  readonly name: string
  /** Its declaration as sent: JSON for a tool, or the text Codex writes for one. */
  readonly text: string
  readonly chars: number
}

/** One part of what the provider puts in front of its model on its own. */
export interface SnapshotPart {
  /** Stable across versions where the part is the same kind: `claude.prompt`, `codex.tools`… */
  readonly id: string
  readonly title: string
  readonly where: SnapshotPlace
  /**
   * When it is sent: with every request; with the first message, then in the history every
   * request re-sends; or only once the model asks for it (a deferred tool, loaded by its name).
   */
  readonly when: 'every-request' | 'first-message' | 'when-loaded'
  /** As the model got it, with BroBot's parts and this conversation's facts as placeholders. */
  readonly text: string
  /**
   * Characters, words, and tokens estimated as characters ÷ 4 — the F093 map's measures. ⚠️ A
   * character is one Unicode code point ({@link sizeOf}), so `🤖` counts one where `String.length`
   * counts two.
   */
  readonly chars: number
  readonly words: number
  readonly approxTokens: number
  /** For the tools: each one. */
  readonly tools?: readonly SnapshotTool[]
  /**
   * 🔴 **W4.186 · what of this part differs from one conversation to another**, in plain words —
   * by the agent's own setup (its servers, its skills, its sub-agent types) or by the account it
   * runs on (the features it has). ⚑ The snapshot was captured with none of those, so for such a
   * part it is what Claude Code sends with nothing added, never this agent's exact list. ⚠️ Said
   * on the parts found to differ; a part without it may still differ in ways not found.
   */
  readonly varies?: string
}

/** What one bundled provider version put in front of one model. */
export interface ProviderSnapshot {
  readonly provider: Provider
  /** The bundled version: Claude Code's (`2.1.287`), or Codex's (`0.160.0`). */
  readonly version: string
  /** `as of Claude Code 2.1.287` — what a window says it is. */
  readonly label: string
  /** The model it was captured with. */
  readonly model: string
  /**
   * The shape of the provider's request for this model. Claude: `messages`. Codex decides by
   * model: `functions` (tools as functions, its prompt as the request's instructions) or `exec`
   * (every tool declared as code inside one `exec` tool, its prompt as a developer message).
   */
  readonly shape: 'messages' | 'functions' | 'exec'
  /** What the capture could not show, in plain words. */
  readonly notes: readonly string[]
  readonly parts: readonly SnapshotPart[]
  /** The parts together, but for those sent only once the model asks for them (`when-loaded`). */
  readonly chars: number
  readonly words: number
  readonly approxTokens: number
}

/** The answer: the snapshot, or why there is none. */
export type SnapshotAnswer =
  | { readonly found: true; readonly snapshot: ProviderSnapshot }
  | {
      readonly found: false
      /** In plain words: this model was not captured for this version. */
      readonly why: string
      /** The models that were. */
      readonly models: readonly string[]
    }

/**
 * ⚑ **Whether a model takes a context message, by this build's snapshot of it** — one whose parts
 * include the context message does (`mid_conv_system` in Claude Code's catalogue; Haiku does not).
 * `null`: no snapshot of that model, or none asked.
 */
export function takesAContextMessage(answer: SnapshotAnswer | undefined): boolean | null {
  if (answer === undefined || !answer.found) return null
  return answer.snapshot.parts.some((part) => part.where === 'context-message')
}

/**
 * ⚑ **A snapshot as it is kept in the app** (`main/provider-snapshots/*.json`, written by the probe):
 * its texts once each, by hash, since most are the same from one model to the next; each model's
 * parts name theirs.
 */
export interface ProviderSnapshotFile {
  readonly provider: Provider
  readonly version: string
  readonly label: string
  /** The model the provider runs when none is chosen, as it answered with no sign-in. */
  readonly defaultModel: string | null
  readonly notes: readonly string[]
  readonly models: Readonly<
    Record<
      string,
      {
        readonly shape: ProviderSnapshot['shape']
        /** The other names the same model goes by: the id the provider told its model. */
        readonly alsoCalled: readonly string[]
        readonly parts: readonly KeptPart[]
      }
    >
  >
  readonly texts: Readonly<Record<string, string>>
}

/** A part as kept: its text by hash. */
export interface KeptPart {
  readonly id: string
  readonly title: string
  readonly where: SnapshotPlace
  readonly when: SnapshotPart['when']
  /** Its text's hash; empty for the tools, whose text is their declarations, one per line. */
  readonly text: string
  readonly tools?: readonly { readonly name: string; readonly text: string }[]
  /** {@link SnapshotPart.varies}. */
  readonly varies?: string
}

/** What this build carries for one provider: its version, its default, and each model's shape. */
export interface SnapshotCatalogue {
  readonly provider: Provider
  readonly version: string
  readonly label: string
  readonly defaultModel: string | null
  readonly notes: readonly string[]
  readonly models: readonly {
    readonly model: string
    readonly shape: ProviderSnapshot['shape']
    readonly alsoCalled: readonly string[]
  }[]
}

/** The window's wire: `ipcRenderer.invoke` channels. */
export const PROVIDER_SNAPSHOTS_CHANNELS = {
  list: 'provider-snapshots:list',
  forModel: 'provider-snapshots:for-model',
} as const

/** Characters, words and estimated tokens of a text — the F093 map's three measures. */
export function sizeOf(text: string): { chars: number; words: number; approxTokens: number } {
  const chars = [...text].length
  const words = text.split(/\s+/).filter((word) => word !== '').length
  return { chars, words, approxTokens: Math.round(chars / 4) }
}
