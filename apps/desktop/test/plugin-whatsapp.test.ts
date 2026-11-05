import { afterEach, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  whatsappSubject,
  cleanupRetirementSubjects,
  personMetadata,
} from './plugin-retirement-subjects'
afterEach(cleanupRetirementSubjects)
const ROWING = '120363000000000001@g.us'
const context = { metadata: personMetadata }
it.each([
  ['whatsapp_link', {}],
  ['whatsapp_unlink', {}],
  ['whatsapp_refresh_groups', {}],
  ['whatsapp_set_read', { enabled: true }],
  ['whatsapp_set_prefix', { enabled: false }],
  ['whatsapp_set_group_write', { group: ROWING, enabled: true }],
] as const)(
  'the actual package owns Configure action %s and its resulting state',
  async (name, args) => {
    const f = await whatsappSubject()
    if (name === 'whatsapp_link') f.bridge.state = 'unlinked'
    const result = await f.tool(name).execute(args, context)
    expect(result.content[0]?.type).toBe('text')
    if (name === 'whatsapp_set_read') expect(f.settings.get().read).toBe(true)
    if (name === 'whatsapp_set_prefix') expect(f.settings.get().prefix).toBe(false)
    if (name === 'whatsapp_set_group_write') expect(f.settings.get().writable).toEqual([ROWING])
    if (name === 'whatsapp_unlink') expect(f.bridge.unlinked).toBe(1)
    if (name === 'whatsapp_refresh_groups')
      expect(f.bridge.requests).toEqual([{ route: '/groups', body: { refresh: true } }])
    if (name === 'whatsapp_link') expect(f.bridge.state).toBe('pairing')
  },
)
it.each([
  ['whatsapp_set_group_write', { group: '15550000001@s.whatsapp.net', enabled: true }],
  ['whatsapp_set_group_write', { group: '../foreign', enabled: true }],
  ['whatsapp_set_read', { enabled: 'yes' }],
  ['whatsapp_link', { url: 'http://foreign.invalid/' }],
  ['whatsapp_set_read', { enabled: true, text: 'Unreviewed field' }],
] as const)(
  'the real package rejects invalid fields/people before state effects %s %j',
  async (name, args) => {
    const f = await whatsappSubject(),
      before = f.settings.get()
    await expect(f.tool(name).execute(args, context)).rejects.toThrow()
    expect(f.settings.get()).toEqual(before)
    expect(f.bridge.requests).toEqual([])
    expect(f.bridge.unlinked).toBe(0)
  },
)
it('never retries an ambiguous actual package unlink failure', async () => {
  const f = await whatsappSubject()
  const unlink = vi
    .spyOn(f.bridge, 'unlink')
    .mockRejectedValueOnce(new Error('fictional lost reply'))
  await expect(f.tool('whatsapp_unlink').execute({}, context)).rejects.toThrow()
  expect(unlink).toHaveBeenCalledOnce()
})
it('explicit removal waits for the real package bridge logout and reports its result', async () => {
  const f = await whatsappSubject()
  let release!: () => void
  const unlink = vi.spyOn(f.bridge, 'unlink').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  let finished = false
  const work = f
    .tool('whatsapp_before_remove')
    .execute({}, { metadata: { ...personMetadata, origin: 'lifecycle.beforeRemove' } })
    .then((value) => {
      finished = true
      return value
    })
  await Promise.resolve()
  expect(finished).toBe(false)
  release()
  expect((await work).structuredContent).toMatchObject({ status: 'complete' })
  expect(unlink).toHaveBeenCalledOnce()
})
it('a failed package logout remains a failure rather than a local-data completion claim', async () => {
  const f = await whatsappSubject()
  vi.spyOn(f.bridge, 'unlink').mockRejectedValueOnce(new Error('fictional logout not completed'))
  await expect(
    f
      .tool('whatsapp_before_remove')
      .execute({}, { metadata: { ...personMetadata, origin: 'lifecycle.beforeRemove' } }),
  ).rejects.toThrow()
})
it('actual package snapshots retain link/switch/group state without bridge message bodies', async () => {
  const f = await whatsappSubject()
  f.settings.setRead(false)
  f.settings.setPrefix(true)
  f.settings.setWritable(ROWING, true)
  const result = await f.tool('whatsapp_settings').execute({}, context)
  const value = JSON.parse(result.content[0]!.text!)
  expect(value).toMatchObject({
    read: false,
    prefix: true,
    groups: expect.arrayContaining([expect.objectContaining({ jid: ROWING, canWrite: true })]),
  })
  expect(JSON.stringify(value)).not.toContain('Training moves to Thursday')
  expect(JSON.stringify(value)).not.toContain('members')
})
it('package validation refuses a person write target without changing saved choices', async () => {
  const f = await whatsappSubject(),
    path = join(f.home, 'settings.json')
  f.settings.setRead(false)
  const before = await readFile(path)
  await expect(
    f
      .tool('whatsapp_set_group_write')
      .execute({ group: '15550000001@s.whatsapp.net', enabled: true }, context),
  ).rejects.toThrow()
  expect(await readFile(path)).toEqual(before)
})
it('current package tool vocabularies expose no host registry cross-plugin actions', async () => {
  const f = await whatsappSubject()
  expect(f.tools.map((tool) => tool.definition.name)).not.toContain('configure_profile')
  expect(f.tools.map((tool) => tool.definition.name)).not.toContain('send-message')
  for (const tool of f.tools) {
    await expect(
      tool.execute({}, { metadata: { ...personMetadata, origin: 'agent' } }),
    ).rejects.toThrow()
  }
  expect(f.bridge.unlinked).toBe(0)
})
it('current package origin admission protects account tools without an app binding table', async () => {
  const f = await whatsappSubject()
  const before = f.settings.get()
  await expect(
    f
      .tool('whatsapp_set_read')
      .execute({ enabled: true }, { metadata: { ...personMetadata, origin: 'agent' } }),
  ).rejects.toThrow()
  expect(f.settings.get()).toEqual(before)
})
