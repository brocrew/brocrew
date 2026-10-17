import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import {
  executeRuntimeCommand,
  registerRuntimeIpc,
  withoutItsClassName,
  type IpcHandleRegistrar,
} from '../src/main/runtime/ipc'
import { ACommandTakesNoAttachments } from '../src/main/runtime/a-command-goes-as-typed'
import { ProfileUnopenable } from '../src/main/runtime/provider-homes'
import type { RuntimeEventSink, RuntimeHost } from '../src/main/runtime/runtime-host'
import { readableError } from '../src/renderer/src/lib/session-record'
import { RUNTIME_COMMAND_CHANNEL } from '../src/shared/runtime-ipc'

/**
 * 🔴 **675 §3 · a class name is a developer's word, and the IPC door is where it would become a
 * person's** (`670` F-c).
 *
 * ## ⛔ What was measured
 *
 * ⚑ **Electron 43.2.0 sends a rejected `ipcMain.handle` as `error.toString()`** — its main-process
 * `replyWithError` is `sendReply({ error: r.toString() })` — and `ipcRenderer.invoke` throws
 * `new Error(\`Error invoking remote method '${channel}': ${error}\`)`. The renderer's
 * `readableError` strips that wrapper and ONE `\w*Error:` after it. ⛔ **So a class named anything
 * not ending in `Error` reached a person whole** — *"MessageAlreadyHeld: a message is already
 * waiting…"* at the Queue button, and since `670` at a send and an interrupt-and-send that lose their
 * race and find work already held.
 *
 * ## ⚑ Where the fix is true
 *
 * ⛔ **Not the renderer**, which would strip any `Word:` a person's own text could begin with. ⛔
 * **Not each class** — `ProfileUnopenable` reached the same screen at two credential doors, and a
 * class added tomorrow would too. ⚑ **The one door every runtime command crosses**, which re-throws a
 * named class as a plain `Error` carrying the original as `cause` (`registerRuntimeIpc`). Nothing in
 * this app reads `.name` — every classifier is `instanceof` — so the classes keep their names for the
 * log.
 *
 * ⚠️ **The two halves of Electron are copied here as they were measured**, and they are the only
 * thing this file does not run: there is no `ipcMain` in a unit test.
 */

/** ⚑ What the renderer's `invoke` throws, from what the main process rejected with. */
const whatTheRendererGets = (rejection: unknown): Error =>
  new Error(`Error invoking remote method '${RUNTIME_COMMAND_CHANNEL}': ${String(rejection)}`)

const A_WINDOW: RuntimeEventSink = {
  ownerId: 'window:675',
  aPersonIsBehindIt: true,
  alive: true,
  send: () => undefined,
  sendLiveness: () => undefined,
} as unknown as RuntimeEventSink

/** A host whose every method throws `error` — the door under test is the one in front of it. */
const aHostThatThrows = (error: unknown): RuntimeHost =>
  new Proxy(
    {},
    {
      get: (_target, property) =>
        property === 'closing'
          ? false
          : () => {
              throw error
            },
    },
  ) as unknown as RuntimeHost

/** ⚑ `registerRuntimeIpc`'s own listener — the one `main/index.ts` registers — driven directly. */
function theRegisteredDoor(host: RuntimeHost): (raw: unknown) => Promise<unknown> {
  let listener: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | null = null
  const ipc: IpcHandleRegistrar = {
    handle: (channel, registered) => {
      expect(channel).toBe(RUNTIME_COMMAND_CHANNEL)
      listener = registered
    },
  }
  registerRuntimeIpc({ ipc, host, sinkFor: () => A_WINDOW })
  if (listener === null) throw new Error('registerRuntimeIpc registered nothing')
  const door = listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  return async (raw) => door({} as IpcMainInvokeEvent, raw)
}

const QUEUE = { kind: 'queueMessage', sessionId: 'sess_675', text: 'and then this' }

async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('the door did not refuse')
}

describe('675 §3 · a class name is not a sentence', () => {
  // ⚑ **D-010 retired `MessageAlreadyHeld`, the class 675 measured this with** — a conversation holds
  // any number of messages now — and D-016 retired `WorkAlreadyOpen`, which stood in for it. Any
  // named class crosses the same door, so another one stands in: a queued command's refusal.
  it('🔴 a named refusal reaches a person as its SENTENCE — and before 675 it did not', async () => {
    const held = new ACommandTakesNoAttachments('compact', true)
    const through = await rejectionOf(theRegisteredDoor(aHostThatThrows(held))(QUEUE))
    expect(readableError(whatTheRendererGets(through))).toBe(held.message)
    // ⚑ The original is still there for the log, and still the class every classifier asks about.
    expect((through as Error).cause).toBe(held)
    expect((through as Error).cause).toBeInstanceOf(ACommandTakesNoAttachments)

    // ⛔ **The control: the same refusal one door further in**, where 670 left it — the class name
    // is what a person read.
    const unwrapped = await rejectionOf(
      executeRuntimeCommand(aHostThatThrows(held), A_WINDOW, QUEUE),
    )
    expect(readableError(whatTheRendererGets(unwrapped))).toBe(
      `ACommandTakesNoAttachments: ${held.message}`,
    )
  })

  it('⚠️ …and it is the DOOR, not the class — `ProfileUnopenable` and a class added tomorrow lose their names too', async () => {
    class ANameNobodyHasWrittenYet extends Error {
      constructor() {
        super('something a person can act on')
        this.name = 'ANameNobodyHasWrittenYet'
      }
    }
    for (const error of [
      new ProfileUnopenable('that agent’s folder could not be opened'),
      new ANameNobodyHasWrittenYet(),
    ]) {
      const through = await rejectionOf(theRegisteredDoor(aHostThatThrows(error))(QUEUE))
      expect(readableError(whatTheRendererGets(through)), error.name).toBe(error.message)
      expect(readableError(whatTheRendererGets(error)), error.name).toContain(`${error.name}:`)
    }
  })

  it('⚑ a plain Error passes through the door as the SAME object — its prefix is the one the renderer strips', async () => {
    const plain = new Error('something a person can read')
    // ⚠️ **Thrown BY THE HOST, through the real door** — a command that fails to parse is refused by
    // the door's own plain Error before any host method runs, which would satisfy this by a
    // neighbour (review of `675`).
    const through = await rejectionOf(theRegisteredDoor(aHostThatThrows(plain))(QUEUE))
    expect(through).toBe(plain)
    expect(readableError(whatTheRendererGets(through))).toBe('something a person can read')
    // ⛔ …and a value that is not an Error at all is not invented into one.
    expect(withoutItsClassName('a string')).toBe('a string')
  })
})
