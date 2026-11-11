import type { AdoptionReport, LibraryEntry, LibraryPage, LibraryQuery } from '../../src/shared/runtime-ipc'

export const NOW = Date.now()

export const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'claude:thread-1',
  provider: 'claude',
  providerSessionId: 'thread-1',
  recordId: 'sess_1',
  cwd: '/work/alpha',
  title: 'Refactor the authentication module',
  preview: 'Can you help me refactor the authentication module?',
  createdAt: NOW - 7_200_000,
  updatedAt: NOW - 3_600_000,
  bytes: 1_048_576,
  origin: 'user-home',
  onDisk: true,
  readable: true,
  derived: null,
  lastEnding: 'completed',
  unresumableReason: null,
  child: null,
  ...over,
})

/**
 * Five rows, and the mix matters.
 *
 * `codex-behind` is the one row with something to say about completeness — it is the paired
 * positive for "no amber in the filter surface", because it proves the amber ramp still works on
 * this page while the facet row is on screen and filtered.
 *
 * ⚠️ **`claude-nickname` carries a nickname and NO role, because the role form is effectively
 * dead** (§5.1, measured in `114`/`115`): 16 of 827 children carry one, every one written before
 * 2026-07-20, and the provider writes the field explicitly null now. 808 of 827 are nicknamed. A
 * fixture teaching the `(role)` shape would be teaching a shape nothing new will ever take.
 */
const ROWS: LibraryEntry[] = [
  // ⚠️ **An `ours` row as `recordedEntry` actually builds one** (review): no home offered it, so
  // there is no title, no preview, no size and no file on disk. The first version inherited all
  // four from the default and was a shape main-side cannot produce — inert here, but a fixture
  // that teaches a wrong shape is how the next test comes to assert one.
  entry({
    id: 'claude:a',
    title: '',
    preview: '',
    bytes: null,
    onDisk: false,
    origin: 'ours',
    derived: 'current',
  }),
  entry({
    id: 'codex:behind',
    provider: 'codex',
    title: 'Imported and behind its archive',
    derived: 'stale',
  }),
  entry({
    id: 'codex:nickname',
    provider: 'codex',
    title: 'A conversation another agent drove',
    child: { parentSessionId: 'thread-parent', depth: 1, nickname: 'Turing', role: null },
    unresumableReason: 'a sub-agent conversation — another agent drove it',
  }),
  entry({
    id: 'claude:unimported',
    recordId: null,
    readable: false,
    title: 'Never imported, still over there',
    unresumableReason: 'it has not been imported yet — import it to read it here',
  }),
  entry({ id: 'claude:only', onDisk: false, bytes: null, title: 'The provider deleted its copy' }),
]

export const page = (over: Partial<LibraryPage> = {}): LibraryPage => ({
  entries: ROWS,
  matched: ROWS.length,
  counts: {
    total: 2027,
    ours: 231,
    userHome: 1796,
    restored: 0,
    imported: 1674,
    notImported: 122,
    onlyHere: 14,
    // The Provider facet's options — the backend's tally, because the renderer may not know a
    // provider's name (039). Two of them, so the menu is a real choice.
    providers: [
      { provider: 'codex', total: 1060 },
      { provider: 'claude', total: 967 },
    ],
  },
  skipped: [],
  skippedTotal: 0,
  ...over,
})

type LibraryApi = {
  runtime: {
    listLibrary: (input: LibraryQuery) => Promise<LibraryPage>
    adoptSessions: () => Promise<AdoptionReport>
    listResumable: () => Promise<never[]>
    listUnresumable: () => Promise<never[]>
    importUserHomeSession: () => Promise<never>
    rebuildLedger: () => Promise<never>
  }
}

export const stubbed = (): { api?: LibraryApi } => window as unknown as { api?: LibraryApi }

/** Every read the surface made, in order — how a test sees that a click reached the main process. */
let reads: LibraryQuery[] = []
/** How many times the shared scan was actually run. */
export let scans = 0

const REPORT: AdoptionReport = {
  found: 9,
  adopted: 1,
  alreadyKnown: 8,
  imported: 0,
  descentsLearned: 8,
  named: 0,
  skipped: [],
}

export function stub(answer: (query: LibraryQuery) => LibraryPage = () => page()): void {
  reads = []
  scans = 0
  stubbed().api = {
    runtime: {
      listLibrary: (input) => {
        /**
         * ⚠️ **`structuredClone`, deliberately — it is the algorithm the real wire uses.**
         * `ipcRenderer.invoke` clones its payload, and a Vue reactive proxy is not cloneable, so a
         * stub that merely stored the reference would have accepted an argument Electron refuses.
         * That is exactly what it caught: the surface was sending `filters.value` — a proxy — and
         * every filter press would have failed at the boundary with "an object could not be
         * cloned", showing the read-failed banner about a read it never made.
         */
        reads.push(structuredClone(input))
        return Promise.resolve(answer(input))
      },
      adoptSessions: () => {
        scans++
        return Promise.resolve(REPORT)
      },
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
      importUserHomeSession: () => Promise.reject(new Error('not used here')),
      rebuildLedger: () => Promise.reject(new Error('not used here')),
    },
  }
}

export function countScan(): void {
  scans++
}
