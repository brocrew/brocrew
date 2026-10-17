import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import type { LibraryEntry, LibraryPage } from '../../src/shared/runtime-ipc'
import { scene } from '../capture'

const NOW = Date.now()
const TITLES = ['Landing page header', 'Contact form validation', 'Review the release notes']
const ENTRIES: LibraryEntry[] = TITLES.map((title, i) => ({
  id: `sample::${i}`,
  provider: i === 1 ? 'codex' : 'claude',
  providerSessionId: `sample-thread-${i}`,
  recordId: `sample-record-${i}`,
  cwd: '/work/sample-site',
  title,
  preview: 'Review the sample project and explain the proposed changes.',
  createdAt: NOW - 3_600_000 * (i + 2),
  updatedAt: NOW - 60_000 * (i + 12),
  bytes: 32_768,
  origin: 'user-home',
  onDisk: true,
  readable: true,
  derived: 'current',
  lastEnding: 'completed',
  unresumableReason:
    'This conversation can be read here but cannot be reopened from this workspace.',
  child: null,
}))
const PAGE: LibraryPage = {
  entries: ENTRIES,
  matched: ENTRIES.length,
  counts: {
    total: 3,
    ours: 0,
    userHome: 3,
    restored: 0,
    imported: 3,
    notImported: 0,
    onlyHere: 0,
    providers: [
      { provider: 'claude', total: 2 },
      { provider: 'codex', total: 1 },
    ],
  },
  skipped: [],
  skippedTotal: 0,
}

/** 🎨 The same list with its provider filter set, so an active filter chip is drawn. */
scene('all-conversations-filtered', async (stage) => {
  window.api = {
    runtime: {
      listLibrary: async () => PAGE,
      listResumable: async () => [],
      listUnresumable: async () => [],
    },
  } as never
  const m = stage.mount(SessionLibrary, {})
  await new Promise((done) => setTimeout(done, 80))
  const select = m.host.querySelector<HTMLSelectElement>('[data-cy="library-facet-provider"]')!
  select.value = 'codex'
  select.dispatchEvent(new Event('change'))
  await new Promise((done) => setTimeout(done, 80))
})
