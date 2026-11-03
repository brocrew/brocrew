import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { workspacePluginRoot } from './root-selection'
import { defaultPluginRoot } from './supervisor/client'
import { privateChild, privateRoot, PluginHostError } from './node-host-files'
import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import { sharedWorkspaceLabel, SHARED_DATA_FEATURE } from './shared-data-contract'

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
  if (!lstatSync(workspaceRoot).isDirectory()) throw new PluginHostError('paths')
  const defaultRoot = defaultPluginRoot(appData)
  const selected = workspacePluginRoot({ appData, workspaceRoot, defaultRoot })
  if (!same(resolve(options.root), selected)) throw new PluginHostError('paths')
  return {
    appData,
    ...(same(selected, defaultRoot) ? {} : { workspaceRoot }),
    ownerId: pluginOwnerIdentity(selected),
    ownerLabel: same(selected, defaultRoot)
      ? 'the default workspaces'
      : sharedWorkspaceLabel(options.label ?? basename(workspaceRoot)),
  }
}

/** Revalidate the app-owned identity at launch; no process environment supplies a root. */
export function checkedSharedDataOwner(input: SharedDataOwner, hostRoot: string): SharedDataOwner {
  const owner = SharedDataOwner.parse(input)
  const appData = realpathSync(owner.appData),
    root = resolve(hostRoot, '..')
  const isDefault = same(root, defaultPluginRoot(appData))
  const checked: SharedDataOwner | undefined =
    isDefault && owner.workspaceRoot === undefined
      ? { appData, ownerId: pluginOwnerIdentity(root), ownerLabel: 'the default workspaces' }
      : owner.workspaceRoot
        ? sharedDataOwner({
            appData,
            workspaceRoot: owner.workspaceRoot,
            root,
            label: owner.ownerLabel,
            hidden: false,
          })
        : undefined
  if (
    !checked ||
    !same(owner.appData, checked.appData) ||
    owner.workspaceRoot !== checked.workspaceRoot ||
    owner.ownerId !== checked.ownerId ||
    owner.ownerLabel !== checked.ownerLabel
  )
    throw new PluginHostError('paths')
  return checked
}

/** Grant only a verified package its own namespace; absence leaves local-only behaviour. */
export async function sharedDataEnvironment(
  pkg: VerifiedPluginPackage,
  hostRoot: string,
  input?: SharedDataOwner,
): Promise<Record<string, string>> {
  if (!verifiedPluginDigest(pkg) || !pkg.compatibility.host) throw new PluginHostError('package')
  if (pkg.manifest.sharedData !== true || !input) return {}
  if (!pkg.manifest.hostApi.requiredFeatures.includes(SHARED_DATA_FEATURE))
    throw new PluginHostError('package')
  const owner = checkedSharedDataOwner(input, hostRoot)
  const root = await privateRoot(join(owner.appData, '@brobot2', 'shared'))
  const shared = await privateChild(root, pkg.manifest.id)
  return {
    [`BROCREW_${pkg.manifest.id.toUpperCase().replace(/-/g, '_')}_SHARED`]: shared,
    BROCREW_PLUGIN_OWNER_ID: owner.ownerId,
    BROCREW_PLUGIN_OWNER_LABEL: owner.ownerLabel,
  }
}
