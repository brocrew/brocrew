const definitionOfDone = 'The requested result and its checks are recorded.'

export function newConversationGive(profile: string, title: string, brief: string) {
  return {
    to: 'new',
    conversation_title: title,
    definition_of_done: definitionOfDone,
    profile,
    title,
    brief,
  }
}

export async function openPmWithSeededWorker(
  open: (profile: string) => Promise<string>,
  close: (conversation: string) => Promise<unknown>,
) {
  await close(await open('worker'))
  return open('pm')
}

export function giveWorkBeforeProviderStart(
  send: (name: 'give_work', args: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  return send('give_work', newConversationGive('worker', 'The work', 'the work'))
}
