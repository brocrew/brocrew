import { computed } from 'vue'
import { visibleProviderDescriptors, type ProviderDescriptor } from '@brobot2/shared'
import { useDebugMode } from './useDebugMode'

export function useVisibleProviders(descriptors?: () => readonly ProviderDescriptor[] | undefined) {
  const debug = useDebugMode()
  return computed(() => visibleProviderDescriptors(debug.value, descriptors?.()))
}
