import type { OutgoingMessage, ToolItem, TranscriptState } from './transcript'

interface Call {
  itemId: string | null
  epoch: number
  eligible: boolean
  resultSeen: boolean
  act: string | null
}
interface Receipt {
  epoch: number
  words: OutgoingMessage
}
export interface MessageJoins {
  epoch: number
  calls: Map<string, Call>
  receipts: Map<string, Receipt>
  claims: Map<string, Call>
  poisoned: Set<string>
  pending: Set<string>
}
function index(state: TranscriptState): MessageJoins {
  return (state.messageReceipts ??= {
    epoch: 0,
    calls: new Map(),
    receipts: new Map(),
    claims: new Map(),
    poisoned: new Set(),
    pending: new Set(),
  })
}
function isAct(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^message_act_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
}
function item(state: TranscriptState, call: Call): ToolItem | undefined {
  const row = state.items.find((one) => one.id === call.itemId)
  return row?.kind === 'tool' ? row : undefined
}
function poison(state: TranscriptState, act: string): void {
  const one = index(state)
  one.poisoned.add(act)
  const call = one.claims.get(act)
  const row = call === undefined ? undefined : item(state, call)
  if (row?.outgoing?.tool === 'message_agent') row.outgoing.sent = null
}
function join(state: TranscriptState, act: string): void {
  const one = index(state)
  const call = one.claims.get(act)
  const receipt = one.receipts.get(act)
  if (!call || !receipt || one.poisoned.has(act) || !call.eligible || call.epoch !== receipt.epoch)
    return
  const row = item(state, call)
  if (row?.outgoing?.tool === 'message_agent') {
    row.outgoing.sent = receipt.words
    one.pending.delete(act)
  }
}

/** Only a registered top-level call can claim this provider's exact result. */
export function messageCall(
  state: TranscriptState,
  id: string,
  row: ToolItem | null,
  eligible: boolean,
): void {
  const one = index(state)
  const old = one.calls.get(id)
  if (old) {
    if (old.act !== null) poison(state, old.act)
    old.eligible = false
    return
  }
  one.calls.set(id, {
    itemId: row?.id ?? null,
    epoch: one.epoch,
    eligible,
    resultSeen: false,
    act: null,
  })
}
export function messageResult(
  state: TranscriptState,
  id: string,
  act: unknown,
  ok: boolean,
  nested: boolean,
): void {
  const one = index(state)
  const call = one.calls.get(id)
  if (call?.resultSeen) {
    if (call.act !== null) poison(state, call.act)
    call.eligible = false
  }
  if (!isAct(act)) {
    if (call) call.resultSeen = true
    return
  }
  if (!call || !call.eligible || call.resultSeen || !ok || nested || call.epoch !== one.epoch) {
    poison(state, act)
    return
  }
  const row = item(state, call)
  if (row?.outgoing?.tool === 'message_agent') row.outgoing.sent = null
  call.resultSeen = true
  call.act = act
  const existing = one.claims.get(act)
  if (existing !== undefined && existing !== call) {
    poison(state, act)
    return
  }
  one.claims.set(act, call)
  join(state, act)
}
export function messageReceipt(state: TranscriptState, act: unknown, words: OutgoingMessage): void {
  if (!isAct(act)) return
  const one = index(state)
  if (one.receipts.has(act)) {
    poison(state, act)
    return
  }
  one.receipts.set(act, { epoch: one.epoch, words })
  one.pending.add(act)
  join(state, act)
}
/** A receipt missing its call/result cannot be adopted by a later run. */
export function endMessageRun(state: TranscriptState): void {
  const one = index(state)
  for (const act of one.pending) poison(state, act)
  one.pending.clear()
  one.calls.clear()
  one.epoch += 1
}

export function rejectMessageReceipt(state: TranscriptState, act: unknown): void {
  if (isAct(act)) poison(state, act)
}
