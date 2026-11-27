import { onMounted, onUnmounted, ref } from 'vue'
import { drawerFit, type DrawerFit } from '../lib/drawer'

/** The pane body and how the drawer sits in it (moved out of `ConversationPane.vue` unchanged). */
export function useDrawerFit() {
  /**
   * How the drawer sits in the width the transcript and it share (079 §4).
   *
   * ⚠️ **Measured, not derived from the window.** `.app` has a `min-width`, so a window narrower than
   * it does not make the layout narrower — it makes the page scroll. A media query would therefore
   * detach the drawer while the reading column still had every pixel it asked for. What is observed
   * is the row they share, whose width does not depend on the drawer's own state, so opening the
   * drawer cannot feed back into the decision that sizes it.
   *
   * SSR and any test without a DOM get `docked`: it is the state a wide window is in, and a
   * layout mode is not something to guess at on a machine that has no layout.
   */
  const paneBody = ref<HTMLElement | null>(null)
  const fit = ref<DrawerFit>('docked')
  let sizes: ResizeObserver | null = null

  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || !paneBody.value) return
    // ⚠️ **Measured SYNCHRONOUSLY first.** A ResizeObserver's first callback lands after the browser
    // has already painted, so on a narrow window the drawer would dock at its comfortable width for a
    // frame and squeeze the transcript under its floor before correcting — a visible flinch on every
    // cold open, and the only moment the 560px floor is not honoured. Found in review. `onMounted`
    // runs before paint, so reading the box here means the first frame is already right.
    fit.value = drawerFit(paneBody.value.getBoundingClientRect().width)
    sizes = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width && width > 0) fit.value = drawerFit(width)
    })
    sizes.observe(paneBody.value)
  })

  onUnmounted(() => {
    sizes?.disconnect()
    sizes = null
  })

  return {
    paneBody,
    fit,
  }
}
