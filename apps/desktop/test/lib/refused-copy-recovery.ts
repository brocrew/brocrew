import { expect, vi } from 'vitest'
import type { RuntimeHost, RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import type { StandInCodex } from './refused-codex-stand-in'

interface RefusedCopyFixture {
  codex: StandInCodex
  starts: string[]
  held(): string
  writer: { reached: number }
  oldDigest: string
  freshDigest: string
}

export async function waitsForRefusedExit(
  fixture: RefusedCopyFixture,
  prepare: () => Promise<void>,
): Promise<void> {
  const { codex, held, starts, writer, oldDigest, freshDigest } = fixture
  await prepare()
  let exited!: () => void
  const exit = new Promise<void>((resolve) => {
    exited = resolve
  })
  const handle = codex.handles[0]!
  handle.awaitProcessExit = () => exit
  const closing = vi.spyOn(handle, 'close')
  try {
    await handle.runTurnRefusedOnItsLogin()
    await vi.waitFor(() => expect(closing).toHaveBeenCalled())
    expect(handle.status()).toBe('ended')
    expect(held()).toBe(oldDigest)
    expect(writer.reached).toBe(0)
  } finally {
    exited()
  }
  await vi.waitFor(() => expect(starts).toEqual([oldDigest, freshDigest]))
  expect(held()).toBe(freshDigest)
}

export async function copiesAfterWorkingSibling(
  fixture: RefusedCopyFixture & {
    host: RuntimeHost
    start(): ReturnType<RuntimeHost['createSession']>
    sink(): RuntimeEventSink
    newer(): void
  },
): Promise<void> {
  const { host, codex, starts, held, writer, oldDigest, freshDigest } = fixture
  await fixture.start()
  const sibling = await fixture.start()
  const failedHandle = codex.handles[0]!
  const siblingHandle = codex.handles[1]!
  const siblingClosed = vi.spyOn(siblingHandle, 'close')
  const failedClosed = vi.spyOn(failedHandle, 'close')
  fixture.newer()
  codex.turnModes.push('held-open')
  await host.send(sibling.sessionId, 'finish this sibling turn before copying', fixture.sink())
  await vi.waitFor(() => expect(siblingHandle.status()).toBe('working'))
  await failedHandle.runTurnRefusedOnItsLogin()
  await vi.waitFor(() => expect(failedClosed).toHaveBeenCalled())
  expect(siblingClosed).not.toHaveBeenCalled()
  expect(writer.reached).toBe(0)
  expect(held()).toBe(oldDigest)
  let newStartFinished = false
  const nextStart = fixture.start().then(() => {
    newStartFinished = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(newStartFinished).toBe(false)
  expect(starts).toEqual([oldDigest, oldDigest])

  codex.answerTheOpenTurn()

  await vi.waitFor(() => expect(held()).toBe(freshDigest))
  await nextStart
  await vi.waitFor(() =>
    expect(starts).toEqual([oldDigest, oldDigest, freshDigest, freshDigest, freshDigest]),
  )
  expect(newStartFinished).toBe(true)
  expect(siblingClosed).toHaveBeenCalledTimes(1)
  expect(writer.reached).toBe(1)
}

export async function copiesARefusedTurn(
  fixture: RefusedCopyFixture,
  prepare: () => Promise<void>,
  refuseFresh?: () => void,
): Promise<void> {
  const { codex, starts, held, oldDigest, freshDigest } = fixture
  await prepare()
  refuseFresh?.()
  await codex.handles[0]!.runTurnRefusedOnItsLogin()
  await vi.waitFor(() => expect(starts).toEqual([oldDigest, freshDigest]))
  if (refuseFresh !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(starts).toEqual([oldDigest, freshDigest])
  }
  expect(held()).toBe(freshDigest)
}
