<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import {
  LINK_FAILED,
  LINK_UNAVAILABLE,
  linkFailureReason,
  MESSAGE_LINK_ATTRIBUTE,
  type ResolveMessageLink,
  type ResolvedMessageLink,
} from '../lib/message-links'
import { TOAST_MS } from '../lib/overlay-store'

const props = defineProps<{
  resolve: ResolveMessageLink
  open: (answer: ResolvedMessageLink) => Promise<boolean>
  /** Changes when the person moves to another conversation or place; a failure shown for the old one goes. */
  scope?: string
}>()
const root = ref<HTMLElement | null>(null)
const failure = ref<string | null>(null)
const preview = ref<{
  title: string | null
  status: string | null
  left: number
  top: number
} | null>(null)
const previewId = useId()
const reads = new Map<string, Promise<ResolvedMessageLink>>()
const inFlight = new Map<string, { reading: Promise<ResolvedMessageLink>; fresh: boolean }>()
const freshAfter = new Map<string, Promise<ResolvedMessageLink>>()
const finished = new Set<string>()
const scanned = new WeakSet<Element>()
let observer: MutationObserver | null = null
let active: HTMLButtonElement | null = null
let alive = true
let pressing = false
let running = 0
let hoverTimer: ReturnType<typeof setTimeout> | null = null
let failureTimer: ReturnType<typeof setTimeout> | null = null
const queue: Array<() => void> = []

function clearFailure(): void {
  if (failureTimer !== null) clearTimeout(failureTimer)
  failureTimer = null
  failure.value = null
}

function fail(reason: string): void {
  clearFailure()
  failure.value = reason
  failureTimer = setTimeout(clearFailure, TOAST_MS)
}

watch(() => props.scope, clearFailure)

function read(target: string, fresh = false): Promise<ResolvedMessageLink> {
  const pending = inFlight.get(target)
  if (pending) {
    if (!fresh || pending.fresh) return pending.reading
    const queued = freshAfter.get(target)
    if (queued) return queued
    const next = pending.reading
      .catch(() => null)
      .then(() => {
        freshAfter.delete(target)
        if (!alive) throw new Error('Link view is closed')
        return read(target, true)
      })
    freshAfter.set(target, next)
    return next
  }
  if (!fresh && reads.has(target)) return reads.get(target)!
  const result = new Promise<ResolvedMessageLink>((resolve, reject) => {
    queue.push(() => {
      running += 1
      void Promise.resolve()
        .then(() => props.resolve(target))
        .then(resolve, reject)
        .finally(() => {
          running -= 1
          drain()
        })
    })
  })
  finished.delete(target)
  reads.set(target, result)
  inFlight.set(target, { reading: result, fresh })
  void result.then(
    (answer) => settled(target, answer, result),
    () => settled(target, null, result),
  )
  drain()
  return result
}

function settled(
  target: string,
  answer: ResolvedMessageLink | null,
  reading: Promise<ResolvedMessageLink>,
): void {
  if (inFlight.get(target)?.reading === reading) inFlight.delete(target)
  if (!alive || reads.get(target) !== reading) return
  paintTarget(target, answer)
  finished.add(target)
  while (finished.size > 512) {
    const oldest = finished.values().next().value!
    finished.delete(oldest)
    reads.delete(oldest)
  }
}

function paintTarget(target: string, answer: ResolvedMessageLink | null): void {
  for (const button of root.value?.querySelectorAll<HTMLButtonElement>(
    `button[${MESSAGE_LINK_ATTRIBUTE}]`,
  ) ?? []) {
    if (owns(button) && button.getAttribute(MESSAGE_LINK_ATTRIBUTE) === target)
      paint(button, answer)
  }
}

function drain(): void {
  while (alive && running < 4 && queue.length) queue.shift()!()
}

function owns(element: Element): boolean {
  return element.closest('[data-message-links-scope]') === root.value
}

function buttonAt(event: Event): HTMLButtonElement | null {
  const target = event.target
  const button =
    target instanceof Element
      ? target.closest<HTMLButtonElement>(`button[${MESSAGE_LINK_ATTRIBUTE}]`)
      : null
  return button && owns(button) ? button : null
}

function guardGesture(event: MouseEvent | DragEvent): void {
  if (!buttonAt(event) || (event.type === 'auxclick' && event.button !== 1)) return
  event.preventDefault()
  event.stopPropagation()
}

function contextMenu(event: MouseEvent): void {
  const button = buttonAt(event)
  const selection = window.getSelection()
  if (!button || !selection) return
  if (!selection.isCollapsed && selection.containsNode(button, true)) return
  const range = document.createRange()
  range.selectNodeContents(button)
  selection.removeAllRanges()
  selection.addRange(range)
}

function copyText(event: ClipboardEvent): void {
  const selection = window.getSelection()
  const node = selection?.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  const button = element?.closest<HTMLButtonElement>(`button[${MESSAGE_LINK_ATTRIBUTE}]`)
  if (!button || !owns(button) || !selection?.focusNode || !button.contains(selection.focusNode))
    return
  if (!event.clipboardData) return
  event.clipboardData.setData('text/plain', selection.toString())
  event.preventDefault()
}

function paint(button: HTMLButtonElement, answer: ResolvedMessageLink | null): void {
  if (!alive || !button.isConnected) return
  const unavailable = answer === null || answer.state === 'unavailable' || answer.opens === null
  button.dataset.linkState = unavailable ? 'unavailable' : answer.state
  if (unavailable) button.setAttribute('aria-description', LINK_UNAVAILABLE)
  else button.removeAttribute('aria-description')
  const indicator = button.querySelector('svg')
  if (answer !== null) {
    indicator?.setAttribute(
      'aria-label',
      answer.kind === 'agent' ? 'Agent link' : 'Conversation link',
    )
    indicator
      ?.querySelector('use')
      ?.setAttribute('href', answer.kind === 'agent' ? '#i-user' : '#i-chat')
  }
  let marker = button.querySelector<HTMLElement>('[data-link-unavailable]')
  if (unavailable && !marker && !button.hasAttribute('data-person-link')) {
    marker = document.createElement('span')
    marker.dataset.linkUnavailable = ''
    marker.className = 'message-link-unavailable'
    marker.textContent = ` (${LINK_UNAVAILABLE})`
    button.append(marker)
  } else if (!unavailable) marker?.remove()
  if (active === button) show(button, answer)
}

function show(button: HTMLButtonElement, answer: ResolvedMessageLink | null): void {
  if (!alive || !button.isConnected || active !== button) return
  if (answer === null || (answer.title === null && answer.status === null)) {
    preview.value = null
    button.removeAttribute('aria-describedby')
    return
  }
  const box = button.getBoundingClientRect()
  preview.value = {
    title: answer.title,
    status: answer.status,
    left: Math.max(8, Math.min(box.left, window.innerWidth - 300)),
    top: Math.min(box.bottom + 6, window.innerHeight - 80),
  }
  button.setAttribute('aria-describedby', previewId)
}

function enter(event: Event): void {
  const button = buttonAt(event)
  if (!button) return
  if (active === button) {
    if (event.type === 'focusin') {
      if (hoverTimer !== null) clearTimeout(hoverTimer)
      hoverTimer = null
      previewFor(button)
    }
    return
  }
  hide()
  active = button
  if (event.type === 'mouseover') {
    hoverTimer = setTimeout(() => {
      hoverTimer = null
      if (active === button && button.isConnected) previewFor(button)
    }, 150)
  } else previewFor(button)
}

function previewFor(button: HTMLButtonElement): void {
  const target = button.getAttribute(MESSAGE_LINK_ATTRIBUTE)!
  const reading = read(target, true)
  void reading.then(
    (answer) => {
      if (reads.get(target) === reading) show(button, answer)
    },
    () => {
      if (reads.get(target) === reading) show(button, null)
    },
  )
}

function hide(): void {
  if (hoverTimer !== null) clearTimeout(hoverTimer)
  hoverTimer = null
  active?.removeAttribute('aria-describedby')
  active = null
  preview.value = null
}

function scrolled(): void {
  if (active !== document.activeElement) hide()
}

function leave(event: FocusEvent | MouseEvent): void {
  const button = buttonAt(event)
  if (button && event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return
  if (event.type === 'mouseout' && document.activeElement === button) return
  if (button === active) hide()
}

async function click(event: MouseEvent): Promise<void> {
  const button = buttonAt(event)
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  if (pressing) return
  pressing = true
  clearFailure()
  button.setAttribute('aria-busy', 'true')
  try {
    const answer = await read(button.getAttribute(MESSAGE_LINK_ATTRIBUTE)!, true)
    if (!alive || !button.isConnected) return
    if (answer.state === 'unavailable' || answer.opens === null) {
      fail(linkFailureReason(answer))
      return
    }
    const opened = await props.open(answer)
    if (!alive) return
    if (opened) hide()
    else if (button.isConnected) fail(LINK_FAILED)
  } catch {
    if (alive && button.isConnected) fail(LINK_FAILED)
  } finally {
    button.removeAttribute('aria-busy')
    pressing = false
  }
}

function scan(node: Node): void {
  if (!(node instanceof Element)) return
  const buttons = node.matches(`button[${MESSAGE_LINK_ATTRIBUTE}]`) ? [node] : []
  buttons.push(...node.querySelectorAll(`button[${MESSAGE_LINK_ATTRIBUTE}]`))
  for (const element of buttons) {
    if (!(element instanceof HTMLButtonElement) || !owns(element) || scanned.has(element)) continue
    scanned.add(element)
    const target = element.getAttribute(MESSAGE_LINK_ATTRIBUTE)!
    const reading = read(target)
    void reading.then(
      (answer) => {
        if (reads.get(target) === reading) paint(element, answer)
      },
      () => {
        if (reads.get(target) === reading) paint(element, null)
      },
    )
  }
}

onMounted(() => {
  if (!root.value) return
  root.value.addEventListener('click', click, true)
  root.value.addEventListener('auxclick', guardGesture, true)
  root.value.addEventListener('dragstart', guardGesture, true)
  root.value.addEventListener('contextmenu', contextMenu, true)
  document.addEventListener('copy', copyText)
  window.addEventListener('scroll', scrolled, true)
  scan(root.value)
  observer = new MutationObserver((changes) => {
    for (const change of changes) for (const node of change.addedNodes) scan(node)
    if (active && !active.isConnected) hide()
  })
  observer.observe(root.value, { childList: true, subtree: true })
})
onBeforeUnmount(() => {
  alive = false
  clearFailure()
  hide()
  root.value?.removeEventListener('click', click, true)
  root.value?.removeEventListener('auxclick', guardGesture, true)
  root.value?.removeEventListener('dragstart', guardGesture, true)
  root.value?.removeEventListener('contextmenu', contextMenu, true)
  document.removeEventListener('copy', copyText)
  window.removeEventListener('scroll', scrolled, true)
  observer?.disconnect()
  queue.length = 0
})
</script>

<template>
  <div
    ref="root"
    class="message-links"
    data-message-links-scope
    @mouseover="enter"
    @focusin="enter"
    @mouseout="leave"
    @focusout="leave"
    @keydown.esc="hide"
  >
    <slot />
    <div
      v-if="preview"
      :id="previewId"
      role="tooltip"
      class="message-link-preview"
      :style="{ left: `${preview.left}px`, top: `${preview.top}px` }"
      data-cy="message-link-preview"
    >
      <strong>{{ preview.title }}</strong>
      <span v-if="preview.status">{{ preview.status }}</span>
    </div>
    <p v-if="failure" role="status" class="message-link-failure" data-cy="message-link-failure">
      {{ failure }}
      <button
        type="button"
        class="message-link-failure-close"
        aria-label="Close"
        @click="clearFailure"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </p>
  </div>
</template>

<style>
.message-links {
  display: contents;
}
.message-link {
  display: inline;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-text);
  font: inherit;
  text-align: inherit;
  text-decoration: underline;
  text-underline-offset: 0.15em;
  cursor: pointer;
  overflow-wrap: anywhere;
  border-radius: var(--radius);
}
.message-link:focus-visible {
  outline: var(--border-width) solid var(--accent-text);
  outline-offset: 2px;
}
.message-link .message-link-indicator {
  width: 0.85em;
  height: 0.85em;
  margin-right: 0.2em;
  vertical-align: -0.08em;
}
.message-link-unavailable {
  color: var(--muted);
  font-size: var(--type-caption);
}
.message-link[data-person-link][data-link-state='unavailable']::after {
  content: ' (Unavailable)';
  color: var(--muted);
  font-size: var(--type-caption);
}
.message-link-preview,
.message-link-failure {
  position: fixed;
  z-index: 100;
  max-width: min(32ch, calc(100vw - 16px));
  padding: var(--space-4) var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--panel-3);
  color: var(--text);
  box-shadow: var(--shadow-float);
  overflow-wrap: anywhere;
  font-size: var(--type-small);
}
.message-link-preview {
  pointer-events: none;
  display: grid;
  gap: var(--space-2);
}
.message-link-preview span {
  color: var(--muted);
}
.message-link-failure {
  bottom: var(--space-8);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.message-link-failure-close {
  display: inline-flex;
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.message-link-failure-close:hover,
.message-link-failure-close:focus-visible {
  color: var(--text);
}
</style>
