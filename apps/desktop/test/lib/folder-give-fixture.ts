import type { CallerIdentity, RuntimeHost } from '../../src/main/runtime/runtime-host'

export async function firstGiveInFolder(
  host: Pick<RuntimeHost, 'giveWork'>,
  by: CallerIdentity,
  folder: string,
  profile = 'pm',
) {
  const first = await host.giveWork(
    {
      to: 'new',
      conversation_title: 'the first piece',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: 'the first piece',
      brief: 'start here',
      folder,
    },
    by,
  )
  if (!first.ok) throw new Error(`refused: ${first.refusal.rail}`)
  return first
}
