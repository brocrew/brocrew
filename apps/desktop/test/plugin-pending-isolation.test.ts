import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

afterEach(cleanupLifecycleFixtures)
it.each(['install', 'update', 'uninstall'] as const)(
  'keeps an unrelated installed plugin and captured route usable during pending %s',
  async (action) => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const workspaceId = f.local.sink.workspaceId
    const view = f.controller.agentAttachments(workspaceId)[0]!
    const receipt = f.state.projections(workspaceId)[0]!
    if (action !== 'install') {
      const seed = randomUUID()
      f.state.prepare({
        operationId: seed,
        snapshot: null,
        consent: {
          action: 'install',
          pluginId: 'fictional-orchard',
          at: 1,
          expectedSequence: f.state.inspect().sequence,
          expectedInstallId: null,
          release: {
            version: '1.0.0',
            archiveSha256: 'a'.repeat(64),
            manifestSha256: 'b'.repeat(64),
            dataSchema: 1,
          },
        },
      })
      f.state.complete(seed)
    }
    const backup = f.state.exportActivation()
    const operationId = randomUUID()
    f.state.prepare({
      operationId,
      snapshot: null,
      consent: {
        action,
        pluginId: 'fictional-orchard',
        at: 1,
        expectedSequence: f.state.inspect().sequence,
        expectedInstallId:
          f.state.inspect().guards.find((one) => one.pluginId === 'fictional-orchard')?.installId ??
          null,
        release:
          action === 'uninstall'
            ? null
            : {
                version: '1.0.0',
                archiveSha256: 'a'.repeat(64),
                manifestSha256: 'b'.repeat(64),
                dataSchema: 1,
              },
      },
    })
    expect(f.state.currentInstallation('fictional-orchard')).toBeNull()
    expect(f.state.currentInstallations().map((one) => one.pluginId)).toEqual(['chrome'])
    expect(f.state.currentInstallation('chrome')?.installId).toBe(receipt.installId)
    expect(f.state.matchesProjection(receipt, workspaceId)).toBe(true)
    expect(view.current()).toBe(true)
    expect(f.controller.admitted(f.handle, 'chrome', receipt.installId)).toBe(true)
    expect(f.controller.agentAttachments(workspaceId)[0]?.runId).toBe(view.runId)
    expect((await f.controller.status()).cards.find((card) => card.id === 'chrome')).toMatchObject({
      installed: true,
      state: 'Running',
    })
    f.state.abort(operationId)
    const restore = randomUUID()
    f.state.prepare({
      operationId: restore,
      snapshot: backup,
      consent: {
        action: 'global-restore',
        pluginId: null,
        at: 1,
        expectedSequence: f.state.inspect().sequence,
        expectedInstallId: null,
        release: null,
      },
    })
    expect(f.state.currentInstallations()).toEqual([])
    expect(f.state.currentInstallation('chrome')).toBeNull()
    expect(f.state.matchesProjection(receipt, workspaceId)).toBe(false)
    expect(view.current()).toBe(false)
    f.state.abort(restore)
    expect(view.current()).toBe(true)
  },
)
