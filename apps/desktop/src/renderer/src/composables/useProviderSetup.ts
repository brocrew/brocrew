import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Provider } from '../../../shared/runtime-ipc'
import type { ProviderSetupBridge, ProviderSetupState } from '../../../shared/provider-setup'
import { readableError } from '../lib/session-record'

type Operation = 'install' | 'signIn'

export function useProviderSetup(
  provider: () => Provider,
  completed: (operation: Operation) => Promise<void>,
) {
  const state = shallowRef<ProviderSetupState | null>(null)
  const failure = ref<string | null>(null)
  const admitting = ref(false)
  let bridge: ProviderSetupBridge | undefined
  let unsubscribe: (() => void) | undefined
  let alive = true
  let read = 0
  let events = 0
  let intent: Operation | null = null

  const busy = computed(
    () =>
      admitting.value ||
      ['installing', 'signing-in', 'cancelling'].includes(state.value?.phase ?? ''),
  )
  function accept(next: ProviderSetupState, event: boolean): void {
    if (!alive || next.provider !== provider()) return
    state.value = next
    if (event) events++
    if (next.phase === 'failed' || next.phase === 'cancelled') intent = null
    const finished =
      next.phase === 'installed' ? 'install' : next.phase === 'signed-in' ? 'signIn' : null
    if (finished === null || intent !== finished) return
    intent = null
    void completed(finished).catch((error: unknown) => {
      if (alive) failure.value = `Could not check setup again. ${readableError(error)}`
    })
  }
  async function refresh(): Promise<void> {
    const ours = ++read
    const before = events
    const id = provider()
    state.value = null
    failure.value = null
    admitting.value = false
    if (!bridge) return
    try {
      const next = await bridge.state(id)
      if (alive && ours === read && before === events) accept(next, false)
    } catch (error) {
      if (alive && ours === read) failure.value = readableError(error)
    }
  }
  async function run(operation: Operation): Promise<void> {
    if (busy.value) return
    failure.value = null
    if (!bridge) {
      failure.value = 'Setup could not start. Close Settings and try again.'
      return
    }
    intent = operation
    admitting.value = true
    const ours = read
    const id = provider()
    try {
      const result = await bridge[operation](id)
      if (!alive || ours !== read) return
      if (!result.ok) {
        intent = null
        failure.value =
          result.reason === 'busy'
            ? 'Another setup operation is already running.'
            : 'Setup could not start. Try again.'
      }
    } catch (error) {
      if (alive && ours === read) {
        intent = null
        failure.value = readableError(error)
      }
    } finally {
      if (alive && ours === read) admitting.value = false
    }
  }
  async function cancel(): Promise<void> {
    intent = null
    try {
      await bridge?.cancel(provider())
    } catch (error) {
      if (alive) failure.value = readableError(error)
    }
  }
  watch(provider, (_next, before) => {
    if (intent !== null) void bridge?.cancel(before).catch(() => {})
    intent = null
    void refresh()
  })
  onMounted(() => {
    bridge = window.api?.providerSetup
    unsubscribe = bridge?.onState((next) => accept(next, true))
    void refresh()
  })
  onBeforeUnmount(() => {
    alive = false
    read++
    unsubscribe?.()
    if (intent !== null) void bridge?.cancel(provider()).catch(() => {})
    intent = null
  })
  return {
    state,
    busy,
    error: computed(() => failure.value ?? (state.value?.error ? state.value.progress : null)),
    install: () => run('install'),
    signIn: () => run('signIn'),
    cancel,
  }
}
