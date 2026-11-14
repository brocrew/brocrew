import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  nativeWorkspaceFromRegistry,
  nativeWorkspaceReceipts,
  nativeWorkspaceStartup,
} from '../mac-native-workspace.mjs'

const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function fixtures() {
  const root = mkdtempSync(join(tmpdir(), 'native-workspace-'))
  folders.push(root)
  return ['Default', 'WorkspaceB'].map((name) => ({
    name,
    data: join(root, name),
    baseline: { workspaceId: name, copiesBefore: [`${name}-old`] },
  }))
}

it('chooses the latest registered fixture without changing the registry or using click order', () => {
  const workspaces = fixtures()
  const registry = {
    workspaces: [
      { path: workspaces[0].data, lastOpenedAt: 10 },
      { path: workspaces[1].data, lastOpenedAt: 20 },
    ],
  }
  const before = structuredClone(registry)
  expect(nativeWorkspaceFromRegistry(registry, workspaces)).toBe(workspaces[1])
  expect(nativeWorkspaceFromRegistry(registry, [...workspaces].reverse())).toBe(workspaces[1])
  expect(registry).toEqual(before)
  const defaultLatest = structuredClone(registry)
  defaultLatest.workspaces[0].lastOpenedAt = 30
  expect(nativeWorkspaceFromRegistry(defaultLatest, workspaces)).toBe(workspaces[0])
  for (const rows of [[], [{ path: '/uncaptured', lastOpenedAt: 30 }]])
    expect(() => nativeWorkspaceFromRegistry({ workspaces: rows }, workspaces)).toThrow(
      'The native startup workspace is not one of the captured fixtures.',
    )
})

it.each([
  'read-error',
  'copy-error',
  'receipt-workspace',
  'copy-workspace',
  'copy-source',
  'copy-version',
  'missing-copy',
])(
  'retains a failed native startup rather than attributing another workspace: %s',
  async (kind) => {
    const workspaces = fixtures(),
      workspace = workspaces[1]
    const diagnostic = { restarted: { pid: 456 }, workspace: { path: workspace.data } }
    const failure = new Error('first-start receipt timeout')
    const startup = { workspaceId: kind === 'receipt-workspace' ? 'Default' : 'WorkspaceB' }
    const readReceipt = vi.fn(async () => {
      if (kind === 'read-error') throw failure
      return startup
    })
    const completedCopy = vi.fn(async () =>
      kind === 'missing-copy'
        ? null
        : {
            manifest: {
              id: 'candidate-copy',
              workspaceId: kind === 'copy-workspace' ? 'Default' : 'WorkspaceB',
              madeBy: {
                appVersion: kind === 'copy-version' ? 'old' : 'next',
                build: kind === 'copy-source' ? 'other-source' : 'candidate-source',
              },
            },
          },
    )
    if (kind === 'copy-error') completedCopy.mockRejectedValueOnce(failure)
    const result = nativeWorkspaceStartup(
      workspace,
      { version: 'next', source: 'candidate-source', checkpoint: true },
      { readReceipt, completedCopy, workspaces, diagnostic },
    )
    if (['read-error', 'copy-error'].includes(kind)) await expect(result).rejects.toBe(failure)
    else
      await expect(result).rejects.toThrow(
        kind === 'receipt-workspace'
          ? 'receipt belongs to another workspace'
          : 'candidate recovery copy in this workspace',
      )
    expect(readReceipt).toHaveBeenCalledExactlyOnceWith(workspace.data, 'next')
    if (['read-error', 'receipt-workspace'].includes(kind))
      expect(completedCopy).not.toHaveBeenCalled()
    else
      expect(completedCopy).toHaveBeenCalledExactlyOnceWith(
        workspace.data,
        new Set(['WorkspaceB-old']),
      )
    expect(diagnostic.restarted).toEqual({ pid: 456 })
    expect(diagnostic.receipts.map((one) => one.path)).toEqual(workspaces.map((one) => one.data))
    expect(diagnostic.receipts.every((one) => one.error.includes('ENOENT'))).toBe(true)
  },
)

it('retains receipt metadata and records a malformed receipt alongside the other workspace', async () => {
  const workspaces = fixtures()
  for (const workspace of workspaces)
    mkdirSync(join(workspace.data, 'backups'), { recursive: true })
  writeFileSync(join(workspaces[0].data, 'backups', 'retention.json'), '{unfinished')
  writeFileSync(
    join(workspaces[1].data, 'backups', 'retention.json'),
    JSON.stringify({
      appVersion: 'next',
      workspaceId: 'WorkspaceB',
      checkpointId: 'historical-copy',
      successfulStarts: 1,
      unrelated: 'not receipt metadata',
    }),
  )
  const facts = await nativeWorkspaceReceipts(workspaces)
  expect(facts[0].error).toBeDefined()
  expect(facts[1]).toEqual({
    name: 'WorkspaceB',
    path: workspaces[1].data,
    appVersion: 'next',
    workspaceId: 'WorkspaceB',
    checkpointId: 'historical-copy',
    successfulStarts: 1,
  })
})
