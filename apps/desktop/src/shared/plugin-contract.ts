/** JSON crossing the plugin interface stays data; executable behavior is an MCP binding. */
export type PluginJson = null | boolean | number | string | PluginJson[] | PluginJsonObject
export interface PluginJsonObject {
  [key: string]: PluginJson
}
export type PluginJsonSchema = boolean | PluginJsonObject
export interface ToolBinding {
  tool: string
  arguments?: PluginJsonObject
  inputField?: string
}
export type PluginRuntime =
  | { kind: 'node'; entry: string; args?: string[] }
  | { kind: 'process'; command: string; args?: string[] }
export type PluginMcp =
  { transport: 'stdio' } | { transport: 'streamable-http'; bootstrap: 'ready-message' }
export interface PluginButtonDefinition {
  slot: string
  view: { label: string; icon?: string; tooltip?: string; disabled?: boolean }
  invoke: ToolBinding
}
export interface PluginSettingsDefinition {
  title: string
  entry: string
  assets: string[]
  fields?: PluginJsonSchema
}
export interface PluginSpeechDefinition {
  label: string
  execution: 'local' | 'cloud'
  languages: string[]
  bindings: { start: ToolBinding; frame: ToolBinding; finish: ToolBinding; cancel: ToolBinding }
}
export interface PluginCleanupDefinition {
  label: string
  execution: 'local' | 'cloud'
  invoke: ToolBinding
}
export interface PluginContributionDefinitions {
  'ui.button': PluginButtonDefinition
  'settings.page': PluginSettingsDefinition
  'turn.context.titles': { invoke: ToolBinding }
  'speech.transcribe': PluginSpeechDefinition
  'transcript.cleanup': PluginCleanupDefinition
}
export type PluginContributionRegistration = {
  [K in keyof PluginContributionDefinitions]: {
    contributionId: string
    kind: K
    api: 1
    definition: PluginContributionDefinitions[K]
  }
}[keyof PluginContributionDefinitions]
export type PluginContributionState = 'active' | 'inactive' | 'unsupported'
export type PluginHostFailure = 'unsupported' | 'disabled' | 'not-found' | 'error'
export type PluginHostResult<T> =
  { value: T } | { error: { code: PluginHostFailure; message?: string } }

export interface PluginHostMethods {
  'host.describe': {
    params: null
    result: {
      api: 1
      methods: string[]
      slots: string[]
      hookKinds: string[]
      speechAvailable: boolean
    }
  }
  'host.contributions.register': {
    params: PluginContributionRegistration
    result: {
      handle: string
      state: PluginContributionState
      viewId?: string
      pageId?: string
      available?: boolean
      selected?: boolean
    }
  }
  'host.contributions.update': {
    params: { handle: string; patch: PluginJsonObject }
    result: { definition: PluginJsonObject; state: PluginContributionState }
  }
  'host.contributions.remove': { params: { handle: string }; result: { removed: boolean } }
  'host.settings.open': {
    params: { contributionId: string }
    result: { viewId: string; state: PluginContributionState }
  }
  'host.settings.close': { params: { viewId: string }; result: { closed: boolean } }
  'host.speech.publish': {
    params: {
      utteranceId: string
      attempt: number
      stage: 'recognition' | 'cleanup'
      revision: number
      kind: 'partial' | 'final'
      text: string
      language?: string
      inputTranscriptRevision?: number
    }
    result: { accepted: boolean }
  }
  'host.notifications.show': {
    params: {
      notificationId?: string
      title: string
      text: string
      level: 'info' | 'warning' | 'error'
      actions?: { id: string; label: string; invoke: ToolBinding }[]
    }
    result: { notificationId: string; shown: boolean }
  }
  'host.notifications.dismiss': {
    params: { notificationId: string }
    result: { dismissed: boolean }
  }
  'host.accounts.configure': {
    params: {
      accountId: string
      label: string
      serviceDescription: string
      baseUrl: string
      credentialLabel: string
    }
    result: { accountRef: string; configured: boolean }
  }
  'host.service.request': {
    params: {
      accountRef: string
      requestId: string
      method: string
      path: string
      headers?: Record<string, string>
      body?: string
      stream?: boolean
    }
    result: {
      requestId: string
      status: number
      headers: Record<string, string>
      body?: string
      streamId?: string
    }
  }
  'host.service.read': {
    params: { streamId: string; maxBytes: number }
    result: { chunk: string; done: boolean }
  }
  'host.service.cancel': { params: { requestId: string }; result: { cancelled: boolean } }
}
export type PluginHostRequest = {
  [K in keyof PluginHostMethods]: {
    api: 1
    workspaceId: string
    requestId: string
    method: K
    params: PluginHostMethods[K]['params']
  }
}[keyof PluginHostMethods]

export interface PluginCallMetadata {
  workspaceId: string
  requestId: string
  origin: string
}
export interface PluginTitleCandidate {
  resourceId: string
  version: string
  title: string
  pieceId: string
}
export interface PluginBeforeTurnInput {
  workspaceId: string
  turnId: string
  pieceId: string
  candidates: PluginTitleCandidate[]
}
export interface PluginBeforeTurnResult {
  pointers: { resourceId: string; version: string }[]
}
export interface PluginSpeechStart {
  utteranceId: string
  attempt: number
  language: string
  vocabulary: string[]
  format: { encoding: 'pcm16le'; sampleRate: 16000; channels: 1 }
}
export interface PluginSpeechFrame {
  utteranceId: string
  attempt: number
  sequence: number
  sampleOffset: number
  audioBase64: string
}
/** Describes interface v1 only; it does not advertise implemented host services. */
export const PLUGIN_HOST_METHODS = [
  'host.describe',
  'host.contributions.register',
  'host.contributions.update',
  'host.contributions.remove',
  'host.settings.open',
  'host.settings.close',
  'host.speech.publish',
  'host.notifications.show',
  'host.notifications.dismiss',
  'host.accounts.configure',
  'host.service.request',
  'host.service.read',
  'host.service.cancel',
] as const satisfies readonly (keyof PluginHostMethods)[]
export const PLUGIN_SLOTS = ['composer.accessory', 'settings.plugin.configure'] as const

export interface PluginPackageRef {
  /** URL or local package path. */
  source: string
  sha256: string
  bytes: number
}
export interface PluginPackageCard {
  id: string
  name: string
  version: string
  authors: string[]
  permissions: { description: string; dataUses?: string[] }
  installed: boolean
  state: string
}
export interface PluginMcpToolDefinition {
  name: string
  description?: string
  inputSchema: PluginJsonObject
  [key: string]: unknown
}
export interface PluginMcpToolResult {
  content: PluginJson[]
  structuredContent?: PluginJsonObject
  isError?: boolean
  _meta?: PluginJsonObject
  [key: string]: unknown
}
export type PluginToolCallResult =
  | { status: 'result'; result: PluginMcpToolResult }
  | { status: 'transport-error'; message: string }
  | { status: 'disabled' }
export interface PluginOperationState {
  state: string
  exit?: { code: number | null; signal: string | null }
  error?: string
}
/** App-facing contract. Implementations are supplied by the generic lifecycle and MCP runner. */
export interface PluginInterface<Manifest = unknown, Connection = unknown> {
  list(source?: string): Promise<PluginPackageCard[]>
  inspect(
    ref: PluginPackageRef,
  ): Promise<{
    manifest: Manifest
    authors: string[]
    permissions: PluginPackageCard['permissions']
    intact: boolean
  }>
  install(ref: PluginPackageRef): Promise<{ pluginId: string; version: string; state: string }>
  update(
    pluginId: string,
    ref: PluginPackageRef,
  ): Promise<{ version: string; state: string; startup?: PluginJson }>
  start(pluginId: string): Promise<{ instanceId: string; mcpConnection: Connection; state: string }>
  stop(pluginId: string, reason: string): Promise<PluginOperationState>
  restart(pluginId: string, reason: string): Promise<PluginOperationState>
  setEnabled(
    workspaceId: string,
    pluginId: string,
    enabled: boolean,
  ): Promise<{ enabled: boolean; revision: number }>
  uninstall(
    pluginId: string,
  ): Promise<{
    removed: boolean
    data: 'kept' | 'removed'
    pluginCleanup?: { status: string; message?: string }
  }>
  listTools(workspaceId: string, pluginId: string): Promise<PluginMcpToolDefinition[]>
  callTool(input: {
    workspaceId: string
    pluginId: string
    tool: string
    arguments: PluginJsonObject
    requestId: string
    origin?: string
  }): Promise<PluginToolCallResult>
  cancelTool(input: {
    workspaceId: string
    pluginId: string
    requestId: string
  }): Promise<{ cancelled: boolean; completed: boolean }>
  beforeTurn(input: PluginBeforeTurnInput): Promise<PluginBeforeTurnResult>
}
