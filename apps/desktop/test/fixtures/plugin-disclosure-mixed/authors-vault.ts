import type { KeyObject } from 'node:crypto'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import {
  createRepoAwarePluginVerifier,
  type VerifiedPluginCatalogue,
  type PluginReleasePin,
} from '../../../src/main/plugins/package-verifier'
import type { PluginRelease, PluginTarget } from '../../../src/main/plugins/package-schema'
import { PLUGIN_LIMITS, pluginSha256 } from '../../../src/main/plugins/package-digests'
import {
  privateChild,
  immutableFile,
  verifyImmutableFile,
  sourceBytes,
  publishPrivateDirectory,
  removePrivateCode,
} from '../../../src/main/plugins/node-host-files'
import { PluginSupervisorError } from '../../../src/main/plugins/supervisor/protocol'

/** Immutable verified archive cache, distinct from mutable profiles/downloads. */
type VaultRelease = Pick<PluginRelease, 'id' | 'version' | 'manifestSha256'> & {
  archive: Pick<PluginRelease['archive'], 'sha256'>
}
export class PluginPackageVault {
  constructor(
    private readonly root: string,
    private readonly key: KeyObject | null,
    private readonly target: PluginTarget,
    private readonly repoCatalogueSha256?: string,
  ) {}
  private async checked(
    directory: string,
    release: Readonly<VaultRelease>,
    pins: readonly PluginReleasePin[],
    admitted?: VerifiedPluginCatalogue,
  ) {
    const proofName = this.key === null ? 'catalogue.sha256' : 'catalogue.sig'
    const names = (await readdir(directory)).sort()
    if (names.join(',') !== ['archive', 'catalogue.json', proofName].sort().join(','))
      throw new PluginSupervisorError('unavailable')
    const catalogue = await sourceBytes(
      join(directory, 'catalogue.json'),
      PLUGIN_LIMITS.catalogueBytes,
    )
    const proof = await sourceBytes(join(directory, proofName), 64)
    if (this.key === null && proof.toString('ascii') !== pluginSha256(catalogue))
      throw new PluginSupervisorError('unavailable')
    const signature = this.key === null ? Buffer.alloc(0) : proof
    const archive = await sourceBytes(join(directory, 'archive'), PLUGIN_LIMITS.archiveBytes)
    for (const [name, bytes] of [
      ['catalogue.json', catalogue],
      [proofName, proof],
      ['archive', archive],
    ] as const)
      await verifyImmutableFile(join(directory, name), bytes)
    const verified = createRepoAwarePluginVerifier({
      pinnedPublicKey: this.key,
      repoCatalogueSha256: this.key === null ? pluginSha256(catalogue) : undefined,
      target: this.target,
      // Cached unsigned metadata is never authority. The exact release comes from the
      // admitted list (stage) or authenticated installation record (load/removal).
      knownReleases: [
        ...pins,
        {
          id: release.id,
          version: release.version,
          archiveSha256: release.archive.sha256,
          manifestSha256: release.manifestSha256,
        },
      ],
    }).verifyCatalogue(catalogue, signature)
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
    catalogue: { bytes: Uint8Array; signature: Uint8Array },
    pins: readonly PluginReleasePin[],
  ) {
    if (this.key === null && !this.repoCatalogueSha256)
      throw new PluginSupervisorError('unavailable')
    const folder = await privateChild(this.root, 'package-vault')
    const kept = await publishPrivateDirectory(
      folder,
      release.archive.sha256,
      async (stage) => {
        await immutableFile(join(stage, 'archive'), archive)
        await immutableFile(join(stage, 'catalogue.json'), catalogue.bytes)
        await immutableFile(
          join(stage, this.key === null ? 'catalogue.sha256' : 'catalogue.sig'),
          this.repoCatalogueSha256
            ? Buffer.from(pluginSha256(catalogue.bytes))
            : catalogue.signature,
        )
      },
      async (directory) => {
        await this.checked(directory, release, pins)
      },
    )
    return this.checked(kept, release, pins)
  }
  async load(
    release: Readonly<VaultRelease>,
    pins: readonly PluginReleasePin[],
    admitted?: VerifiedPluginCatalogue,
  ) {
    const folder = await privateChild(this.root, 'package-vault', false)
    const directory = await privateChild(folder, release.archive.sha256, false)
    return this.checked(directory, release, pins, admitted)
  }
  async remove(
    release: Readonly<VaultRelease>,
    pins: readonly PluginReleasePin[],
    ownership: { operationId: string; installId: string },
  ): Promise<void> {
    const folder = await privateChild(this.root, 'package-vault')
    await removePrivateCode(folder, release.archive.sha256, {
      retirementId: `${ownership.operationId}-${ownership.installId}`,
      verifyPublished: async (directory) => {
        await this.checked(directory, release, pins)
      },
    })
  }
}
