import type { RuntimeBridge } from './runtime-ipc'

/**
 * What the runtime screen reads, intends and hears. Every name here is one the screen called on the
 * window's runtime bridge directly, so the screen is routed through the selected client unchanged.
 */
export type ClientScreenApi = Pick<
  RuntimeBridge,
  | 'archiveConversation'
  | 'capabilities'
  | 'closeWork'
  | 'earlierHistory'
  | 'filesKept'
  | 'filesLibrary'
  | 'latestHistory'
  | 'onChanged'
  | 'onEvent'
  | 'onLimitsDisplayChanged'
  | 'onStates'
  | 'profiles'
  | 'readAllConversationTasks'
  | 'readConversationIdentities'
  | 'readConversationIdentity'
  | 'readConversationTasks'
  | 'readConversationTitleHistory'
  | 'renameConversation'
  | 'searchWork'
  | 'takeBackWork'
  | 'teamProfileGraph'
> &
  /** An older preload may lack these; the screen tests for them before it calls. */
  Partial<Pick<RuntimeBridge, 'onProvidersChanged' | 'providerVersions'>>
