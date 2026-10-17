import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  forgetPersistentPreference,
  usePersistentToggle,
  type ToggleStorage,
} from '../src/renderer/src/composables/usePersistentToggle'

/**
 * A collapsed panel that springs back open on every reload is worse than one that
 * never collapsed, so the preference is stored — but a view preference must never be
 * the thing that breaks the screen, which is what the failure cases below pin.
 */

function fakeStorage(seed: Record<string, string> = {}): ToggleStorage & { data: typeof seed } {
  const data = { ...seed }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
    removeItem: (key) => {
      delete data[key]
    },
  }
}

describe('usePersistentToggle', () => {
  it('starts from the given default when nothing was ever stored', () => {
    expect(usePersistentToggle('k', true, fakeStorage()).value).toBe(true)
    expect(usePersistentToggle('k', false, fakeStorage()).value).toBe(false)
  })

  it('restores what was stored, over the default', () => {
    expect(usePersistentToggle('k', true, fakeStorage({ k: 'false' })).value).toBe(false)
    expect(usePersistentToggle('k', false, fakeStorage({ k: 'true' })).value).toBe(true)
  })

  it('writes the change, so the next load restores it', async () => {
    const storage = fakeStorage()
    const open = usePersistentToggle('brobot2.panel', true, storage)

    open.value = false
    await nextTick()

    expect(storage.data['brobot2.panel']).toBe('false')
    expect(usePersistentToggle('brobot2.panel', true, storage).value).toBe(false)
  })

  it('treats a value it did not write as no preference rather than guessing', () => {
    expect(usePersistentToggle('k', true, fakeStorage({ k: 'yes please' })).value).toBe(true)
    expect(usePersistentToggle('k', false, fakeStorage({ k: '' })).value).toBe(false)
  })

  it('works with no storage at all — a test process or a locked-down renderer', () => {
    const toggle = usePersistentToggle('k', true, null)
    expect(toggle.value).toBe(true)

    expect(() => (toggle.value = false)).not.toThrow()
    // The point is not just that it survived: the toggle still has to WORK.
    expect(toggle.value).toBe(false)
  })

  it('survives storage that throws on read and on write', async () => {
    const hostile: ToggleStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }

    const toggle = usePersistentToggle('k', true, hostile)
    expect(toggle.value).toBe(true)

    toggle.value = false
    await nextTick()
    expect(toggle.value).toBe(false) // the UI still works; only the persistence is lost
  })
})

/**
 * **344 · A preference the app has stopped having.**
 *
 * Bodies stay light while headers and left menus stay dark. Removing the read of
 * `brobot2.chatLightTheme` prevents a stale setting from forcing a dark body; deleting the
 * localStorage key separately removes a value whose product meaning is retired.
 */
describe('forgetPersistentPreference', () => {
  it('removes a stored value, so a later read finds no preference at all', () => {
    const storage = fakeStorage({ 'brobot2.chatLightTheme': 'true' })
    forgetPersistentPreference('brobot2.chatLightTheme', storage)

    expect(storage.data['brobot2.chatLightTheme']).toBeUndefined()
    // ⚑ The claim that matters, said the way a reader would ask it: whatever reaches for this key
    // next gets the same answer a machine that never pressed the toggle gives.
    expect(usePersistentToggle('brobot2.chatLightTheme', false, storage).value).toBe(false)
    expect(usePersistentToggle('brobot2.chatLightTheme', true, storage).value).toBe(true)
  })

  it('leaves every other preference alone', () => {
    // ⛔ The pairing, and it is not decorative: `debugMode` and `drawerOpen` live one key away, and
    // a forget that took the wrong thing would look exactly like a success here.
    const storage = fakeStorage({
      'brobot2.chatLightTheme': 'false',
      'brobot2.debugMode': 'true',
      'brobot2.drawerOpen': 'true',
    })
    forgetPersistentPreference('brobot2.chatLightTheme', storage)

    expect(Object.keys(storage.data).sort()).toEqual(['brobot2.debugMode', 'brobot2.drawerOpen'])
  })

  it('is silent about a key that was never there, and about storage that will not have it', () => {
    // Three shapes of "nothing to do", and none of them may throw: a machine that never pressed the
    // toggle, a renderer with storage disabled, and a stub old enough not to have `removeItem`.
    const fresh = fakeStorage({ 'brobot2.debugMode': 'true' })
    expect(() => forgetPersistentPreference('brobot2.chatLightTheme', fresh)).not.toThrow()
    expect(fresh.data).toEqual({ 'brobot2.debugMode': 'true' })

    expect(() => forgetPersistentPreference('k', null)).not.toThrow()

    const hostile: ToggleStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('access denied')
      },
    }
    expect(() => forgetPersistentPreference('k', hostile)).not.toThrow()

    const ancient: ToggleStorage = { getItem: () => null, setItem: () => {} }
    expect(() => forgetPersistentPreference('k', ancient)).not.toThrow()
  })
})
