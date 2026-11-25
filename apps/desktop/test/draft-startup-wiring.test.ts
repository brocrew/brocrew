import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LAST_DRAFT_SAVE_CHANNEL } from '../src/shared/saved-drafts'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the wiring nothing mounts
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the wiring — `main.ts`, `RuntimeScreen` and main’s doors, which no test mounts', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('🔴 main’s doors, the existence question and the start-up keep are wired', () => {
    const index = read('../src/main/index.ts')
    expect(index).toMatch(
      /ipcMain\.handle\('app:save-drafts', \(event, saved: unknown\) => \{\n\s+const frame = event\.senderFrame\n\s+return writer\.write\(saved, frame && !frame\.isDestroyed\(\) \? frame\.frameToken : undefined\)/,
    )
    expect(index).toMatch(
      /const database = initDatabase\(\)\n\s+const drafts = createSqliteDraftStorage\(database\)\n\s+host = await createRuntimeHost\(database, drafts\)\n\s+finishStartupPhase\(\)\n\s+registerIpc\(host, localZone, drafts\)/,
    )
    expect(index).toMatch(/return composeRuntimeHost\(database, \{[^}]*\bdrafts,\n/)
    expect(index).toMatch(/const writer = createDraftWriter\(drafts\)\n\s+draftWriter = writer\n/)
    expect(index).toMatch(/return restoreSavedDrafts\(drafts\.read\(\), \{\n/)
    expect(index).toMatch(
      /reader\.once\('render-process-gone', forget\)\n\s+reader\.once\('destroyed', forget\)/,
    )
    expect(index).toContain('draftReaders.set(reader.id, frame.frameToken)')
    expect(index).toMatch(/if \(outcome === 'failed'\) throw /)
    expect(index).toMatch(
      /exists: \(sessionId\) => recordedConversation\?\.\(sessionId\) \?\? true,/,
    )
    expect(read('../src/main/runtime-host-composition.ts')).toMatch(
      /keepDraftedPastes\(drafts, userData, Date\.now\(\)\)\n\s+void sweepPastedImages\(pastedImagesRoot\(userData\), Date\.now\(\)\)[\s\S]*\n\s+keepRecordedConversation\(\(sessionId\) => databaseClosed\(\) \|\| store\.recordedOne\(sessionId\) !== null\)\n/,
    )
    expect(index).toMatch(
      /databaseClosed: \(\) => db === null,\n\s+keepRecordedConversation: \(recorded\) => \{\n\s+recordedConversation = recorded\n/,
    )
    // ⚑ …and the preload knocks on the two doors main opened, by the same names
    const preload = read('../src/preload/index.ts')
    for (const channel of ['app:saved-drafts', 'app:save-drafts']) {
      expect(index).toContain(`ipcMain.handle('${channel}'`)
      expect(preload).toContain(`ipcRenderer.invoke('${channel}'`)
    }
    expect(preload).toMatch(/ipcRenderer\.on\(LAST_DRAFT_SAVE_CHANNEL, forward\)/)
    expect(LAST_DRAFT_SAVE_CHANNEL).toBe('app:last-draft-save')
    // ⚑ …and the screen answers it — the bridge's door handed to the keeper
    expect(read('../src/renderer/src/lib/kept-drafts.ts')).toMatch(
      /onLastSave: bridge\?\.onLastDraftSave,/,
    )
  })
})
