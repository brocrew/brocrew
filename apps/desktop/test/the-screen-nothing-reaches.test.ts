import { computed, nextTick, ref, type ComputedRef } from 'vue'
import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../src/renderer/src/lib/session-record'
import { RESERVED_PLACES, useSurface } from '../src/renderer/src/composables/useSurface'
import { buildCommands } from '../src/renderer/src/lib/command-palette'

function fakeStore(): { live: ComputedRef<SessionRecord[]>; get: () => SessionRecord | null } {
  const rows = ref<SessionRecord[]>([])
  return { live: computed(() => rows.value), get: () => null }
}

describe('the Team destination', () => {
  it('place "team" is the Team surface — and before this it was a project called team', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'team'

    expect(surface.surface.value).toBe('team')
  })

  it('…and a word nobody reserved does not reach the Team page', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'teamwork'

    expect(surface.surface.value).toBe('launcher')
  })

  it('the word is reserved, which is the half the precedence chain cannot do alone', () => {
    expect([...RESERVED_PLACES]).toContain('team')
  })

  it('the palette offers it, with the sentence the rail row deliberately does not carry', () => {
    const rows = buildCommands({
      conversations: [],
      activeId: null,
      agent: null,
    })
    const team = rows.find((row) => row.id === 'go-team')
    expect(team?.action).toEqual({ kind: 'go', place: 'team' })

    expect(team?.title).toBe('Team')
    expect(team?.detail).toContain('run or not')
  })
})
