import { MessageActCalls, messageActFromReceipt } from '../message-act'

export class ClaudeMessageReceipts {
  private readonly calls: MessageActCalls

  constructor(
    private readonly name: string,
    limit = 2048,
  ) {
    this.calls = new MessageActCalls(limit)
  }

  called(id: string, name: string, parent: unknown): void {
    const context = contextOf(parent)
    if (context !== undefined) this.calls.claim(id, context, name === this.name)
  }

  settled(
    id: string,
    parent: unknown,
    ok: boolean,
    raw: unknown,
    parts: readonly string[] | null,
  ): string | undefined {
    const context = contextOf(parent)
    if (context === undefined) return undefined
    return this.calls.consume(id, context, () =>
      ok ? messageActFromReceipt(raw, parts) : undefined,
    )
  }

  close(): void {
    this.calls.close()
  }
}

function contextOf(value: unknown): string | undefined {
  return value === null || value === undefined
    ? ''
    : typeof value === 'string' && value.length <= 512
      ? value
      : undefined
}
