import { nextTick } from 'vue'

export async function settleDom(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

/** One timer turn and Vue's next tick, then two animation frames, so layout has run. */
export async function settleFrames(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}
