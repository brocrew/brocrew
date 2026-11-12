import { join } from 'node:path'
import { createRepoAwarePluginVerifier, type VerifiedPluginCatalogue } from '../package-verifier'
import type { PluginRelease, PluginTarget } from '../package-schema'
import { PLUGIN_LIMITS } from '../package-digests'
import {
  privateChild,
  immutableFile,
  verifyImmutableFile,
  sourceBytes,
  publishPrivateDirectory,
  removePrivateCode,
} from '../node-host-files'
import { PluginSupervisorError } from '../supervisor/protocol'

/** Immutable verified archive cache, distinct from mutable profiles/downloads. */
type VaultRelease = Pick<PluginRelease, 'id' | 'version' | 'manifestSha256'> & {
  archive: Pick<PluginRelease['archive'], 'sha256'>
}
export class PluginPackageVault {
  constructor(
    private readonly root: string,
    private readonly target: PluginTarget,
  ) {}
  private async checked(
    directory: string,
    release: Readonly<VaultRelease>,
    admitted?: VerifiedPluginCatalogue,
  ) {
    const catalogue = await sourceBytes(
      join(directory, 'catalogue.json'),
      PLUGIN_LIMITS.catalogueBytes,
    )
    const archive = await sourceBytes(join(directory, 'archive'), PLUGIN_LIMITS.archiveBytes)
    for (const [name, bytes] of [
      ['catalogue.json', catalogue],
      ['archive', archive],
    ] as const)
      await verifyImmutableFile(join(directory, name), bytes)
    const verified = createRepoAwarePluginVerifier({
      target: this.target,
    }).verifyCatalogue(catalogue)
    const entry = verified.entries.find(
      (one) => one.id === release.id && one.version === release.version,
    )
    if (
      !entry ||
      entry.archive.sha256 !== release.archive.sha256 ||
      entry.manifestSha256 !== release.manifestSha256
    )
      throw new PluginSupervisorError('unavailable')
    return (admitted ?? verified).verifyPackage(release.id, release.version, archive)
  }
  async stage(
    release: Readonly<PluginRelease>,
    archive: Uint8Array,
    catalogue: { bytes: Uint8Array },
  ) {
    const folder = await privateChild(this.root, 'package-vault')
    const kept = await publishPrivateDirectory(
      folder,
      release.archive.sha256,
      async (stage) => {
        await immutableFile(join(stage, 'archive'), archive)
        await immutableFile(join(stage, 'catalogue.json'), catalogue.bytes)
      },
      async (directory) => {
        await this.checked(directory, release)
      },
    )
    return this.checked(kept, release)
  }
  async load(release: Readonly<VaultRelease>, admitted?: VerifiedPluginCatalogue) {
    const folder = await privateChild(this.root, 'package-vault', false)
    const directory = await privateChild(folder, release.archive.sha256, false)
    return this.checked(directory, release, admitted)
  }
  async remove(
    release: Readonly<VaultRelease>,
    ownership: { operationId: string; installId: string },
  ): Promise<void> {
    const folder = await privateChild(this.root, 'package-vault')
    await removePrivateCode(folder, release.archive.sha256, {
      retirementId: `${ownership.operationId}-${ownership.installId}`,
      verifyPublished: async (directory) => {
        await this.checked(directory, release)
      },
    })
  }
}
