import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  profileExecutionFile,
  readProfileExecution,
  writeProfileExecution,
} from '../src/main/profile-execution-file'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

let world: AServiceWorld | undefined
afterEach(async () => {
  await world?.cleanUp()
})

it('refuses a reserved service whose prepared folder differs before any runtime starts', async () => {
  world = aServiceWorld()
  const own = world
  const service = own.anAgent('fern')
  own.anAgent('caller', 'nothing kept')
  mkdirSync(join(own.folder, 'work'))
  own.store.create({
    id: 'sess_reserved_fern',
    provider: 'claude',
    profileId: 'fern',
    cwd: join(own.folder, 'work'),
    approvalMode: 'ask',
    service: true,
    providerLocation: 'default/fern/claude',
  })
  const file = profileExecutionFile(own.folder)
  const kept = readProfileExecution(file)
  if (!kept.readable) throw new Error('fictional services file unreadable')
  writeProfileExecution(file, {
    profiles: {
      ...kept.kept.profiles,
      [service.id]: {
        ...kept.kept.profiles[service.id]!,
        serviceConversation: 'sess_reserved_fern',
      },
    },
  })
  const root = join(own.folder, 'provider-homes')
  const preparations: string[] = []
  const host = own.aHost({
    homePaths: {
      providerHomesRoot: () => root,
      providerHomePath: (provider, profile) => join(root, 'default', profile, provider),
      prepareProviderHome: (provider, profile) => {
        const home = join(root, 'default', profile === 'fern' ? 'other' : profile, provider)
        preparations.push(profile)
        mkdirSync(home, { recursive: true })
        return home
      },
    },
  })
  const caller = await own.aPersonOpens(host, 'caller')
  const given = await own.gives(host, caller, 'fern')
  expect(given.ok && given.owner).toBe('sess_reserved_fern')
  await vi.waitFor(() =>
    expect(
      own
        .ledger('sess_reserved_fern')
        .some((row) => row.type === 'message_unqueued' && row.reason === 'abandoned'),
    ).toBe(true),
  )
  expect(preparations.filter((profile) => profile === 'fern')).toHaveLength(1)
  expect(own.startedAs).toEqual(['caller'])
  expect(own.handles.map((handle) => handle.as)).toEqual(['caller'])
  expect(own.store.providerLocationOf('sess_reserved_fern')).toBe('default/fern/claude')
})
