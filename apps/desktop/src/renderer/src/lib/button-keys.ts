import type { ObjectDirective } from 'vue'

const spaceHeld = new WeakSet<HTMLElement>()

function released(event: Event): void {
  spaceHeld.delete(event.currentTarget as HTMLElement)
}

function buttonKey(event: KeyboardEvent): void {
  const element = event.currentTarget as HTMLElement
  if (event.target !== element || element.getAttribute('role') !== 'button') return
  if (element.getAttribute('aria-disabled') === 'true') {
    spaceHeld.delete(element)
    return
  }
  if (event.key === ' ') {
    event.preventDefault()
    if (event.type === 'keydown' && !event.repeat) spaceHeld.add(element)
    if (event.type === 'keyup' && spaceHeld.delete(element)) element.click()
  } else if (event.key === 'Enter' && event.type === 'keydown') {
    event.preventDefault()
    element.click()
  }
}

/** Native button keys for a preview that also contains independent links. */
export const vButtonKeys: ObjectDirective<HTMLElement> = {
  mounted(element) {
    element.addEventListener('keydown', buttonKey)
    element.addEventListener('keyup', buttonKey)
    element.addEventListener('blur', released)
  },
  unmounted(element) {
    element.removeEventListener('keydown', buttonKey)
    element.removeEventListener('keyup', buttonKey)
    element.removeEventListener('blur', released)
    spaceHeld.delete(element)
  },
}
