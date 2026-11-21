/**
 * What each provider can actually do, declared by the backend and never inferred in the UI.
 *
 * The renderer must not branch on which provider a session runs. It asks what the session
 * supports and renders that; a `provider === 'claude'` check means a new entry belongs here.
 * `apps/desktop/test/provider-neutrality.test.ts` fails on a provider literal in the renderer other
 * than the picker or the default.
 *
 * Capabilities are not booleans. `unwired` (the provider has it, we have not built it) and `absent`
 * (the provider does not have it, with a written `checkedAgainst`) are different facts, and
 * "available" can still differ per provider (Claude reports a token estimate for thinking, Codex a
 * written summary). Every entry cites what it was measured from; a capability nobody measured is
 * left out rather than defaulted.
 */

/** How far along a capability is. `unwired` and `absent` look the same to a user but are opposite facts to a developer. */
export type CapabilityState =
  /** We offer it, and it works. */
  | 'available'
  /** The provider has it; **we have not built it**. A lead, not a limit. */
  | 'unwired'
  /** The provider genuinely does not have it, at the version we are pinned to. */
  | 'absent'

export type ConnectionAuthMethod = 'sign-in' | 'api-key'
export type ConnectionCredentialSource = 'provider-sign-in' | 'provider-api-key'

/** Static connection choices; native protocols belong to each adapter's implementation. */
export interface ProviderConnectionCapabilities {
  readonly contractVersion: 1
  readonly authMethods: readonly ConnectionAuthMethod[]
  readonly additionalConnections: false
}

/**
 * One capability's standing with one provider. A discriminated union so an unavailable capability
 * cannot be declared without a reason a user could read; the `reason` is the string the UI shows.
 */
export type CapabilityStatus =
  | {
      readonly state: 'available'
      /** What it gives you, when "yes" is not the whole answer. */
      readonly note?: string
    }
  | { readonly state: 'unwired'; readonly reason: string }
  | {
      readonly state: 'absent'
      readonly reason: string
      /**
      /**
       * Where you looked: the vendored type, SDK declaration or capture. If you cannot name one, the
       * honest state is {@link CapabilityState.unwired}, which claims nothing about the provider.
       */
      readonly checkedAgainst: string
    }

/** Whether the app may offer this today. The one question every surface actually asks. */
export function isAvailable(status: CapabilityStatus): boolean {
  return status.state === 'available'
}

/** Presentation artwork sent with a provider's other declared facts. */
export type ProviderMarkKind = 'letter' | 'blossom'

/**
 * Everything the app asks a provider about. A capability earns a place by being measured and having
 * a consumer; things we know exist but do not consume are left out.
 */
export interface ProviderCapabilities {
  /** The provider's mark is presentation data, never a renderer inference from its name. */
  readonly mark: { readonly state: 'available'; readonly kind: ProviderMarkKind }
  /**
   * Plan mode: the agent proposes what it intends to do before acting.
   *
   * Whether it is a safety gate differs per provider, so no shared claim is made about it; each
   * adapter's {@link CapabilityStatus.note} says what its own plan mode does.
   */
  readonly planMode: CapabilityStatus
  /**
   * Thinking: the model's reasoning, surfaced as it works. `text` absent with `redacted: true`
   * (`thinkingEventSchema` in `events.ts`) means "it thought and we cannot show what", which is not
   * the same as "it did not think".
   */
  readonly thinking: CapabilityStatus
  /** Sub-agents: the agent dispatching work to other agents, reported as it happens. */
  readonly subAgents: CapabilityStatus
  /**
   * Asking for a compaction. It is lossy and irreversible, so the control that uses it also asks a
   * confirm (`compaction-offer.ts`); this field is one of the two things its gate checks, the
   * other being the conversation's own send facts. Claude compacts on the person's `/compact`, sent
   * to the CLI as typed and taking instructions; Codex on `thread/compact/start` and takes none.
   */
  readonly requestCompaction: CapabilityStatus
  /**
   * Rewind: putting the user's files back the way they were. It writes to the working tree and
   * cannot be undone, so it needs a confirm, a defined scope (one file, the turn, the conversation)
   * and a rule for edits made by hand since. Neither provider is wired; the SDK does declare it, so
   * this is `unwired` rather than `absent`.
   */
  readonly rewind: CapabilityStatus
  /**
   * Signing in inside this profile home rather than borrowing a copy of the machine's login. Codex
   * has a sign-in verb; Claude keeps no credential in the home and re-reads the machine Keychain on
   * every launch, so it has nothing to sign in to. Ask this per provider rather than assuming a
   * sign-in button works for every adapter.
   */
  readonly signIn: CapabilityStatus
  /** An expired login is renewed by one short message when a conversation starts. */
  readonly loginRenewalMessage: CapabilityStatus
  /**
   * Re-copying the machine credential into this profile, the fast remedy beside
   * {@link ProviderCapabilities.signIn}. Separate from it because a provider can have one without
   * the other: Claude keeps no credential in the home to copy into, so offering the button there
   * would only fail.
   */
  readonly reprovisionAuth: CapabilityStatus
  /**
   * What a profile's folder holds of your sign-in before anybody presses anything. Codex copies the
   * machine's `auth.json` into the folder once; Claude writes nothing and injects the Keychain token
   * into the child's environment per launch. Not derivable from {@link reprovisionAuth}: that is a
   * button the person presses, this is something the app already did. `absent` here is a claim about
   * what the app writes, so its `checkedAgainst` names the writer; `credential-disclosure.test.ts`
   * keeps it honest.
   */
  readonly homeCredential: CapabilityStatus
  /**
   * The provider's own maximum-effort orchestration mode. Claude's `ultracode` is a boolean setting
   * beside `effortLevel`; Codex's `ultra` is a value inside `supportedReasoningEfforts`, reaching the
   * app as {@link ModelChoice.efforts}. They stay separate axes. `available` is a claim about the
   * provider, not the session: whether workflows are enabled for the login is not observable before
   * a turn, so the control's own copy carries that.
   */
  readonly ultracode: CapabilityStatus
  /**
   * The commands the agent itself has, which the command palette lists beside the app's own. Both
   * providers answer but differently (Claude slash commands mixed with skills, Codex `$name` skills
   * only), so the `note` carries the difference. Not `absent` for Codex: the palette can still list
   * what that agent answers to.
   */
  readonly agentCommands: CapabilityStatus
  /**
   * Whether the person can send input to a running provider child from the sub-agent viewer. Both
   * providers let the viewer follow a live child; only the direction back differs.
   */
  readonly childInput: CapabilityStatus
  /**
   * Whether a foreground command's output can be watched while it runs. Codex streams stdout keyed
   * by the card's id; Claude delivers it only when the command finishes. The card of a running
   * command shows the tail where there is one and this reason where there is not.
   */
  readonly commandOutput: CapabilityStatus
  /**
   * Watching a background command while it runs, split from {@link commandOutput} because the
   * answers differ. Claude can read the end of a background task's output but BroCrew does not ask
   * for it, so it is `unwired` there; the card says an `absent` reason where there is no tail.
   */
  readonly backgroundCommandOutput: CapabilityStatus
  /**
   * What the yolo end of the approvals control does on this provider. Both are `available` and the
   * note is the entry, because the same `auto` value buys different things:
   *
   *  - Codex: `APPROVAL_PROFILES` in `codex/runtime-parts/request-params.ts` maps `ask` to `workspace-write` and
   *    `auto` to `danger-full-access`. The sandbox narrows writes and network, not all reads, so do
   *    not promise full containment.
   *  - Claude: no app-supplied sandbox in either mode. `permissionModeFor` requests `default`;
   *    automatic mode yields in `promptGuardHooks` and allows in `handleCanUseTool`.
   *
   * The note says nothing about `ask`, so a surface showing it only discloses the yolo half.
   */
  readonly approvals: CapabilityStatus
  /**
   * Whether an external MCP server a person registered can be granted to an identity on this
   * provider. Read by `RuntimeHost.externalMcpContext` (whether a launch is handed anything),
   * `CapabilitiesSheet` and the Tools register, none of which spell a provider name. Both providers
   * are `available`.
   */
  readonly externalMcpServers: CapabilityStatus
  /**
   * Telling the provider who wrote a turn ({@link SessionHandle.send}'s `origin`, see
   * `TurnProvenance`). Claude has a field for it, but a `peer` stamp changes nothing the model is
   * handed (`claude-origin-wire-probe.smoke.ts` compares the request with and without); the `human`
   * arm is the one the `ultracode` keyword reads, so the note says which half does something. Codex
   * is `absent`: its adapter declares no such parameter, so the stamp is dropped before `turn/start`.
   */
  readonly turnProvenance: CapabilityStatus
  /**
   * Background work wakes the conversation when it ends: a backgrounded command finishing or a
   * scheduled wake-up firing runs the model again with nobody sending a message. Where the provider
   * does not wake the model, a turn that ends over pending background work stalls.
   */
  readonly backgroundWake: CapabilityStatus
}
