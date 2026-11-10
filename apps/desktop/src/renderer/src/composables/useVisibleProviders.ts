import { computed } from 'vue'
import { visibleProviderDescriptors, type ProviderDescriptor } from '@brobot2/shared'
import { usePersistentToggle } from './usePersistentToggle'

export function useVisibleProviders(descriptors?: () => readonly ProviderDescriptor[] | undefined) {
  const debug = usePersistentToggle('brobot2.debugMode', false)
  return computed(() => visibleProviderDescriptors(debug.value, descriptors?.()))
}
