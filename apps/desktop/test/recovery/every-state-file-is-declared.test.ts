import { describe, expect, it } from 'vitest'
import { RESTORE_RULES } from '../../src/main/recovery/contract'
import { DATABASE_FILE, familyOf, isSafeName } from '../../src/main/recovery/layout'
import { APP_STATE_FILES, NOT_STATE } from '../../src/main/recovery/state-files'

function declared(name: string): boolean {
  if (APP_STATE_FILES.some((file) => file.name === name)) return true
  return NOT_STATE.some((entry) => {
    if (entry.name === name) return true
    if (!entry.name.includes('*')) return false
    const pattern = entry.name
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp(`^${pattern}$`).test(name)
  })
}

describe('the registry', () => {
  const every = [...APP_STATE_FILES, ...NOT_STATE]

  it('names each thing once, with a reason', () => {
    const names = every.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    for (const entry of every) expect(entry.why.trim().length, entry.name).toBeGreaterThan(10)
  })

  it('gives each state file a restore rule and a name that is one plain file name', () => {
    for (const file of APP_STATE_FILES) {
      expect(RESTORE_RULES, file.name).toContain(file.restore)
      expect(isSafeName(file.name), file.name).toBe(true)
    }
    expect(APP_STATE_FILES.find((file) => file.name === 'drafts.json')?.restore).toBe(
      'with-the-database',
    )
  })

  it('keeps the database and its sidecars out of the state files', () => {
    for (const member of familyOf(DATABASE_FILE)) expect(declared(member), member).toBe(true)
    for (const member of familyOf(DATABASE_FILE)) {
      expect(APP_STATE_FILES.some((file) => file.name === member)).toBe(false)
    }
  })
})
