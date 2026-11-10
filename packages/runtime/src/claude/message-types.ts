import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/** Every `subtype` the SDK's `system` messages carry. */
export type SystemSubtype = Extract<SDKMessage, { type: 'system' }>['subtype']

/** SDK message types with no content mapping. */
export type NonContentMessageType = Exclude<
  SDKMessage['type'],
  'assistant' | 'user' | 'stream_event' | 'system' | 'result'
>

/**
 * The partial-stream frame types, taken from the SDK's own union rather than restated, so
 * the exhaustive normalization switches track the pinned SDK instead of a hand-copied list.
 */
export type StreamEventType = Extract<SDKMessage, { type: 'stream_event' }>['event']['type']
export type BlockDeltaType = Extract<
  Extract<SDKMessage, { type: 'stream_event' }>['event'],
  { type: 'content_block_delta' }
>['delta']['type']
