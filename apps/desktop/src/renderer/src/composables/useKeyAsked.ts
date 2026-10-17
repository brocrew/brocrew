import { ref, type Ref } from 'vue'
import type { Provider } from '../../../shared/runtime-ipc'

/**
 * The provider whose API-key field a person asked to be taken to, from somewhere that is not its
 * card: the setup window at launch. The card that matches takes focus to its key field and clears
 * this, so the ask is answered once.
 */
const asked = ref<Provider | null>(null)

export function useKeyAsked(): Ref<Provider | null> {
  return asked
}
