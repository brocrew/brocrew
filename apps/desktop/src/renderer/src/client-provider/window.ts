import type { PagePerformanceReport } from '../../../shared/page-performance'
import { createDesktopProviderApi } from './desktop'

export const desktopProviderApi = createDesktopProviderApi(
  () => window.api.runtime,
  () => window.api?.providerSetup,
  () => window.api?.recoveryRetention,
  () => globalThis.window?.api?.runtime,
  () => (typeof window === 'undefined' ? undefined : window.api),
  () => window.api?.plugins,
  () => globalThis.window?.api?.logging,
  () => globalThis.window?.api?.dockLabel,
  () => globalThis.window?.api?.runtime,
  () => globalThis.window?.api?.storage,
  () => globalThis.window?.api?.workspaces,
  () => globalThis.window?.api?.themes,
  () => globalThis.window?.api,
)

export const desktopBootstrap = {
  get zone(): Pick<Window['api'], 'localZone' | 'onLocalZone'> | undefined {
    return window.api
  },
  get savedDrafts() {
    return window.api?.savedDrafts
  },
  get canReportPagePerformance() {
    return Boolean(window.api?.recordPagePerformance)
  },
  recordPagePerformance(report: PagePerformanceReport) {
    return window.api.recordPagePerformance(report)
  },
}
