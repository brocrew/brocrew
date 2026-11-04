/** Opaque installation and view identity; never domain configuration authority. */
export interface PluginUiBinding {
  pluginId: string
  releaseDigest: string
  installId: string
  incarnation: string
  leaseId: string
}
