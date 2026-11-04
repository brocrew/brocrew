import type { KeyObject } from 'node:crypto'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import {
  type PluginReleasePin,
  type VerifiedPluginCatalogue,
  verifyPluginPackage,
} from '../package-verifier'
import { parsePluginCatalogue } from '../package-schema'
import type { PluginRelease, PluginTarget } from '../package-schema'
import { pluginSha256 } from '../package-digests'
import {
  privateChild,
  immutableFile,
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
    _key: KeyObject | null,
    private readonly target: PluginTarget,
    _repoCatalogueSha256?: string,
    private readonly appVersion = '',
  ) {}
  private async checked(directory: string, release: Readonly<VaultRelease>) {
    const names = (await readdir(directory)).sort()
    if (names.includes('release.json')) {
      const descriptor = JSON.parse(
        (await sourceBytes(join(directory, 'release.json'), Number.MAX_SAFE_INTEGER)).toString(
          'utf8',
        ),
      ) as PluginRelease
      if (
        descriptor.id !== release.id ||
        descriptor.version !== release.version ||
        descriptor.archive.sha256 !== release.archive.sha256 ||
        descriptor.manifestSha256 !== release.manifestSha256
      )
        throw new PluginSupervisorError('unavailable')
      const archive = await sourceBytes(join(directory, 'archive'), Number.MAX_SAFE_INTEGER)
      const pkg = verifyPluginPackage(
        archive,
        {
          sha256: descriptor.archive.sha256,
          bytes: descriptor.archive.size,
          compression: descriptor.archive.compression,
        },
        { target: this.target, appVersion: this.appVersion },
      )
      if (
        pkg.manifest.id !== release.id ||
        pkg.manifest.version !== release.version ||
        pluginSha256(pkg.readFile('plugin.json')!) !== release.manifestSha256
      )
        throw new PluginSupervisorError('unavailable')
      return pkg
    }
    // Migration reader: the old catalogue supplies its release descriptor, never source proof.
    const entries = parsePluginCatalogue(
      await sourceBytes(join(directory, 'catalogue.json'), Number.MAX_SAFE_INTEGER),
    )
    const entry = entries.find(
      (one) =>
        one.id === release.id &&
        one.version === release.version &&
        one.archive.sha256 === release.archive.sha256 &&
        one.manifestSha256 === release.manifestSha256,
    )
    if (!entry) throw new PluginSupervisorError('unavailable')
    const archive = await sourceBytes(join(directory, 'archive'), Number.MAX_SAFE_INTEGER)
    const pkg = verifyPluginPackage(
      archive,
      { sha256: entry.archive.sha256, bytes: entry.archive.size },
      { target: this.target, appVersion: this.appVersion },
    )
    if (
      pkg.manifest.id !== release.id ||
      pkg.manifest.version !== release.version ||
      pluginSha256(pkg.readFile('plugin.json')!) !== release.manifestSha256
    )
      throw new PluginSupervisorError('unavailable')
    return pkg
  }
  async stage(
    release: Readonly<PluginRelease>,
    archive: Uint8Array,
    _catalogue: { bytes: Uint8Array; signature: Uint8Array },
    pins: readonly PluginReleasePin[],
  ) {
    void pins
    // Inspect before publishing; source metadata is not retained as installation authority.
    const checked = verifyPluginPackage(
      archive,
      {
        sha256: release.archive.sha256,
        bytes: release.archive.size,
        compression: release.archive.compression,
      },
      { target: this.target, appVersion: this.appVersion },
    )
    if (
      checked.manifest.id !== release.id ||
      checked.manifest.version !== release.version ||
      pluginSha256(checked.readFile('plugin.json')!) !== release.manifestSha256
    )
      throw new PluginSupervisorError('unavailable')
    const folder = await privateChild(this.root, 'package-vault')
    const kept = await publishPrivateDirectory(
      folder,
      release.archive.sha256,
      async (stage) => {
        await immutableFile(join(stage, 'archive'), archive)
        await immutableFile(join(stage, 'release.json'), Buffer.from(JSON.stringify(release)))
      },
      async (directory) => {
        await this.checked(directory, release)
      },
    )
    return this.checked(kept, release)
  }

  async selection(digest: string) {
    const folder = await privateChild(this.root, 'package-vault', false)
    const directory = await privateChild(folder, digest, false)
    let release: PluginRelease
    try {
      release = JSON.parse(
        (await sourceBytes(join(directory, 'release.json'), Number.MAX_SAFE_INTEGER)).toString(
          'utf8',
        ),
      ) as PluginRelease
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const entries = parsePluginCatalogue(
        await sourceBytes(join(directory, 'catalogue.json'), Number.MAX_SAFE_INTEGER),
      )
      const entry = entries.find((one) => one.archive.sha256 === digest)
      if (!entry) throw new PluginSupervisorError('unavailable')
      release = entry
    }
    if (release.archive.sha256 !== digest) throw new PluginSupervisorError('unavailable')
    const pkg = await this.checked(directory, release)
    const archive = await sourceBytes(join(directory, 'archive'), Number.MAX_SAFE_INTEGER)
    return { release, package: pkg, archive }
  }
  async load(
    release: Readonly<VaultRelease>,
    pins: readonly PluginReleasePin[],
    admitted?: VerifiedPluginCatalogue,
  ) {
    void pins
    void admitted
    const folder = await privateChild(this.root, 'package-vault', false)
    const directory = await privateChild(folder, release.archive.sha256, false)
    return this.checked(directory, release)
  }
  async remove(
    release: Readonly<VaultRelease>,
    pins: readonly PluginReleasePin[],
    ownership: { operationId: string; installId: string },
  ): Promise<void> {
    void pins
    const folder = await privateChild(this.root, 'package-vault')
    await removePrivateCode(folder, release.archive.sha256, {
      retirementId: `${ownership.operationId}-${ownership.installId}`,
      verifyPublished: async (directory) => {
        await this.checked(directory, release)
      },
    })
  }
}
