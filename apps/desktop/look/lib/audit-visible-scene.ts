import { nextTick } from 'vue'

function isVisibleThroughAncestors(element: HTMLElement, box: DOMRect): boolean {
  let left = box.left,
    right = box.right,
    top = box.top,
    bottom = box.bottom
  for (let el: HTMLElement | null = element; el; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
      return false
    if (
      el.tagName === 'DETAILS' &&
      !el.hasAttribute('open') &&
      !el.querySelector('summary')?.contains(element)
    )
      return false
    const clip = el.getBoundingClientRect()
    if (el !== element && ['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX)) {
      left = Math.max(left, clip.left)
      right = Math.min(right, clip.right)
    }
    if (el !== element && ['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowY)) {
      top = Math.max(top, clip.top)
      bottom = Math.min(bottom, clip.bottom)
    }
  }
  return (
    right > left &&
    bottom > top &&
    bottom > 0 &&
    top < innerHeight &&
    right > 0 &&
    left < innerWidth
  )
}
export async function auditVisibleScene(
  host: HTMLElement,
  outputPath: string,
  { save }: { save: (path: string, base64: string) => Promise<void> },
): Promise<void> {
  await document.fonts.ready
  await nextTick()
  await new Promise((done) => setTimeout(done, 700))
  const text: string[] = []
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const parent = node.parentElement!
    if (parent.closest('svg,script,style,option')) continue
    if (isVisibleThroughAncestors(parent, range.getBoundingClientRect())) {
      const value = node.textContent.trim()
      text.push(
        getComputedStyle(parent).textTransform === 'uppercase' ? value.toUpperCase() : value,
      )
    }
  }
  const controls = [...host.querySelectorAll<HTMLInputElement>('input,textarea')]
    .filter((el) => isVisibleThroughAncestors(el, el.getBoundingClientRect()))
    .map((el) => ({ placeholder: el.placeholder, value: el.type === 'password' ? '' : el.value }))
  for (const el of host.querySelectorAll<HTMLSelectElement>('select'))
    if (isVisibleThroughAncestors(el, el.getBoundingClientRect()))
      text.push(el.selectedOptions[0]?.textContent ?? '')
  const labels = [...host.querySelectorAll<HTMLElement>('[title],[aria-label]')].map((el) => ({
    title: el.title,
    aria: el.getAttribute('aria-label'),
  }))
  const report = {
    text,
    controls,
    labels,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
  }
  const raw = JSON.stringify(report, null, 2)
  if (/@|\/Users\/|\b[WFD]\d+(?:\.\d+)?\b/i.test(text.join(' ') + ' ' + JSON.stringify(controls)))
    throw Error('Public screenshot contains a forbidden label')
  const bytes = new TextEncoder().encode(raw)
  const encoded = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
  await save(outputPath + '.audit.json', encoded)
}
