import {
  CLAUDE_CONFIG_LAYOUT,
  CODEX_CONFIG_LAYOUT,
  type ProviderConfigLayout,
} from './providers/configuration'
import type { ProviderCapabilities } from './provider-capabilities'
import { CLAUDE_CAPABILITIES } from './providers/claude-capabilities'
import { CODEX_CAPABILITIES } from './providers/codex-capabilities'

/** Static facts every registered coding-agent backend supplies. */
export interface ProviderDescriptor {
  readonly id: string
  readonly displayName: string
  readonly debugOnly: boolean
  readonly nativeSkills: boolean
  readonly nativePlugins: boolean
  readonly nativeMemory: boolean
  readonly nativeArchive: boolean
  readonly credential: 'machine-or-key' | 'profile-or-key'
  readonly instructionPlacement: 'sdk-context' | 'native-file'
  readonly ownNotesPlacement: 'profile-bundle' | 'first-lead'
  readonly connectionKind: 'standard'
  readonly capabilities: ProviderCapabilities
  /** The provider's own program, as a conversation's words name it. */
  readonly programName: string
  readonly signIn: {
    /** Fixed sign-in ports may be shared by the whole machine or reserved per profile. */
    readonly portScope: 'machine' | 'profile'
    readonly profileScoped: boolean
    /** Whether the sign-in tag already names the account, rather than only its login. */
    readonly accountIsSignIn: boolean
    readonly changeWords: string
  }
  readonly apiKey: {
    /** The issuer named in the key check's result. */
    readonly issuer: string
    /** The free authenticated model-list request sent first. */
    readonly checkUrl: string
    /** Anthropic answers the list without credit; its one-token request also checks funding. */
    readonly spendsToken: boolean
    readonly header: string
    readonly prefix: string
    readonly extraHeaders: Readonly<Record<string, string>>
    readonly windowsLoginNeedsFile: boolean
  }
  readonly words: {
    readonly providerChoice: string
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
  readonly config: ProviderConfigLayout
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
  /** Default bounds, before per-host injected timeout overrides. */
  readonly launch: { readonly freshTimeoutMs: number; readonly resumeTimeoutMs: number }
  readonly limitClearsOnSignInChange: boolean
  readonly toolInstructionsInText: boolean
  readonly identityPreamble: boolean
  readonly contextPlacement: 'system-prompt' | 'first-message'
}

/** Declaration order is also the order used by provider pickers and aggregate values. */
export const PROVIDER_DESCRIPTORS = [
  {
    id: 'claude',
    apiKey: {
      issuer: 'Anthropic',
      checkUrl: 'https://api.anthropic.com/v1/models?limit=100',
      spendsToken: true,
      header: 'x-api-key',
      prefix: '',
      extraHeaders: {
        'anthropic-version': '2023-06-01',
      },
      windowsLoginNeedsFile: true,
    },
    words: {
      refusedSignIn: 'claude-sign-in',
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
    capabilities: Object.freeze(CLAUDE_CAPABILITIES),
    programName: 'Claude Code',
    config: CLAUDE_CONFIG_LAYOUT,
    signIn: {
      portScope: 'profile',
      profileScoped: false,
      accountIsSignIn: false,
      changeWords: 'this computer has moved on to a different one since — a renewal counts',
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
    launch: { freshTimeoutMs: 15_000, resumeTimeoutMs: 15_000 },
    limitClearsOnSignInChange: true,
    toolInstructionsInText: false,
    identityPreamble: false,
    contextPlacement: 'system-prompt',
  },
  {
    id: 'codex',
    apiKey: {
      issuer: 'OpenAI',
      checkUrl: 'https://api.openai.com/v1/models',
      spendsToken: false,
      header: 'authorization',
      prefix: 'Bearer ',
      extraHeaders: {},
      windowsLoginNeedsFile: false,
    },
    words: {
      refusedSignIn: 'codex-sign-in',
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
    capabilities: Object.freeze(CODEX_CAPABILITIES),
    programName: 'Codex',
    config: CODEX_CONFIG_LAYOUT,
    signIn: {
      portScope: 'machine',
      profileScoped: true,
      accountIsSignIn: true,
      changeWords: 'its profile has been signed in to another account since',
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
    launch: { freshTimeoutMs: 15_000, resumeTimeoutMs: 60_000 },
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
