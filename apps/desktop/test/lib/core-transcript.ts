import { WorkAncestryRead } from '../../src/main/runtime/work-ancestry'
import {
  applyEvent as renderEvent,
  type TranscriptState,
} from '../../src/renderer/src/lib/transcript'
import { foldWindow as renderWindow } from '../../src/renderer/src/lib/transcript-window'
import {
  acceptEvent as receiveEvent,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
export * from '../../src/renderer/src/lib/transcript'

/** A fake core producer for tests that feed provider events without a RuntimeHost. */
const projections = new WeakMap<object, WorkAncestryRead>()
function projection(owner: object): WorkAncestryRead {
  let read = projections.get(owner)
  if (read === undefined) {
    read = new WorkAncestryRead()
    projections.set(owner, read)
  }
  return read
}
export function applyEvent(...args: Parameters<typeof renderEvent>): void {
  const read = projection(args[0])
  const update = read.observe(args[1])
  renderEvent(args[0], args[1], args[2], args[3], args[4], update)
}
export function acceptEvent(record: SessionRecord, message: RuntimeEventMessage): void {
  const read = projection(record)
  const update = read.observe(message.event)
  receiveEvent(record, {
    ...message,
    ...(message.workAncestry === undefined && update !== undefined ? { workAncestry: update } : {}),
  })
}
export function foldWindow(...args: Parameters<typeof renderWindow>): TranscriptState {
  const read = new WorkAncestryRead()
  const entries = args[0].map((message) => {
    const update = read.observe(message.event)
    return {
      ...message,
      ...(message.workAncestry === undefined && update !== undefined
        ? { workAncestry: update }
        : {}),
    }
  })
  return renderWindow(entries, args[1], args[2], args[3])
}
