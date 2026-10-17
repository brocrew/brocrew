const MESSAGE_ACT =
  /^message_act_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isMessageAct(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_ACT.test(value)
}

export const MESSAGE_ACT_META = 'brobot/message-act'

export function messageActFromStructured(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return value.outcome === 'ok' &&
    (value.delivery === 'sent' || value.delivery === 'queued') &&
    (value.kind === 'note' || value.kind === 'follow-up') &&
    typeof value.agent === 'string' &&
    value.agent.length > 0 &&
    value.agent.length <= 200 &&
    isMessageAct(value.messageAct)
    ? value.messageAct
    : undefined
}

export function messageActMetadata(value: unknown): Record<string, string> | undefined {
  const act = messageActFromStructured(value)
  return act === undefined ? undefined : { [MESSAGE_ACT_META]: act }
}

export interface MessageCall {
  readonly context: string
  readonly own: boolean
  spent: boolean
  act?: string
}

/** Calls and spent identities live together; saturation disables correlation instead of eviction. */
export class MessageActCalls {
  private readonly calls = new Map<string, MessageCall>()
  private open = true

  constructor(private readonly limit = 2048) {}

  claim(id: string, context: string, own: boolean): MessageCall | undefined {
    if (!this.open || !bounded(id) || !bounded(context, true)) return undefined
    const previous = this.calls.get(id)
    if (previous !== undefined) {
      previous.spent = true
      return undefined
    }
    if (this.calls.size >= this.limit) {
      this.close()
      return undefined
    }
    const call: MessageCall = { context, own, spent: false }
    this.calls.set(id, call)
    return call
  }

  remember(id: string, call: MessageCall | undefined, structured: unknown): void {
    if (!this.open || call === undefined || this.calls.get(id) !== call || call.spent || !call.own)
      return
    const act = messageActFromStructured(structured)
    if (act !== undefined) call.act = act
  }

  consume(
    id: string,
    context: string,
    decode: (call: MessageCall) => string | undefined,
  ): string | undefined {
    const call = this.calls.get(id)
    if (!this.open || call === undefined || call.spent || !call.own || call.context !== context)
      return undefined
    call.spent = true
    return decode(call)
  }

  close(): void {
    this.open = false
    this.calls.clear()
  }
}

/** Raw MCP metadata and legacy text share the caller's ownership gate. */
export function messageActFromReceipt(
  raw: unknown,
  parts: readonly string[] | null,
): string | undefined {
  if (isRecord(raw) && Object.hasOwn(raw, '_meta')) {
    if (
      !isRecord(raw._meta) ||
      Object.keys(raw._meta).length !== 1 ||
      !Object.hasOwn(raw._meta, MESSAGE_ACT_META) ||
      parts === null ||
      parts.length !== 1 ||
      !parts[0]
    )
      return undefined
    return isMessageAct(raw._meta[MESSAGE_ACT_META]) ? raw._meta[MESSAGE_ACT_META] : undefined
  }
  return messageActFromAnswer(parts)
}

function bounded(value: string, empty = false): boolean {
  return typeof value === 'string' && value.length <= 512 && (empty || value.length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the app's structured success answer, never its prose or a shortened summary. */
export function messageActFromAnswer(parts: readonly string[] | null): string | undefined {
  if (parts === null || parts.length !== 2 || !parts[0]) return undefined
  const structured = parts[1]
  if (structured === undefined || structured.length > 16_000) return undefined
  let value: unknown
  try {
    value = JSON.parse(structured)
  } catch {
    return undefined
  }
  return messageActFromStructured(value)
}
