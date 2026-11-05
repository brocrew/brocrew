import { afterEach, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  chromeSubject,
  cleanupRetirementSubjects,
  personMetadata,
  legacyImportSubject,
} from './plugin-retirement-subjects'
afterEach(cleanupRetirementSubjects)
it.each([
  { action: 'create-profile', profile: 'birch' },
  { action: 'set-enabled', profile: 'birch', enabled: true },
  { action: 'open-window', profile: 'birch' },
  { action: 'delete-profile', profile: 'birch', confirm: 'birch' },
  { action: 'rename-profile', profile: 'birch', newName: 'Birch account' },
  { action: 'helper-on', profile: 'birch' },
  {
    action: 'set-flags',
    profile: 'birch',
    allowSync: false,
    allowExtensions: true,
    allowSettings: false,
    keepRunning: true,
  },
])('the real package executes only its explicitly named Configure action $action', async (args) => {
  const f = await chromeSubject()
  f.store.create('fern', 'panel')
  const opaque = join(f.store.dirOf('fern'), 'opaque-account')
  await writeFile(opaque, 'fictional retained account')
  if (args.action !== 'create-profile') f.store.create('birch', 'panel')
  if (args.action === 'helper-on') f.store.setFlags('birch', { enabled: true })
  await f.configure.execute(args, personMetadata)
  if (args.action === 'delete-profile') expect(f.store.get('birch')).toBeUndefined()
  else expect(f.store.get('birch')).toBeDefined()
  if (args.action === 'set-enabled') expect(f.store.get('birch')?.enabled).toBe(true)
  if (args.action === 'set-flags')
    expect(f.store.get('birch')).toMatchObject({
      allowSync: false,
      allowExtensions: true,
      allowSettings: false,
      keepRunning: true,
    })
  if (args.action === 'rename-profile')
    expect(f.store.get('birch')?.displayName).toBe('Birch account')
  if (args.action === 'open-window') expect(f.open).toHaveBeenCalledExactlyOnceWith('birch')
  if (args.action === 'helper-on') {
    expect(f.browser.helperTurnedOn).toEqual(['birch'])
    expect(f.store.get('birch')?.helper).toBe('turning-on')
  }
  expect(await readFile(opaque, 'utf8')).toBe('fictional retained account')
})
it.each([
  { action: 'open-window', profile: '../foreign' },
  { action: 'set-enabled', profile: 'birch', enabled: true, url: 'http://foreign.invalid/' },
  { action: 'delete-profile', profile: 'birch' },
  { action: 'delete-profile', profile: 'birch', confirm: 'fern' },
  { action: 'set-flags', profile: 'birch' },
  { action: 'set-flags', profile: 'birch', allowExtensions: 'true' },
  { action: 'helper-on', profile: 'birch', on: true },
])('the actual package refuses invalid Configure arguments before effects %j', async (args) => {
  const f = await chromeSubject()
  f.store.create('birch', 'panel')
  const before = f.store.list()
  await expect(f.configure.execute(args, personMetadata)).rejects.toThrow()
  expect(f.store.list()).toEqual(before)
  expect(f.open).not.toHaveBeenCalled()
  expect(f.browser.helperTurnedOn).toEqual([])
})
it('helper-on enforces its live enabled prerequisite rather than writing an app replay intent', async () => {
  const f = await chromeSubject()
  f.store.create('birch', 'panel')
  f.store.setFlags('birch', { enabled: false })
  await expect(
    f.configure.execute({ action: 'helper-on', profile: 'birch' }, personMetadata),
  ).rejects.toThrow(/Enable/)
  expect(f.browser.helperTurnedOn).toEqual([])
  f.store.setFlags('birch', { enabled: true })
  await f.configure.execute({ action: 'helper-on', profile: 'birch' }, personMetadata)
  expect(f.browser.helperTurnedOn).toEqual(['birch'])
})
it('current flags and destructive actions are absent from a consumed migration marker and do not replay', async () => {
  const f = await legacyImportSubject('chrome')
  await writeFile(
    join(f.directory, 'intents', '00000002.json'),
    JSON.stringify({
      action: 'delete-profile',
      profile: 'DO-NOT-REPLAY',
      confirm: 'DO-NOT-REPLAY',
      deleteConfirmation: 'a'.repeat(64),
    }),
  )
  const before = await f.inventory()
  f.import()
  const marker = await readFile(f.marker, 'utf8')
  expect(marker).not.toContain('delete-profile')
  expect(marker).not.toContain('confirm')
  expect(marker).not.toContain('DO-NOT-REPLAY')
  f.import()
  expect(await f.inventory()).toEqual(before)
})
it('actual MCP sanitizes an ambiguous opener failure and never retries the action', async () => {
  const f = await chromeSubject()
  f.store.create('birch', 'panel')
  f.open.mockRejectedValueOnce(new Error('fictional-private-diagnostic'))
  const { createChromeMcpServer } = await vi.importActual<{
    createChromeMcpServer(tools: unknown): {
      connect(transport: unknown): Promise<void>
      close(): Promise<void>
    }
  }>('../../../plugins/chrome/src/configuration')
  const server = createChromeMcpServer(f.tools),
    client = new Client({ name: 'fictional-configure', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  try {
    await client.connect(left)
    const result = await client.callTool({
      name: 'configure_profile',
      arguments: { action: 'open-window', profile: 'birch' },
      _meta: personMetadata,
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('fictional-private-diagnostic')
    expect(f.open).toHaveBeenCalledExactlyOnceWith('birch')
  } finally {
    await client.close()
    await server.close()
  }
})
it('the actual package tool schema admits named person deletion and rejects agent mutation', async () => {
  const f = await chromeSubject()
  f.store.create('birch', 'panel')
  expect(f.configure.definition.inputSchema.required).toEqual(
    expect.arrayContaining(['profile', 'action']),
  )
  expect(f.configure.definition.inputSchema.additionalProperties).toBe(false)
  await expect(
    f.configure.execute(
      { action: 'delete-profile', profile: 'birch', confirm: 'birch' },
      { ...personMetadata, origin: 'agent' },
    ),
  ).rejects.toThrow()
  expect(f.store.get('birch')).toBeDefined()
  await f.configure.execute(
    { action: 'delete-profile', profile: 'birch', confirm: 'birch' },
    personMetadata,
  )
  expect(f.store.get('birch')).toBeUndefined()
})
it('person rename updates only displayName and keeps the immutable profile selector', async () => {
  const f = await chromeSubject()
  f.store.create('birch', 'panel')
  const directory = f.store.dirOf('birch')
  await f.configure.execute(
    { action: 'rename-profile', profile: 'birch', newName: 'Birch account' },
    personMetadata,
  )
  expect(f.store.dirOf('birch')).toBe(directory)
  expect(f.store.get('birch')).toMatchObject({ name: 'birch', displayName: 'Birch account' })
})
it('the real package snapshot retains displayName and its stable selector', async () => {
  const f = await chromeSubject()
  f.store.create('birch', 'panel')
  await f.configure.execute(
    { action: 'rename-profile', profile: 'birch', newName: 'Birch account' },
    personMetadata,
  )
  expect((await f.snapshot()).profiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'birch', displayName: 'Birch account' }),
    ]),
  )
})
