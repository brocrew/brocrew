import { createProviderModules } from '../../src/main/providers'

/** Bind real provider modules while making any launch-time read fail the caller's control. */
export function unstartedProviderModules(unread: () => never, managedRoot: string) {
  return createProviderModules(
    () => ({
      managedRoot,
      defaultProfile: 'fern',
      homeOf: unread,
      profiles: unread,
      assertMayOpen: unread,
    }),
    {
      claude: { runtime: { program: unread }, home: {}, auth: {} },
      codex: { runtime: { command: unread }, home: {}, auth: { command: unread } },
    },
  )
}
