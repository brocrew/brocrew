// The host integration test loads package implementations through Vitest at runtime.
// Keep this fixture contract free of implementation imports; the package project checks it.
export interface TestProfiles {
  create(name: string, by: 'panel'): unknown
  setFlags(name: string, flags: { enabled: boolean }): unknown
  get(name: string): { enabled: boolean } | undefined
  dirOf(name: string): string
}
export function profileFixtureDeps<Store, Browser, Tabs, Logger>(
  store: Store,
  browser: Browser,
  tabs: Tabs,
  logger: Logger,
) {
  return {
    store,
    browser,
    tabs,
    logger,
    windows: {} as never,
    opener: {
      async open(): Promise<never> {
        throw new Error('No browser is launched')
      },
    },
    version: 'fictional',
  }
}
