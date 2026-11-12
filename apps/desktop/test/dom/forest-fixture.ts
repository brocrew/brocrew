import { nextTick } from 'vue'
export { conv, task, forestOf, viewOf, readingOf } from '../lib/forest-fixture'

/** ⚑ **Vue Flow draws its cards a frame after the mount** — wait for that frame, then the next tick. */
export async function forestDrawn(): Promise<void> {
  await nextTick()
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  await nextTick()
}
