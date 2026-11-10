import { describe, expect, it } from 'vitest'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import { DRAWER_TABS } from '../src/renderer/src/lib/drawer'
import { STATE_TOGGLES } from '../src/renderer/src/lib/library-filters'
import { ALL_PROVIDER_FOLDERS, A_PROVIDER_FOLDER, PROVIDER_NAME } from '../src/shared/runtime-ipc'

describe('what each folder sentence says instead of “provider home”', () => {
  it('the app’s own folders are named by the profile they belong to', () => {
    const info = DRAWER_TABS.find((tab) => tab.id === 'info')
    expect(info?.hint).toContain('profile')
    expect(info?.hint).not.toContain('provider home')
  })

  it('the user’s own folders are named by the program that keeps them', () => {
    for (const name of Object.values(PROVIDER_NAME)) {
      expect(ALL_PROVIDER_FOLDERS, `${name} must be in the sentence`).toContain(name)
      expect(A_PROVIDER_FOLDER, `${name} must be in the sentence`).toContain(name)
    }
    expect(ALL_PROVIDER_FOLDERS).toBe("Claude's and Codex's own folders")
    expect(A_PROVIDER_FOLDER).toBe("Claude's or Codex's own folder")

    const notImported = STATE_TOGGLES.find((toggle) => toggle.key === 'notImported')
    expect(notImported?.why).toBe("still only in Claude's or Codex's own folder")

    const said = describeUnavailable('read-only')
    expect(said).toContain(A_PROVIDER_FOLDER)
    expect(said).toContain('read and exported, but not continued here')
  })
})
