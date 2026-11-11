import type { AsSentPart, WhatTheRecordLeavesOut } from '../../shared/turn-as-sent'

export type { TurnAsked } from '../../shared/turn-as-sent'
import type { TurnAsked } from '../../shared/turn-as-sent'

/**
 * ⚑ **What a reading may ask of this build**: whether a Claude model, as a turn's answer names it,
 * takes a context message — `true`, `false`, or `null`: this build holds no snapshot of it.
 */
export type { TurnReadingOptions } from '@brobot2/runtime/provider-module'
import type { TurnReading as PortableTurnReading } from '@brobot2/runtime/provider-module'
import type { DesktopProviderValues } from '../providers/desktop-values'
export type TurnReading = PortableTurnReading<DesktopProviderValues>

/** How much of a record this build cannot read is kept for the window: enough to see what it is. */
const RAW_MAX = 20_000

export type Json = Record<string, unknown>

export const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A record kept as written — or its first characters, for one too large to carry whole. */
export function kept(raw: unknown): unknown {
  const written = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return written.length <= RAW_MAX ? raw : { cutAt: RAW_MAX, start: written.slice(0, RAW_MAX) }
}

/** A block of a message's content, as sent: a text block's text, or an image named, never read. */
interface Block {
  readonly text: string
  readonly isText: boolean
}

export const TEXT_BLOCKS = new Set(['text', 'input_text', 'output_text'])

/** A message's content, block by block, as sent. */
export function blocksIn(content: unknown): Block[] {
  if (typeof content === 'string') return [{ text: content, isText: true }]
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown): Block[] => {
    if (!isRecord(block)) return []
    const kind = asText(block['type'])
    if (TEXT_BLOCKS.has(kind)) return [{ text: asText(block['text']), isText: true }]
    if (kind === 'image' || kind === 'input_image') return [{ text: '[an image]', isText: false }]
    return []
  })
}

/** The blocks of a message's content, one text per block; an image named, never read. */
export const blocksOf = (content: unknown): string[] => blocksIn(content).map((block) => block.text)

/**
 * 🔴 **The text a message carried, to match against what BroBot handed over** — its text blocks
 * alone, joined as they are rendered; an image beside them is no part of it.
 */
export function textOf(content: unknown): string {
  return blocksIn(content)
    .filter((block) => block.isText)
    .map((block) => block.text)
    .join('\n\n')
}

/** One line of a provider's file, parsed — or kept as text when it is not JSON. */
export function parsed(text: string): Json | { readonly unreadable: string } {
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? value : { unreadable: text }
  } catch {
    return { unreadable: text }
  }
}

/**
 * ⚑ What a reading holds none of: a system prompt where it read none, and what came after the
 * model's first answer, where every reading stops.
 */
export function whatItLeavesOut(standing: readonly AsSentPart[]): WhatTheRecordLeavesOut[] {
  return [
    ...(standing.length === 0 ? ['the-system-prompt' as const] : []),
    'after-its-first-answer',
  ]
}

/**
 * ⚑ Why a turn is not found, in what is true either way: no message has its text — whether the
 * provider never got it or kept it otherwise.
 */
export function notInTheRecord(provider: string, asked: TurnAsked): string {
  return asked.by === 'handed-over'
    ? `No message in ${provider}’s own record of the conversation has exactly the text this app handed over.`
    : `No message in ${provider}’s own record of the conversation has the text this app read from it.`
}
