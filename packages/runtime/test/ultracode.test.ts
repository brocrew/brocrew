import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { EffortLevel, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { AsyncQueue } from '../src/internal/async-queue'
import {
  ClaudeRuntime,
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  capabilitiesFor,
  type ClaudeQuery,
  type ResumeOptions,
  type StartOptions,
} from '../src/index'

/**
 * **`ultracode` is a setting, not a level** (106).
 *
 * The pinned SDK defines ultracode beside effort, not as another effort level:
 * `Settings.ultracode?: boolean` at `sdk.d.ts:8701`, while `EffortLevel` at `:627` is
 * `'low'|'medium'|'high'|'xhigh'|'max'`. Adding `ultra` to the effort list would send a value
 * rejected by the provider’s type.
 *
 * Everything here is about keeping the two axes apart, and about the three things 106 measured on a
 * real login (`smoke/model-effort-probe.smoke.ts`) that decide how the control may behave:
 *
 *  1. The CLI accepts the setting with **no error and no acknowledgement** — and accepts a key no
 *     `Settings` declares just as quietly. So acceptance is not confirmation, and nothing may report
 *     this as a running state.
 *  2. There is **no readback**: `initializationResult()` carries commands/agents/models/account and
 *     no settings echo, and `SDKSystemMessage.tools` needs a real conversation to arrive.
 *  3. `ModelInfo` **does** narrow effort per model, which is what made the second precondition —
 *     an xhigh-capable model — answerable at all. ⚠️ 0.3.287 replaced it with *"a model that
 *     supports ultracode"*, which `ModelInfo` does not report, so the note discloses it instead.
 */

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  readonly flagSettings: unknown[] = []
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  async applyFlagSettings(settings: {
    effortLevel?: EffortLevel | null
    ultracode?: boolean
  }): Promise<void> {
    this.flagSettings.push(settings)
  }
  close(): void {}
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/** A runtime whose SDK options are captured. `async () => true` is the resume on-disk precheck. */
function capturing(): { runtime: ClaudeRuntime; fq: FakeQuery; options: () => Options } {
  const fq = new FakeQuery()
  let captured: Options | undefined
  const runtime = new ClaudeRuntime(
    (params) => {
      captured = params.options
      return fq
    },
    async () => true,
  )
  return {
    runtime,
    fq,
    options: () => {
      if (!captured) throw new Error('no query was built')
      return captured
    },
  }
}

const START: StartOptions = { cwd: '/tmp/x', providerHome: '/tmp/x/home' }

describe('ultracode is a boolean setting and never a reasoning level (106)', () => {
  it('rides `Options.settings`, and touches `effort` not at all', async () => {
    const { runtime, fq, options } = capturing()
    const handle = await runtime.start({ ...START, ultracode: true })

    // ⚠️ **A MERGE since 166, and 106's own comment predicted the day.** `autoMemoryDirectory` now
    // shares this layer, so the assertion is the whole object rather than the one key: an
    // assignment that overwrote its neighbour would satisfy `toMatchObject({ultracode:true})` and
    // move every ultracode session's memory back to the per-cwd default.
    expect(options().settings, 'the flag-settings layer is where it goes').toEqual({
      ultracode: true,
      autoMemoryDirectory: join(START.providerHome, 'memory'),
    })
    // ⚠️ The pairing that makes the line above mean something. A launch that had smuggled it onto
    // the effort axis would ALSO satisfy an assertion about `settings` if both were written.
    expect(options().effort, 'nothing was asked for on the effort axis').toBeUndefined()

    await handle.close()
    fq.end()
  })

  it('…and the two axes stay independent — an effort AND the mode reach their own fields', async () => {
    const { runtime, fq, options } = capturing()
    const handle = await runtime.start({ ...START, ultracode: true, reasoningEffort: 'low' })

    // `low` is the interesting choice rather than `xhigh`: if the adapter had "helpfully" implied
    // the effort the mode's description names, this is where it would show.
    expect(options().effort).toBe('low')
    expect(options().settings).toEqual({
      ultracode: true,
      autoMemoryDirectory: join(START.providerHome, 'memory'),
    })

    await handle.close()
    fq.end()
  })

  it('an effort change keeps asking for it, since 0.3.287 turns it off otherwise', async () => {
    // ⚑ 0.3.287: *"An `effortLevel` that moves the session to a different level, sent without an
    // `ultracode` key, also turns ultracode off; send both keys to change the level and keep it on."*
    const asked = capturing()
    const kept = await asked.runtime.start({ ...START, ultracode: true })
    await kept.setReasoningEffort('low')
    await kept.send('go')
    expect(asked.fq.flagSettings).toEqual([{ effortLevel: 'low', ultracode: true }])
    await kept.close()
    asked.fq.end()

    // …and a launch that never asked sends the effort alone: nothing is turned on behind its back.
    const plain = capturing()
    const unasked = await plain.runtime.start(START)
    await unasked.setReasoningEffort('low')
    await unasked.send('go')
    expect(plain.fq.flagSettings).toEqual([{ effortLevel: 'low' }])
    await unasked.close()
    plain.fq.end()
  })

  it('not asked for is not `false` — an unasked launch names the key not at all', async () => {
    const { runtime, fq, options } = capturing()
    const handle = await runtime.start(START)

    // `{ultracode:false}` is this app saying something, and there is nothing to say. ⚠️ **What
    // changed at 166 is the surrounding claim, not this one**: the layer is no longer empty, because
    // `autoMemoryDirectory` is written on every launch. So the assertion is about the KEY's absence
    // rather than the object's, which is what "not asked for is not false" actually meant.
    expect(options().settings).toEqual({ autoMemoryDirectory: join(START.providerHome, 'memory') })
    expect('ultracode' in (options().settings as object)).toBe(false)

    await handle.close()
    fq.end()
  })

  it('is refused by name if it arrives as an effort, exactly like Codex’s `ultra`', async () => {
    const { runtime, fq } = capturing()
    const handle = await runtime.start(START)

    // 076's rule, and the reason free text on the effort axis would not have helped: typing the
    // word into the reasoning box produces a refusal, not the mode.
    await expect(handle.setReasoningEffort('ultracode')).rejects.toThrow(/does not offer/)
    await expect(handle.setReasoningEffort('ultracode')).rejects.toThrow(
      /low, medium, high, xhigh, max/,
    )
    expect(handle.settings.reasoningEffort.requested, 'nothing was recorded').toBeUndefined()

    await handle.close()
    fq.end()
  })

  it('a launch that asked for it does NOT also claim it is running', async () => {
    const { runtime, fq } = capturing()
    const handle = await runtime.start({ ...START, ultracode: true })

    // The whole of the honesty argument, in one shape: there is no member on the settings state for
    // it, because the provider never confirms it and `effective` is defined as "what the last turn
    // we sent asked for". `Object.keys` rather than three `toBeUndefined()`s so that ADDING one
    // later fails here, which is the direction that would matter.
    expect(Object.keys(handle.settings).sort()).toEqual(['model', 'planMode', 'reasoningEffort'])

    await handle.close()
    fq.end()
  })
})

describe('ultracode does not survive a resume as a claimed state (106)', () => {
  it('a reopened session carries no settings layer — the mode was for that run', async () => {
    const { runtime, fq, options } = capturing()
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 },
      // Everything a resume legitimately restores, so the negative below is not passing over an
      // empty options object.
      { providerHome: '/tmp/x/home', reasoningEffort: 'high', model: 'opus' },
    )

    expect(options().resume, 'it really is a resume').toBe('sess_x')
    expect(options().effort, 'and it really did restore what it restores').toBe('high')
    expect(options().model).toBe('opus')
    // ⚠️ The one launch setting that is NOT restored. The SDK's own words: "Session-scoped …
    // interactive toggles never persist it."
    //
    // ⛔ **`toBeUndefined()` stopped being able to say that at 166.** The flag layer now always
    // carries the profile's memory directory — which a resume DOES restore, and must, since a
    // reopened conversation is the same developer — so the honest assertion is that `ultracode` is
    // not in it, not that nothing is. A test asserting the object's absence would now fail for the
    // right feature and pass for the wrong reason if `ultracode` were ever added back to `resume`.
    expect(options().settings, 'a reopen keeps the profile’s memory directory').toEqual({
      autoMemoryDirectory: join('/tmp/x/home', 'memory'),
    })
    expect(
      'ultracode' in (options().settings as object),
      'the mode is not re-asked for on a reopen',
    ).toBe(false)

    await handle.close()
    fq.end()
  })

  it('and `ResumeOptions` cannot express it, so no future caller can pass it by accident', () => {
    // ⚠️ **A compile-time assertion wearing a runtime test's clothes**, and the type line is the
    // whole of it — `pnpm run typecheck` fails first if `ultracode` is ever moved onto
    // `ProviderRuntimeContext`, which `ResumeOptions` aliases. The runtime expectation exists so
    // the file reports a failure rather than a silent pass if someone deletes the type.
    type ResumeCannotCarryIt = 'ultracode' extends keyof ResumeOptions ? false : true
    const proof: ResumeCannotCarryIt = true
    expect(proof).toBe(true)
    // …and the paired positive: it IS on the start options, so the negative above is about
    // placement rather than about the field not existing anywhere.
    type StartCanCarryIt = 'ultracode' extends keyof StartOptions ? true : false
    const paired: StartCanCarryIt = true
    expect(paired).toBe(true)
  })
})

describe('Codex’s `ultra` and Claude’s `ultracode` are not the same control (106)', () => {
  it('one provider declares the mode, the other says why it has none', () => {
    expect(CLAUDE_CAPABILITIES.ultracode.state).toBe('available')
    expect(CODEX_CAPABILITIES.ultracode.state).toBe('absent')

    const codex = CODEX_CAPABILITIES.ultracode
    if (codex.state !== 'absent') throw new Error('unreachable: asserted above')
    // The reason has to send the reader to the OTHER axis, because that is where the thing they
    // are looking for actually is — Codex folded proactive multi-agent work into the effort list
    // and deprecated the separate switch it used to have.
    expect(codex.reason).toContain('ultra')
    expect(codex.reason).toContain('reasoning')
    expect(codex.checkedAgainst).toContain('multiAgentMode')
  })

  it('Claude’s note promises a request, never a state', () => {
    const claude = CLAUDE_CAPABILITIES.ultracode
    if (claude.state !== 'available') throw new Error('unreachable: asserted above')
    const note = claude.note ?? ''
    // Three things the note must carry, because all three are things this app cannot check and a
    // user would otherwise have to discover: it is asked for, it is per-run, and Workflows gate it.
    expect(note).toContain('Asks')
    expect(note).toMatch(/that run only|this run only/)
    expect(note).toContain('Workflows')
    // ⚠️ And the one word it must not contain. "on" would be a claim about a state 106 measured to
    // be unobservable — the CLI accepts the setting exactly as quietly as it accepts a key that
    // does not exist.
    expect(note).not.toMatch(/\bis on\b|\bturns on\b/)
  })

  it('every provider must answer — the map is what stops a third one being forgotten', () => {
    // `capabilitiesFor` is `Record<Provider, …>`, so this is really a compile-time guarantee; the
    // runtime half is here because the value crosses IPC and a surface indexes it defensively.
    for (const provider of ['claude', 'codex'] as const) {
      expect(capabilitiesFor(provider).ultracode.state).toBeTruthy()
    }
  })
})

/**
 * Detect the next provider setting added by an SDK pin change.
 *
 * `claude-runtime.ts` already proves at COMPILE TIME that `CLAUDE_EFFORTS` lists every `EffortLevel`
 * — `_ClaudeEffortsAreExhaustive`, added by 076 after `xhigh` and `max` were invisible for two
 * months. That guard is real, it fails `pnpm run typecheck` rather than a test, and it is why
 * criterion 7 was already met before this file existed.
 *
 * ⚠️ **And it could never have caught `ultracode`, because `ultracode` is not on that axis.** It
 * arrived as a new key on `Settings`, a surface nothing was watching. So this is the guard for the
 * axis that actually moved.
 *
 * ⚠️ **It is a RUNTIME scan, and the reason is a finding rather than a preference.** The obvious
 * design — copy `_ClaudeEffortsAreExhaustive` and exclude a checked-in key list from
 * `keyof Settings` — was written first and is **vacuous**: `Settings` ends with
 * `[k: string]: unknown` (`sdk.d.ts:9027`), so `keyof Settings` is `string`, `Exclude` removes
 * nothing, and `satisfies readonly (keyof Settings)[]` accepts any string at all. Both halves of
 * that guard would have passed forever while proving nothing.
 *
 * That index signature is also the type-level twin of what 106 measured on the wire: the SDK
 * declares this object OPEN, which is exactly why the CLI accepted `{brobot2NotARealSetting}` as
 * quietly as it accepted `{ultracode: true}`. A settings key cannot be validated by the type system
 * here, by the SDK's own design — so it is validated by reading the declaration file, the way
 * `check-protocol.mjs` holds us to the Codex protocol.
 */
describe('the guard for the axis that moved — Settings keys (106)', () => {
  const SDK_TYPES = fileURLToPath(
    new URL('../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts', import.meta.url),
  )

  /**
   * The top-level property names of the pinned `Settings`, read out of its declaration.
   *
   * ⚠️ **`\r` is stripped first, and that line is load-bearing.** `sdk.d.ts` ships with CRLF
   * endings, so the terminator test read `'}\r'`, never matched, and the scan ran on past the end
   * of the interface into every other declaration in the file — 202 "keys", including
   * `stop_hook_active` and `worktree_path`. It found a superset, so nothing would have LOOKED
   * broken; it would simply have stopped noticing anything.
   *
   * Verified against `ts.createProgram` + `checker.getPropertiesOfType` on the same file (0.3.218): 138 names,
   * identical set. The compiler is the better instrument and is deliberately not the one used here —
   * a test that boots a TypeScript program to read one interface costs seconds on every run.
   */
  function declaredSettingsKeys(source: string): string[] {
    const lines = source.replace(/\r/g, '').split('\n')
    const start = lines.findIndex((line) => line.startsWith('export declare interface Settings {'))
    if (start < 0)
      throw new Error('no `export declare interface Settings {` in the pinned sdk.d.ts')
    const keys: string[] = []
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i] === '}') break
      // Depth-1 properties only: nested object types are indented further, and doc-comment bodies
      // start with ` * `. Optional and required, quoted and bare, `$schema` included.
      const match = /^ {4}(?:readonly )?(['"]?)([\w$]+)\1\??:/.exec(lines[i] ?? '')
      if (match?.[2]) keys.push(match[2])
    }
    return [...new Set(keys)].sort()
  }

  /**
   * Every setting 0.3.218 declared, as a REVIEW RECORD rather than as documentation — and
   * {@link REVIEWED_AT_0_3_281} holds what the 0.3.281 bump added (680).
   *
   * When an SDK pin adds a settings key, fail with the key’s name so the person updating the
   * pin must decide whether BroBot should expose a control. Adding the key to the census
   * records that review instead of silently missing a new setting.
   *
   * ⚠️ **Whitespace-separated rather than a string array, and not for tidiness.** The first draft was
   * `[...] as const satisfies readonly (keyof Settings)[]`, on the assumption that the compiler could
   * hold both ends. It cannot, for the reason in the block comment above, so the literal types bought
   * nothing and cost 138 lines that prettier would have exploded one-per-line.
   *
   * `$schema` is worth its own note: it is the key the machine-generated first draft SKIPPED, because
   * the scan that produced it used `\w`. Nothing here caught that — the compiler did, once the guard
   * was rewritten to a form that can actually fail.
   */
  const REVIEWED_SETTINGS = `
    $schema advisorModel agent agentPushNotifEnabled allowAllClaudeAiMcps allowManagedHooksOnly
    allowManagedMcpServersOnly allowManagedPermissionRulesOnly allowedChannelPlugins
    allowedHttpHookUrls allowedMcpServers alwaysThinkingEnabled apiKeyHelper
    askUserQuestionTimeout attribution autoCompactEnabled autoCompactWindow autoDreamEnabled
    autoMemoryDirectory autoMemoryEnabled autoScrollEnabled autoUpdatesChannel autoUploadSessions
    availableModels awsAuthRefresh awsCredentialExport blockedMarketplaces channelsEnabled
    claudeMd claudeMdExcludes cleanupPeriodDays companyAnnouncements daemonColdStart defaultShell
    defaultView deniedMcpServers disableAgentView disableAllHooks disableArtifact disableAutoMode
    disableBundledSkills disableClaudeAiConnectors disableDeepLinkRegistration
    disableRemoteControl disableSideloadFlags disableSkillShellExecution disableWorkflows
    disabledMcpjsonServers editorMode effortLevel emojiCompletionEnabled
    enableAllProjectMcpServers enableArtifact enableWorkflows enabledMcpjsonServers
    enabledPlugins enforceAvailableModels env extraKnownMarketplaces fallbackModel fastMode
    fastModePerSessionOptIn feedbackDrafts feedbackSurveyRate fileCheckpointingEnabled
    fileSuggestion footerLinksRegexes forceLoginMethod forceLoginOrgUUID
    forceRemoteSettingsRefresh gcpAuthRefresh hooks httpHookAllowedEnvVars includeCoAuthoredBy
    includeGitInstructions inputNeededNotifEnabled isolatePeerMachines language minimumVersion
    model modelOverrides otelHeadersHelper outputStyle parentSettingsBehavior permissions
    plansDirectory pluginConfigs pluginSuggestionMarketplaces pluginTrustMessage policyHelper
    prUrlTemplate preferredNotifChannel prefersReducedMotion processWrapper
    promptSuggestionEnabled proxyAuthHelper remote remoteControlAtStartup requiredMaximumVersion
    requiredMinimumVersion respectGitignore respondToBashCommands sandbox
    showClearContextOnPlanAccept showMessageTimestamps showThinkingSummaries showTurnDuration
    skillListingBudgetFraction skillListingMaxDescChars skillOverrides
    skipDangerousModePermissionPrompt skipWebFetchPreflight spinnerTipsEnabled
    spinnerTipsOverride spinnerVerbs sshConfigs statusLine strictKnownMarketplaces
    strictPluginOnlyCustomization subagentStatusLine switchModelsOnFlag
    syntaxHighlightingDisabled teammateMode terminalProgressBarEnabled terminalTitleFromRename
    theme todoFeatureEnabled tui ultracode verbose viewMode vimInsertModeRemaps voice
    voiceEnabled wheelScrollAccelerationEnabled workflowKeywordTriggerEnabled worktree
    wslInheritsWindowsSettings
  `
    .trim()
    .split(/\s+/)

  /**
   * ⚑ **680 · the thirty keys 0.3.281 added, looked at on the bump** — recorded apart from the 0.3.218
   * list so the review is visible as a review. ⛔ **None is offered as a control by this dispatch.**
   * Six bear on something this app already does and are named in 680's report for a decision:
   * `crossSessionInbound` and `dialogExpiry` (the CLI's own cross-session peer messages, and how long
   * a held one waits — BroBot's peer turns ride stdin, which `probe:claude-origin-wire` measured is
   * not held), `autoContinueAtUsageLimit` (the walls, 586), `maxEffortLevel` (the effort menu, 677),
   * `promptCacheTtl` (what a turn costs), and `workflowSizeGuideline` (ultracode's workflows). The
   * rest are UI, marketplace, managed-policy or login-gateway keys a child of this app never reads,
   * and two (`keybindingFlavor`, `taskOutputMaxChars`) are declared *"no longer has any effect"*.
   */
  const REVIEWED_AT_0_3_281 = `
    additionalMarketplaces allowedMarketplaces appendPlugins autoContinueAtUsageLimit
    bashEditDiffEnabled bashOutputMaxChars crossSessionInbound desktopSessionCleanupPeriodDays
    dialogExpiry disableCommandPluginSources forceLoginGatewayUrl gatewayInternalNetworks
    keybindingFlavor managedMcpServers managedSourcesBehavior maxEffortLevel modelPicker
    modelPricing modelSettings precomputeCompactionEnabled prependPlugins promptCacheTtl spellcheck
    subagentPromptCacheTtl syncClaudeAiPlugins syncClaudeAiSkills taskOutputMaxChars timeFormat
    timeZone workflowSizeGuideline
  `
    .trim()
    .split(/\s+/)

  /**
   * ⚑ **The five keys 0.3.287 added, looked at on the bump.** ⛔ None is offered as a control.
   * `allowedProviders`, `availableModelsMatch` and `deniedModels` are managed-policy keys that can
   * narrow which backend and which models a machine may use — a child of this app reads them only
   * from the person's own managed settings, and the model list BroBot shows is the CLI's own
   * answer after them. `allowClaudeInChromeWithManagedMcp` and `maxProseWidth` are UI keys.
   */
  const REVIEWED_AT_0_3_287 = `
    allowClaudeInChromeWithManagedMcp allowedProviders availableModelsMatch deniedModels
    maxProseWidth
  `
    .trim()
    .split(/\s+/)

  it('the ledger names every setting the pinned SDK declares, and no more', () => {
    const declared = declaredSettingsKeys(readFileSync(SDK_TYPES, 'utf8'))

    // ⚠️ The scan's own sanity check, BEFORE the comparison. A regex that stopped matching would
    // otherwise turn this test into "the empty set equals the empty set" — and the ledger's whole
    // job is to notice when something is missing.
    expect(declared.length, 'the scan found a plausible number of settings').toBeGreaterThan(100)
    for (const anchor of ['effortLevel', 'ultracode', 'enableWorkflows', '$schema']) {
      expect(declared, `the scan found ${anchor}`).toContain(anchor)
    }

    const reviewed = [...REVIEWED_SETTINGS, ...REVIEWED_AT_0_3_281, ...REVIEWED_AT_0_3_287]
    expect(new Set(reviewed).size, 'a key reviewed twice').toBe(reviewed.length)
    const added = declared.filter((key) => !reviewed.includes(key))
    const gone = reviewed.filter((key) => !declared.includes(key))
    expect(
      added,
      'the SDK grew settings nobody has looked at — is any of these a control BroBot should offer?',
    ).toEqual([])
    expect(gone, 'the SDK dropped settings the ledger still lists').toEqual([])
  })

  it('…and it would actually notice, rather than passing over any two lists', () => {
    // The detector, fired. Without this the assertions above are a claim about two arrays that
    // happen to agree today, with nothing showing the comparison can fail.
    const declared = declaredSettingsKeys(readFileSync(SDK_TYPES, 'utf8'))
    const pretend = declared.filter((key) => key !== 'ultracode')
    expect(declared.filter((key) => !pretend.includes(key))).toEqual(['ultracode'])

    // And the scan's sanity check fires too, on a file that is not the one it expects.
    expect(() => declaredSettingsKeys('export declare interface Other {}')).toThrow(/sdk\.d\.ts/)
  })

  /**
   * ⚠️ **The capability note restates the SDK's preconditions, so something has to notice if they
   * move** (106 review).
   *
   * Until 0.3.281 the description read *"xhigh effort plus …"* and `NewConversation.vue` gated the
   * control on `xhigh` (that gate has since gone with the control). 0.3.287 unties the mode from
   * effort: *"at any effort level"*, on *"a model that supports ultracode"*. The note says both, so
   * this reads the SDK's own description and asserts what the note relies on. It fails on a pin bump
   * that changes any of them, which is when a person should be re-reading the note.
   */
  it('the SDK still says this mode is any effort, needs workflows, and is session-scoped', () => {
    const lines = readFileSync(SDK_TYPES, 'utf8').replace(/\r/g, '').split('\n')
    // ⚠️ **`filter` + a length assertion, not `find`, and a mutation is why.** The first version used
    // `find(...)` and asserted `toBeDefined()`; a mutant adding `?? 'xhigh workflows Session-scoped'`
    // survived, because a defaulted string satisfies every `toContain` below and `toBeDefined` is
    // exactly the check a default defeats. Requiring the scan to have found EXACTLY ONE line makes
    // "it found nothing and made something up" a different shape from "it found the line".
    const found = lines.filter((line) => line.includes('Enable ultracode for the session'))
    expect(found, 'exactly one line in the pinned SDK describes `ultracode`').toHaveLength(1)
    const described = found[0] ?? ''
    // Length is the second half of the same guard: the real description is a paragraph, and a
    // stand-in short enough to be a literal cannot pass this and the three below together.
    expect(described.length, 'and it is a real description, not a stand-in').toBeGreaterThan(150)

    // No effort precondition any more, and a per-model one instead — both in the note.
    expect(described, 'it runs at any effort level').toContain('at any effort level')
    expect(described, 'it needs a model that supports it').toContain(
      'a model that supports ultracode',
    )
    // The precondition this app CANNOT check, and therefore discloses instead of gating on.
    expect(described.toLowerCase(), 'workflows are still required').toContain('workflows')
    // And the fact that makes it launcher-only.
    expect(described, 'it is still session-scoped').toContain('Session-scoped')

    // The detector, fired through the SAME expression: a phrase that is not in the file finds
    // nothing, so a scan that had quietly started matching everything would fail here.
    expect(lines.filter((line) => line.includes('Enable brobotcode for the session'))).toHaveLength(
      0,
    )
  })

  it('the mode is not a member of the effort union, which is the confusion this task began as', () => {
    // `EffortLevel` has no index signature, so THIS one is a real compile-time proof — the same
    // shape `_ClaudeEffortsAreExhaustive` uses, and the reason 076's guard still works.
    const notALevel: 'ultracode' extends EffortLevel ? false : true = true
    expect(notALevel).toBe(true)
  })
})
