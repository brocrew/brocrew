import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { cleanupLifecycleFixtures, deferred, fixture } from './plugin-lifecycle-fixtures'
import { packageFixture, signed } from './plugin-package-fixtures'

afterEach(cleanupLifecycleFixtures)
it('computes B prepare after an unrelated choice commits during the actual controller download', async () => {
  const f = await fixture({}, false, 'fictional-fern')
  await f.controller.install(f.handle, 'fictional-fern')
  const initial = f.state.currentInstallation('fictional-fern')!
  const other = packageFixture({ manifest: { ...f.pkg.manifest, id: 'fictional-moss' } })
  f.opts.catalogue = signed({ format: 1, entries: [f.pkg.release, other.release] })
  const entered = deferred<number>(),
    release = deferred<void>()
  let held = false
  f.opts.download = async (releaseDescriptor) => {
    if (releaseDescriptor.id !== 'fictional-moss') return f.pkg.archive
    held = true
    entered.resolve(f.state.inspect().sequence)
    await release.promise
    held = false
    return other.archive
  }
  const installing = f.controller.install(f.handle, 'fictional-moss')
  const result = installing.then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error }),
  )
  try {
    const before = await Promise.race([
      entered.promise,
      result.then(() => {
        throw new Error('B did not reach the actual controller download')
      }),
    ])
    expect(held).toBe(true)
    await expect(f.controller.setTitlesEnabled(f.handle, 'fictional-fern', true)).resolves.toEqual({
      enabled: true,
      revision: 1,
    })
    expect(f.state.inspect().sequence).toBeGreaterThan(before)
    expect(f.state.inspect().pending).toBeNull()
    expect(f.state.currentInstallation('fictional-fern')).toEqual(initial)
    expect(held).toBe(true)
  } finally {
    release.resolve()
    await result
  }
  expect(await result).toEqual({ ok: true })
  expect(f.state.currentInstallation('fictional-moss')?.pluginId).toBe('fictional-moss')
  expect(f.state.currentInstallation('fictional-fern')).toEqual(initial)
  expect(f.state.getTitlesEnabled(f.local.sink.workspaceId, 'fictional-fern')).toEqual({
    enabled: true,
    revision: 1,
  })
  const bytes = JSON.parse(await readFile(join(f.root, 'state', 'installed-state.json'), 'utf8'))
  expect(bytes.pending).toBeNull()
  expect(bytes.active.map((entry: { pluginId: string }) => entry.pluginId).sort()).toEqual([
    'fictional-fern',
    'fictional-moss',
  ])
})

it('aborts a held controller download at drain before preparing an operation', async () => {
  const f = await fixture({}, false, 'fictional-fern')
  const entered = deferred<AbortSignal>(),
    release = deferred<void>()
  f.opts.download = async (_release, signal) => {
    entered.resolve(signal)
    // An inert downloader deliberately ignores abort until the test releases it.
    await release.promise
    return f.pkg.archive
  }
  const operation = randomUUID()
  const bytes = await readFile(join(f.root, 'state/installed-state.json')).catch(() => null)
  const installing = f.controller.install(f.handle, 'fictional-fern', operation).then(
    () => true,
    () => false,
  )
  const signal = await entered.promise
  try {
    await f.controller.drain()
    expect(signal.aborted).toBe(true)
    expect(await installing).toBe(false)
    expect(f.state.inspect().pending).toBeNull()
    expect(f.state.operation(operation)).toBeUndefined()
    expect(f.starts()).toBe(0)
    expect(await readFile(join(f.root, 'state/installed-state.json')).catch(() => null)).toEqual(
      bytes,
    )
  } finally {
    release.resolve()
    await installing
  }
  expect(f.state.currentInstallation('fictional-fern')).toBeNull()
  expect(f.state.operation(operation)).toBeUndefined()
})
