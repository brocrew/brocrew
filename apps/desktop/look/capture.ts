import { it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { nextTick } from 'vue'
import { mount, unmountAll, type Mounted } from '../test/dom/harness'
import IconSprite from '../src/renderer/src/components/IconSprite.vue'

/**
 * 🎨 **One scene of the design tool** (`vitest.look.config.ts`) — mount a surface with fake data and
 * save what Chromium paints as a PNG.
 *
 * ⚑ A scene file calls {@link scene} once with a function that mounts its surface through
 * {@link LookStage.mount}. To make a new one, copy a scene and change its FAKE DATA only — never a
 * component. The size and the file come from `pnpm run look:capture` (`LOOK_OUT`, `LOOK_WIDTH`,
 * `LOOK_HEIGHT`).
 */
export interface LookStage {
  readonly width: number
  readonly height: number
  /** Mount a component into a box the size of the picture (or the size given). */
  mount(
    component: unknown,
    props: Record<string, unknown>,
    box?: { width?: number; height?: number },
  ): Mounted
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    saveLook: (path: string, base64: string) => Promise<void>
  }
}

const env = (name: string): string | undefined =>
  (import.meta.env as Record<string, string | undefined>)[name]

/**
 * ⚑ **One part of the picture, saved on its own** — `<name>.png` beside the scene's picture, cut to
 * `box` exactly as Chromium paints it, for a before/after crop of one component.
 */
export async function crop(
  name: string,
  box: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const out = (env('LOOK_OUT') ?? 'look.png').replace(/[^/]+$/, '')
  const frame = document.createElement('div')
  frame.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;pointer-events:none;z-index:999999`
  document.body.append(frame)
  await document.fonts.ready
  await new Promise((done) => requestAnimationFrame(() => done(null)))
  await commands.saveLook(
    `${out}${name}.png`,
    await page.screenshot({ element: frame, save: false }),
  )
  frame.remove()
}

/** The box of an element, or of the run from one element's top to another's bottom. */
export function boxOf(
  top: Element,
  bottom: Element = top,
): { x: number; y: number; width: number; height: number } {
  const a = top.getBoundingClientRect()
  const b = bottom.getBoundingClientRect()
  return { x: a.x, y: a.y, width: a.width, height: b.bottom - a.y }
}

export function scene(name: string, build: (stage: LookStage) => unknown): void {
  it(`look · ${name}`, async () => {
    const width = Number(env('LOOK_WIDTH') ?? 1200)
    const height = Number(env('LOOK_HEIGHT') ?? 800)
    const out = env('LOOK_OUT') ?? `${name}.png`
    await page.viewport(width, height)
    document.body.style.margin = '0'
    // ⚑ The icons the window draws come from one sprite, mounted once off-picture.
    mount(IconSprite, {}, { width: 1, height: 1 }).host.style.position = 'absolute'
    await build({
      width,
      height,
      mount: (component, props, box) =>
        mount(component as never, props, {
          width: box?.width ?? width,
          height: box?.height ?? height,
        }),
    })
    // Let fonts, layout and any first read settle before the picture.
    await document.fonts.ready
    for (let i = 0; i < 4; i++) {
      await nextTick()
      await new Promise((done) => requestAnimationFrame(() => done(null)))
    }
    await new Promise((done) => setTimeout(done, 150))
    const base64 = await page.screenshot({ save: false })
    await commands.saveLook(out, base64)
    unmountAll()
  })
}
