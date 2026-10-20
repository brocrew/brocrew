import type { CatalogueSource } from './loader'
/** Dormant signed-source inputs retained for tests; production index.ts does not import these. */
export const PLUGIN_CATALOGUE_PUBLIC_KEY = '' // Ed25519 public key, base64 DER SPKI.
export const PLUGIN_CATALOGUE_SOURCES: readonly CatalogueSource[] = []
/** Enable only in a reviewed dev/personal build. Root is fixed below appData, not a setting. */
export const PLUGIN_LOCAL_RELEASE_ENABLED: boolean = false
