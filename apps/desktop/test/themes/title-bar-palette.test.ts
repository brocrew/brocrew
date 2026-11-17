import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { childTheme, createHostFixture, putTheme, type HostFixture } from './host-fixtures'

let fixture: HostFixture
beforeEach(async () => {
  fixture = await createHostFixture()
})
afterEach(async () => {
  await fixture.cleanup()
})

describe('the native title bar palette', () => {
  it('updates the native title bar palette with the active theme and returns to Classic', async () => {
    await putTheme(fixture.library, 'caption', {
      ...childTheme('caption'),
      titlebar: { background: '#091524', ink: '#e6eef5' },
    })
    const store = fixture.store()
    await store.start()
    const palettes: ReturnType<typeof store.titleBar>[] = []
    const stop = store.onChanged(() => palettes.push(store.titleBar()))
    expect(await store.set('caption')).toMatchObject({ outcome: 'ok' })
    expect(store.titleBar()).toEqual({ color: '#091524', symbolColor: '#e6eef5' })
    expect(palettes.at(-1)).toEqual(store.titleBar())
    expect(await store.set('classic')).toMatchObject({ outcome: 'ok' })
    expect(store.titleBar()).toEqual({ color: '#10132f', symbolColor: '#dfe1fb' })
    expect(palettes.at(-1)).toEqual(store.titleBar())
    stop()
  })

  it('composites translucent title-bar colours on the frame and ignores artwork for native buttons', async () => {
    await putTheme(fixture.library, 'caption', {
      ...childTheme('caption'),
      frame: { ink: '#ffffff', paper: '#000000', accent: '#ffffff' },
      titlebar: { background: '#ffffff80', ink: '#000000' },
    })
    const store = fixture.store()
    await store.start()
    expect(await store.set('caption')).toMatchObject({ outcome: 'ok' })
    expect(store.titleBar()).toEqual({ color: '#808080', symbolColor: '#000000' })
  })
})
