import {
  legacyStartRefusalWords as A_START_ITS_SIGN_IN_REFUSED,
  providerAuthPolicies,
} from '../../providers/index'
import {
  AuthUnavailableError,
  ResumeError,
  folderAPersonMustFixOf,
  spawnNoWaitClearsOf,
  startFailureOf,
  startRefusalOf,
  transientSetupFailureOf,
} from '@brobot2/runtime'
import { type Provider, SUPPORTED_PROVIDERS, providerDescriptor } from '@brobot2/shared'
import { type ToolRefusal, type ToolRefusalPayload, refuseTool } from './refusals'
import { unavailableOf } from '../session-unavailable'

export function aLaunchThatDidNotStart(error: unknown): {
  readonly rail:
    | 'agent-did-not-start'
    | 'agent-took-too-long-to-start'
    | 'agent-could-not-start-just-now'
    | 'agent-could-not-be-started'
  readonly because: string
  /**
   * **716** · for `agent-could-not-be-started`: what a person must fix — the program, or a folder.
   * **D-039 · R2** — or what its provider refused (`provider-refused`). For `agent-did-not-start`:
   * its sign-in, or its Codex settings, which a person fixes.
   */
  readonly what?:
    'program' | 'folder' | 'provider-refused' | 'sign-in' | 'no-sign-in-to-copy' | 'settings'
  /**
   * **D-039 · R2** · for `provider-refused`: the provider's own reason (`StartRefused.said`),
   * absent when it gave none.
   */
  readonly providerSaid?: string
  /** For `sign-in` and `settings`: whose. */
  readonly provider?: Provider
} | null {
  if (error instanceof AuthUnavailableError) {
    const native = providerAuthPolicies[error.provider]?.launchRefusal(error)
    // A computer with no Codex sign-in for a profile to copy is said apart: there is none to renew.
    if (native === 'no-copy') {
      return {
        rail: 'agent-did-not-start',
        because: 'this-computer-has-no-sign-in-to-copy',
        what: 'no-sign-in-to-copy',
        provider: error.provider,
      }
    }
    const settings = native === 'profile'
    return {
      rail: 'agent-did-not-start',
      because: settings ? 'its-provider-settings-are-unusable' : 'its-sign-in-is-unusable',
      what: settings ? 'settings' : 'sign-in',
      provider: error.provider,
    }
  }
  // **D-039 · R2 — the provider ANSWERED the start, and refused it** (F055: Codex refused
  // `thread/start`, and this was a broken tool — *"give_work failed: {"code":-32600,…}"*). By TYPE,
  // anywhere on the chain (`startRefusalOf`): the person's refusal the host throws carries it as its
  // cause. R51's permanent word — the same start is refused the same way until a person changes
  // what was refused — with its own sentence ({@link A_PROVIDER_REFUSED_THE_START}).
  const refused = startRefusalOf(error)
  if (refused !== null) {
    return {
      rail: 'agent-could-not-be-started',
      because: 'its-provider-refused-it',
      what: 'provider-refused',
      ...(refused.said === null ? {} : { providerSaid: refused.said }),
    }
  }
  // **D-039 · R2 — …or its start failed otherwise** (`StartFailed`: the provider's process ended
  // before it answered, or its answer failed a check the adapter makes) — until D-039 a broken tool,
  // *"give_work failed: codex app-server exited (stderr tail: …)"*. `agent-did-not-start`, whose
  // sentence sends a person to the detail: a fixed reason, and the diagnostic to the log.
  if (startFailureOf(error) !== null) {
    return { rail: 'agent-did-not-start', because: 'its-provider-could-not-be-started' }
  }
  // **716 · R67 — one word for a missing program, on both providers.** A `CodexUnavailableError`
  // is a binary that is missing, not executable, or not bundled for this platform (review of
  // `657`); a `ClaudeUnavailableError` is the program the SDK looks for, not where it looks (R66).
  // By TYPE: the Claude adapter asks where the SDK looks, never what the SDK said.
  if (
    SUPPORTED_PROVIDERS.some(
      (provider) => providerAuthPolicies[provider].launchRefusal(error) === 'program',
    )
  ) {
    return {
      rail: 'agent-could-not-be-started',
      because: 'provider-binary-unavailable',
      what: 'program',
    }
  }
  const reason =
    unavailableOf(error) ??
    (error instanceof Error ? unavailableOf((error as { cause?: unknown }).cause) : null)
  if (reason === 'took-too-long') return { rail: 'agent-took-too-long-to-start', because: reason }
  // **D-042 · F2 — nothing names a model, or a named model's effort** (its provider's list could
  // not be read, or names no default): a person looks, or names one, so the same permanent word.
  if (
    reason === 'cancelled' ||
    reason === 'lost-its-place' ||
    reason === 'shutting-down' ||
    reason === 'nothing-names-a-model'
  ) {
    return { rail: 'agent-did-not-start', because: reason }
  }
  // **707 · R39, extended — a shortage the machine gets back by itself**, read off the errno's
  // CODE on the error and its cause chain (`transientSetupFailureOf`) — the closed reason is that
  // code, never the provider's text. **After the classes and reasons**, so it takes only what they
  // did not: an error a word already names keeps it, and a code a person has to fix is one of the
  // two arms below — a spawn's (`710`, R51) or a folder's (`716`, R66); anything else is `null`, and
  // still propagates.
  const shortage = transientSetupFailureOf(error)
  if (shortage !== null) return { rail: 'agent-could-not-start-just-now', because: shortage }
  // **710 · R51 — a spawn no wait clears is its own PERMANENT word**, read the same way: the
  // NEAREST code on the chain, and the closed reason is that code. The two readers cannot both
  // answer one error — one takes only a code a wait clears, the other only a code it does not.
  const cannotRun = spawnNoWaitClearsOf(error)
  if (cannotRun !== null) {
    return { rail: 'agent-could-not-be-started', because: cannotRun, what: 'program' }
  }
  // **716 · R66 — a folder the disk refused is the same permanent word**, read the same way: the
  // NEAREST code, and only when that link was not a spawn — so the two readers above and this one
  // cannot answer one error twice. The closed reason is the code; the path goes to the log.
  const folder = folderAPersonMustFixOf(error)
  if (folder !== null) {
    return { rail: 'agent-could-not-be-started', because: folder.code, what: 'folder' }
  }
  return null
}

export function aWakeThatDidNotHappen(error: unknown): {
  readonly rail: ToolRefusal
  readonly because: string
  /**
   * **716** · as {@link aLaunchThatDidNotStart}'s: what a person must fix, when one must — and
   * since `724` a folder that is GONE (`717` F-2), which a wake alone can meet. **D-039 · R2** —
   * or what its provider refused.
   */
  readonly what?:
    | 'program'
    | 'folder'
    | 'gone-folder'
    | 'provider-refused'
    | 'sign-in'
    | 'no-sign-in-to-copy'
    | 'settings'
  /** **D-039 · R2** · as {@link aLaunchThatDidNotStart}'s. */
  readonly providerSaid?: string
  /** As {@link aLaunchThatDidNotStart}'s. */
  readonly provider?: Provider
} | null {
  // **705 · R39 — a shortage the machine gets back by itself is its own word**, read off the
  // errno's CODE on the cause chain — the closed reason is that code, never the provider's text.
  // First, because the launch's classifier this falls through to names a shortage too
  // (`agent-could-not-start-just-now`, `707`), and a wake must answer in a wake's words — whatever
  // carries the code. **710 · and since `710` it is never a bare `ResumeError` here**: a reopen's
  // shortage reaches this classifier as the host's person-read refusal — a plain `Error`, then
  // `SessionUnavailable('machine-ran-short')`, then the adapter's `ResumeError`, then the errno
  // (`RuntimeHost.aShortageAsARefusal`) — so the `ResumeError` arm below no longer sees it, and
  // without this arm it would reach the SPAWN's word.
  const shortage = transientSetupFailureOf(error)
  if (shortage !== null) {
    return { rail: 'that-conversation-could-not-be-woken-just-now', because: shortage }
  }
  // **D-039 · R2 — the provider ANSWERED the start again, and refused it** — by TYPE, anywhere on
  // the chain: a reopen's `ResumeError` carries it as its cause, and the host's person-read refusal
  // carries that. **Before the `ResumeError` arm**, which would call it a sign-in or a lost
  // conversation; a thread its provider no longer has carries none (D-017 R10 replaces it).
  const refused = startRefusalOf(error)
  if (refused !== null) {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: 'its-provider-refused-it',
      what: 'provider-refused',
      ...(refused.said === null ? {} : { providerSaid: refused.said }),
    }
  }
  // **D-039 · R2 — …or its start failed otherwise** (`StartFailed`): the word and reason the
  // `ResumeError` around it gets below — here because the host's person-read refusal now wraps
  // that `ResumeError`, and the arm below reads only the error it is handed.
  if (startFailureOf(error) !== null) {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: 'the-provider-could-not-resume-it',
    }
  }
  // **The provider's own class, and it carries no closed reason** — `ResumeError`'s message is
  // the provider's words and can name its own ids, so the reason given is the class's.
  if (error instanceof ResumeError) {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: 'the-provider-could-not-resume-it',
    }
  }
  const reason =
    unavailableOf(error) ??
    (error instanceof Error ? unavailableOf((error as { cause?: unknown }).cause) : null)
  if (reason === 'cannot-be-reopened' || reason === 'never-started') {
    return { rail: 'that-conversation-could-not-be-resumed', because: reason }
  }
  // **724 · `717` F-2 — the folder it ran in is gone** (`its-folder-is-gone`), a person's to put
  // back: the wake's permanent word, with the sentence that says so. **Before the launch's
  // classifier below**, which would walk the chain to the spawn's `ENOENT` and say the PROGRAM could
  // not run — false, and worse than the generic word `main` gave.
  if (reason === 'its-folder-is-gone') {
    return { rail: 'that-conversation-could-not-be-resumed', because: reason, what: 'gone-folder' }
  }
  if (reason === 'not-confirmed-stopped' || reason === 'still-closing') {
    return { rail: 'that-conversation-is-still-stopping', because: reason }
  }
  // **Two wakes of one conversation in one turn**: the second finds the first's reservation — the
  // word `message_agent` gives a launch in flight, shared on purpose (650).
  if (reason === 'still-opening')
    return { rail: 'that-conversation-has-not-started', because: reason }
  // **710 · R51 — the launch's permanent spawn word is not a wake's**: both adapters wrap a
  // resume's spawn errno in a `ResumeError`, which the arm above answers in this door's own permanent
  // word (`a-shortage-that-clears-by-itself.test.ts` §2b).
  //
  // **716 · R66/R67 — and what a person must fix reaches a wake too**, outside any `ResumeError`:
  // a missing program (Codex's, thrown as its runtime is built; Claude's, which its adapter lets
  // out of `resume()`) and a folder the host could not make — so it is answered in the WAKE's
  // permanent word, never the spawn's, with `what` for the sentence that says which.
  const launch = aLaunchThatDidNotStart(error)
  if (launch?.rail === 'agent-could-not-be-started') {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: launch.because,
      ...(launch.what === undefined ? {} : { what: launch.what }),
    }
  }
  return launch
}

/**
 * **716 · R66 — a spawn refused for a FOLDER a person must fix, said as one** — the word's own
 * sentence names a program ({@link TOOL_SENTENCES}), and R66 rules *"the sentence says which it is, a
 * program or a folder, in words"*. The act first, inside the 200-character receipt
 * (`the-act-inside-the-cut`), then what is wrong.
 */
export const A_FOLDER_COULD_NOT_BE_MADE =
  'that agent\u2019s conversation could not be started, so nothing was sent. Starting it again will not help until a person has looked: BroCrew could not make or write a folder it needs \u2014 the disk refused it, is read-only or full, or a file is in the way. The detail names the error.'

/**
 * **716 · R66 — a wake refused for the PROGRAM, said as one** — the wake's permanent word names
 * three causes (`that-conversation-could-not-be-resumed`); this one knows which.
 */
export const A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: this machine could not run its provider\u2019s program \u2014 it may be missing or not runnable. The detail names the error.'

/**
 * **724 · `717` F-2 — a wake refused because the folder it ran in is GONE, said as one.** No
 * path: the host's own text, which names it, goes to the log (`657`), and a person's Reopen says it.
 */
export const A_WAKE_WHOSE_FOLDER_IS_GONE =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: the folder it ran in is no longer there, and a person has to put it back.'

/**
 * **D-039 · R2 — a give whose new conversation its PROVIDER refused to start, said as one** — the
 * word's own sentence names a program (F055). The act first, inside the 200-character receipt
 * (`the-act-inside-the-cut`), then what failed, then what the giver can do meanwhile.
 *
 * **The provider's words are in the detail (`providerSaid`) and never in a sentence an agent
 * reads**: they are the provider's, and only a UUID is cut from them (`StartRefused.said`) — a path
 * in its home or a file it quotes stays, and a sentence an agent reads names neither. True with
 * or without them: the detail carries `providerSaid` only when the provider gave a reason.
 */
export const A_PROVIDER_REFUSED_THE_START =
  'that agent\u2019s conversation could not be started, so nothing was given. Giving it again will not help until a person has looked: its provider refused to start it, and the detail gives its reason when it gave one. Meanwhile, give the work to another agent or do it yourself.'

/**
 * **D-039 · R2 — a wake its PROVIDER refused, said as one** — the wake's permanent word names
 * three causes (`that-conversation-could-not-be-resumed`); this one knows which. The provider's
 * words as {@link A_PROVIDER_REFUSED_THE_START}'s: in the detail, when it gave any.
 */
export const A_WAKE_ITS_PROVIDER_REFUSED =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: its provider refused to start it, and the detail gives its reason when it gave one. Meanwhile, reach another agent or do it yourself.'

/**
 * **F091 · `interrupt_agent` naming the conversation that calls it** — by its id, a piece it
 * holds, or a conversation it took the place of — said as `message_agent` says it (`that-agent-is-you`).
 * The chain's word, `not-below-you`, was true to the letter and pointed at `message_agent`, which
 * refuses a message to oneself. Its acts, as `message_agent`'s are: its own work is its own to
 * stop — not *"end this turn"*: a background agent of its own calls from no turn — and another
 * agent is named instead.
 */
export const A_CONVERSATION_CANNOT_INTERRUPT_ITSELF =
  'that is this conversation: a conversation cannot interrupt itself, so nothing was interrupted. Stop your own work yourself, or name another agent to interrupt.'

export const A_CONVERSATION_CANNOT_ASK_ITSELF =
  'That is this conversation; it cannot ask itself, so nothing was asked.'

/** **716 · R66 — a wake refused for a FOLDER, said as one.** */
export const A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: BroCrew could not make or write a folder it needs \u2014 the disk refused it, is read-only or full, or a file is in the way. The detail names the error.'

/**
 * How much of a refused start's sentence a row shows: the tool's row keeps 200 characters of
 * `refused (agent-did-not-start): <sentence>`, which leaves the sentence this many.
 */
export const A_REFUSED_ROW_SHOWS = 169

/**
 * A start refused because the agent's sign-in, or its Codex settings, could not be used. What a
 * person does comes first, then that nothing was done and that the same call will not help yet.
 */
export function aStartItsLoginOrSettingsRefused(
  what: 'sign-in' | 'no-sign-in-to-copy' | 'settings',
  provider: Provider,
  door: 'give' | 'wake',
): string {
  const said =
    A_START_ITS_SIGN_IN_REFUSED[
      what === 'no-sign-in-to-copy'
        ? 'no-sign-in-to-copy'
        : what === 'settings'
          ? 'codex-settings'
          : providerDescriptor(provider).words.refusedSignIn
    ]
  const nothing =
    door === 'give'
      ? 'Nothing was given, and giving it again will not help until then.'
      : 'Nothing was sent, and sending again will not help until then.'
  const meanwhile =
    door === 'give'
      ? 'Meanwhile, give the work to another agent or do it yourself.'
      : 'Meanwhile, reach another agent or do it yourself.'
  return [said.lead, nothing, said.more, meanwhile].filter((part) => part !== '').join(' ')
}

/**
 * **D-039 · what a give with `new: true` whose launch failed still did: it MADE the agent.**
 *
 * **The identity is the give's first write, after every rail and before the launch**
 * (`RuntimeHost.giveWork`), and a failed launch does not take it back — so the same give again
 * meets `that-profile-exists`. Said after the word's own sentence, whichever it is: every launch
 * failure `give_work` classifies comes after that write. No name and no id: the giver named it.
 */
export const THE_NEW_AGENT_WAS_MADE =
  'The new agent was made all the same: from now on, give to it without new.'

/**
 * **D-039 · a failed launch's refusal, and what a give with `new: true` still did** — its
 * sentence ({@link theRefusalOfALaunch}), then {@link THE_NEW_AGENT_WAS_MADE} when it made one.
 */
export function aLaunchRefused(
  failed: NonNullable<ReturnType<typeof aLaunchThatDidNotStart>>,
  madeANewAgent: boolean,
  detail: Readonly<Record<string, unknown>>,
): ToolRefusalPayload {
  const said = theRefusalOfALaunch(failed, detail)
  return madeANewAgent ? { ...said, reason: `${said.reason} ${THE_NEW_AGENT_WAS_MADE}` } : said
}

/**
 * **716 · a failed launch's refusal, in the sentence that says what a person must fix** — the two
 * places `give_work` picks it: a folder ({@link A_FOLDER_COULD_NOT_BE_MADE}) and, **D-039 · R2**,
 * a start its provider refused ({@link A_PROVIDER_REFUSED_THE_START}). Every other failure says its
 * word's own sentence.
 */
function theRefusalOfALaunch(
  failed: NonNullable<ReturnType<typeof aLaunchThatDidNotStart>>,
  detail: Readonly<Record<string, unknown>>,
): ToolRefusalPayload {
  // **D-039 · R2 — a provider's refusal carries its words in the detail**, never the envelope,
  // and the key is absent when it gave none.
  if (failed.what === 'provider-refused') {
    return {
      ...refuseTool(
        failed.rail,
        failed.providerSaid === undefined
          ? detail
          : { ...detail, providerSaid: failed.providerSaid },
      ),
      reason: A_PROVIDER_REFUSED_THE_START,
    }
  }
  if (
    (failed.what === 'sign-in' ||
      failed.what === 'no-sign-in-to-copy' ||
      failed.what === 'settings') &&
    failed.provider !== undefined
  ) {
    return {
      ...refuseTool(failed.rail, { ...detail, provider: failed.provider }),
      reason: aStartItsLoginOrSettingsRefused(failed.what, failed.provider, 'give'),
    }
  }
  const refused = refuseTool(failed.rail, detail)
  return failed.what === 'folder' ? { ...refused, reason: A_FOLDER_COULD_NOT_BE_MADE } : refused
}

/**
 * **716 · a start's refusal, in the sentence that says what a person must fix** — the start a
 * delivery makes of a conversation that was not running (`message_agent`) builds it here.
 */
export function aWakeRefused(
  unwoken: NonNullable<ReturnType<typeof aWakeThatDidNotHappen>>,
  agent: string,
): ToolRefusalPayload {
  // **D-039 · R2 — a provider's refusal carries its words in the detail**, never the envelope,
  // and the key is absent when it gave none.
  if (unwoken.what === 'provider-refused') {
    const { because, providerSaid } = unwoken
    const detail =
      providerSaid === undefined ? { agent, because } : { agent, because, providerSaid }
    return {
      ...refuseTool(unwoken.rail, detail),
      reason: A_WAKE_ITS_PROVIDER_REFUSED,
    }
  }
  if (
    (unwoken.what === 'sign-in' ||
      unwoken.what === 'no-sign-in-to-copy' ||
      unwoken.what === 'settings') &&
    unwoken.provider !== undefined
  ) {
    return {
      ...refuseTool(unwoken.rail, {
        agent,
        because: unwoken.because,
        provider: unwoken.provider,
      }),
      reason: aStartItsLoginOrSettingsRefused(unwoken.what, unwoken.provider, 'wake'),
    }
  }
  const refused = refuseTool(unwoken.rail, { agent, because: unwoken.because })
  if (unwoken.what === 'program') return { ...refused, reason: A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN }
  if (unwoken.what === 'folder')
    return { ...refused, reason: A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE }
  if (unwoken.what === 'gone-folder') return { ...refused, reason: A_WAKE_WHOSE_FOLDER_IS_GONE }
  return refused
}
