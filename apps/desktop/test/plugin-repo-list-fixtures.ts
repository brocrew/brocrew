import type { PluginRelease } from '../src/main/plugins/package-schema'
export function repoListFor(release: PluginRelease, name = 'Fictional bakery') {
  return {
    format: 1,
    entries: [
      {
        id: release.id,
        name,
        description: release.description ?? 'Fictional test plugin.',
        version: release.version,
        minAppVersion: '0.0.0',
        sourceCommit: release.sourceCommit,
        targets: release.platforms.map((target) => ({
          ...target,
          url:
            'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' +
            release.version +
            '/fictional.tar',
          sha256: release.archive.sha256,
          bytes: release.archive.size,
          compression: release.archive.compression,
          manifestSha256: release.manifestSha256,
        })),
      },
    ],
  }
}
