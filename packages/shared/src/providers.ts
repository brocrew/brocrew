import type { ProviderCapabilities, ProviderConnectionCapabilities } from './provider-capabilities'
import { CLAUDE_CAPABILITIES } from './providers/claude-capabilities'
import { CODEX_CAPABILITIES } from './providers/codex-capabilities'

/** Static facts every registered coding-agent backend supplies. */
export interface ProviderDescriptor {
  readonly id: string
  readonly displayName: string
  readonly defaultModelByName: { readonly model: string; readonly effort: string } | null
  readonly debugOnly: boolean
  readonly nativeSkills: boolean
  readonly nativePlugins: boolean
  readonly nativeMemory: boolean
  readonly nativeArchive: boolean
  readonly credential: 'machine-or-key' | 'profile-or-key'
  readonly instructionPlacement: 'sdk-context' | 'native-file'
  readonly ownNotesPlacement: 'profile-bundle' | 'first-lead'
  readonly connectionKind: 'standard'
  readonly connections: ProviderConnectionCapabilities
  readonly capabilities: ProviderCapabilities
  /** The provider's own program, as a conversation's words name it. */
  readonly programName: string
  readonly signIn: {
    readonly profileScoped: boolean
    /** Whether the sign-in tag already names the account, rather than only its login. */
    readonly accountIsSignIn: boolean
    readonly changeWords: string
    readonly manualProbe: boolean
  }
  readonly apiKey: { readonly spendsToken: boolean }
  readonly words: {
    readonly providerChoice: string
    readonly interruptActionSummary: string
    readonly interruptSummary: string
    readonly refusedSignIn: 'claude-sign-in' | 'codex-sign-in'
    readonly stopForWords: { readonly beforeName: string; readonly afterName: string }
    readonly loginRefusal: {
      readonly key: string
      readonly signIn: string
      readonly signInAfterReopen: string
      readonly saysNotReopened: boolean
    }
  }
  readonly skillReminderPrefix: string
  readonly usageWindows: readonly string[]
  readonly commandPrefix: string
  readonly defaults: { readonly conversation: boolean; readonly identity: boolean }
  readonly approval: {
    readonly autoNote: string
    readonly grantReach: 'reads' | 'writes'
    readonly protections: Readonly<
      Record<'ask' | 'auto', readonly ('the-card-before-an-act' | 'the-sandbox-around-an-act')[]>
    >
  }
  readonly limitClearsOnSignInChange: boolean
  readonly toolInstructionsInText: boolean
  readonly identityPreamble: boolean
  readonly contextPlacement: 'system-prompt' | 'first-message'
}

/** Declaration order is also the order used by provider pickers and aggregate values. */
export const PROVIDER_DESCRIPTORS = [
  {
    id: 'claude',
    defaultModelByName: { model: 'default', effort: 'medium' },
    apiKey: { spendsToken: true },
    words: {
      refusedSignIn: 'claude-sign-in',
      interruptActionSummary:
        'the command it is waiting on, while work it sent to the background keeps running',
      providerChoice: "'claude' runs the conversation through Claude.",
      interruptSummary:
        'the command that turn is waiting on ends with it, and work it sent to the background keeps running',
      stopForWords: {
        beforeName: 'The command that turn is waiting on ends with it, and anything ',
        afterName: ' sent to the background keeps running.',
      },
      loginRefusal: {
        key: 'its turn failed because Claude refused the Anthropic API key its conversation was started with, so a person needs to check or replace that key under “API key” on the Claude card in Providers',
        signIn:
          'its turn failed because Claude refused the login its conversation was started with, as it does when another Claude on this computer renews or switches the login',
        signInAfterReopen:
          'its turn failed because Claude refused the login its conversation was started with, as it does when another Claude on this computer renews or switches the login',
        saysNotReopened: true,
      },
    },
    displayName: 'Claude',
    debugOnly: false,
    nativeSkills: true,
    nativePlugins: true,
    nativeMemory: true,
    nativeArchive: true,
    credential: 'machine-or-key',
    instructionPlacement: 'sdk-context',
    ownNotesPlacement: 'profile-bundle',
    connectionKind: 'standard',
    connections: {
      contractVersion: 1,
      authMethods: ['sign-in', 'api-key'],
      additionalConnections: false,
    },
    capabilities: Object.freeze(CLAUDE_CAPABILITIES),
    programName: 'Claude Code',
    signIn: {
      profileScoped: false,
      accountIsSignIn: false,
      changeWords: 'this computer has moved on to a different one since — a renewal counts',
      manualProbe: true,
    },
    skillReminderPrefix: 'brobot:',
    usageWindows: ['5-hour', 'weekly'],
    commandPrefix: '/',
    defaults: { conversation: false, identity: true },
    approval: {
      autoNote: '⚠ approvals: Auto — nothing is asked',
      grantReach: 'reads',
      protections: { ask: ['the-card-before-an-act'], auto: [] },
    },
    limitClearsOnSignInChange: true,
    toolInstructionsInText: false,
    identityPreamble: false,
    contextPlacement: 'system-prompt',
  },
  {
    id: 'codex',
    defaultModelByName: null,
    apiKey: { spendsToken: false },
    words: {
      refusedSignIn: 'codex-sign-in',
      interruptActionSummary: 'every command that turn started, even one it left running',
      providerChoice: "'codex' runs the conversation through Codex.",
      interruptSummary:
        'the command that turn ran last ends with it unless it has used another tool since, and its other commands keep running',
      stopForWords: {
        beforeName: 'The command ',
        afterName:
          ' ran last in that turn ends with it unless it has used another tool since, and its other commands keep running.',
      },
      loginRefusal: {
        key: 'its turn failed because the API key its Codex conversation was started with was refused, so a person needs to check or replace that key under “API key” on the Codex card in Providers',
        signIn:
          'its turn failed because Codex refused the sign-in its conversation was started with, so a person needs to sign its Codex profile in again',
        signInAfterReopen:
          'its turn failed because Codex refused the sign-in its conversation was started with, its profile having been signed in to another account since',
        saysNotReopened: false,
      },
    },
    displayName: 'Codex',
    debugOnly: false,
    nativeSkills: true,
    nativePlugins: true,
    nativeMemory: true,
    nativeArchive: true,
    credential: 'profile-or-key',
    instructionPlacement: 'native-file',
    ownNotesPlacement: 'first-lead',
    connectionKind: 'standard',
    connections: {
      contractVersion: 1,
      authMethods: ['sign-in', 'api-key'],
      additionalConnections: false,
    },
    capabilities: Object.freeze(CODEX_CAPABILITIES),
    programName: 'Codex',
    signIn: {
      profileScoped: true,
      accountIsSignIn: true,
      changeWords: 'its profile has been signed in to another account since',
      manualProbe: false,
    },
    skillReminderPrefix: '',
    usageWindows: ['weekly'],
    commandPrefix: '$',
    defaults: { conversation: true, identity: false },
    approval: {
      autoNote: '⚠ approvals: Auto — nothing is asked · sandbox OFF',
      grantReach: 'writes',
      protections: {
        ask: ['the-card-before-an-act', 'the-sandbox-around-an-act'],
        auto: [],
      },
    },
    limitClearsOnSignInChange: false,
    toolInstructionsInText: true,
    identityPreamble: true,
    contextPlacement: 'first-message',
  },
] as const satisfies readonly ProviderDescriptor[]

export type Provider = (typeof PROVIDER_DESCRIPTORS)[number]['id']

/** Keep declaration order within each group, with experimental providers last when visible. */
export function visibleProviderDescriptors(
  debugMode: boolean,
  descriptors: readonly ProviderDescriptor[] = PROVIDER_DESCRIPTORS,
): readonly ProviderDescriptor[] {
  const ordinary = descriptors.filter((descriptor) => !descriptor.debugOnly)
  return debugMode
    ? [...ordinary, ...descriptors.filter((descriptor) => descriptor.debugOnly)]
    : ordinary
}

export const SUPPORTED_PROVIDERS: readonly Provider[] = PROVIDER_DESCRIPTORS.map(
  (descriptor) => descriptor.id,
)

/** The declaration for a validated provider id. */
export function providerDescriptor<P extends Provider>(
  provider: P,
): Extract<(typeof PROVIDER_DESCRIPTORS)[number], { readonly id: P }> {
  const descriptor = PROVIDER_DESCRIPTORS.find((item) => item.id === provider)
  if (descriptor === undefined) throw new Error(`Unknown provider: ${provider}`)
  return descriptor as Extract<(typeof PROVIDER_DESCRIPTORS)[number], { readonly id: P }>
}

function defaultProviderFor(kind: keyof ProviderDescriptor['defaults']): Provider {
  const found = PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.defaults[kind])
  if (found.length !== 1) throw new Error(`Expected one default provider for ${kind}`)
  return found[0]!.id
}

export const DEFAULT_CONVERSATION_PROVIDER = defaultProviderFor('conversation')
export const DEFAULT_IDENTITY_PROVIDER = defaultProviderFor('identity')

/** Build one value per registered provider, invoking the factory separately for each. */
export function providerRecord<T>(make: (provider: Provider) => T): Record<Provider, T> {
  return Object.fromEntries(
    PROVIDER_DESCRIPTORS.map((descriptor) => [descriptor.id, make(descriptor.id)]),
  ) as Record<Provider, T>
}

/** Select a value only after every provider has supplied an answer. */
export function providerValue<const T>(
  provider: Provider,
  values: Readonly<Record<Provider, T>>,
): T {
  return values[provider]
}
