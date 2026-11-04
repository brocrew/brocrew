import { realpathSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { defaultPluginRoot } from './supervisor/client'
import { privateChild, privateRoot, PluginHostError } from './node-host-files'
import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import { sharedWorkspaceLabel } from './shared-data-contract'

const path = z.string().min(1).max(4096).refine(isAbsolute)
export const SharedDataOwner = z.strictObject({
  appData: path,
  workspaceRoot: path.optional(),
  ownerId: z.uuid(),
  ownerLabel: z.string().min(1).max(320),
})
export type SharedDataOwner = z.infer<typeof SharedDataOwner>
const same = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
export function pluginOwnerIdentity(canonicalRoot: string): string {
  const root = process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot
  const hash = createHash('sha256').update('brocrew-plugin-owner:v1\0').update(root).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/** Real default and paired roots share storage; identity follows the owner root, not its consumers. */
export function sharedDataOwner(options: {
  appData: string
  root: string
  workspaceRoot: string
  hidden: boolean
  label?: string
}): SharedDataOwner | undefined {
  if (options.hidden) return undefined
  if (![options.appData, options.root, options.workspaceRoot].every(isAbsolute))
    throw new PluginHostError('paths')
  const appData = realpathSync(options.appData)
  const workspaceRoot = realpathSync(options.workspaceRoot)
  const defaultRoot = defaultPluginRoot(appData)
  const selected = resolve(options.root)
  return {
    appData,
    ...(same(selected, defaultRoot) ? {} : { workspaceRoot }),
    ownerId: pluginOwnerIdentity(selected),
    ownerLabel: same(selected, defaultRoot)
      ? 'the default workspaces'
      : sharedWorkspaceLabel(options.label ?? basename(workspaceRoot)),
  }
}

/** Legacy identity and labels are compatibility data, not launch enrollment. */
export function checkedSharedDataOwner(input: SharedDataOwner, _hostRoot: string): SharedDataOwner {
  void _hostRoot
  return { ...input }
}

/** Grant only a verified package its own namespace; absence leaves local-only behaviour. */
export async function sharedDataEnvironment(
  pkg: VerifiedPluginPackage,
  hostRoot: string,
  input?: SharedDataOwner,
): Promise<Record<string, string>> {
  if (!verifiedPluginDigest(pkg) || !pkg.compatibility.host) throw new PluginHostError('package')
  if (!input || (pkg.manifest.format !== 3 && pkg.manifest.sharedData !== true)) return {}
  const owner = checkedSharedDataOwner(input, hostRoot)
  const sharedRoot = join(owner.appData, '@brobot2', 'shared')
  const root = await privateRoot(sharedRoot)
  const shared = await privateChild(root, pkg.manifest.id)
  return {
    BROCREW_PLUGIN_SHARED: shared,
    [`BROCREW_${pkg.manifest.id.toUpperCase().replace(/-/g, '_')}_SHARED`]: shared,
    BROCREW_PLUGIN_OWNER_ID: owner.ownerId,
    BROCREW_PLUGIN_OWNER_LABEL: owner.ownerLabel,
  }
}
