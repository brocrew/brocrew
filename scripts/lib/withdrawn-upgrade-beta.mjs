// Original public v0.2.25 receipt, retained before its withdrawal.
export const PREVIOUS_PUBLIC_025 = {
  releaseId: 445299803,
  runId: 43569320876,
  macArtifactId: 14104257436,
  windowsArtifactId: 14104431202,
  tag: 'v0.2.25',
  source: 'fd0249a182f1a9d8d0129c67f028479bfbf83066',
  publishedAt: '2026-11-14T13:28:05Z',
  assets: [
    {
      id: 747508438,
      name: 'BroCrew-0.2.25-arm64-mac.zip',
      size: 365919377,
      digest: 'sha256:48ac708cc86c990fc251f446ef2483eee737a81f782a8dfd13d2d427aca138ec',
    },
    {
      id: 747508433,
      name: 'BroCrew-0.2.25-arm64-mac.zip.blockmap',
      size: 382567,
      digest: 'sha256:59d946defd817dbbecc7bd6f5577983dd339f5fda5505dba6f444e66be129bcb',
    },
    {
      id: 747508440,
      name: 'BroCrew-0.2.25-arm64.dmg',
      size: 368200292,
      digest: 'sha256:f26f163c589f7c1ced308c6b6712fa2b94c6e4d6924243f5cb823d4c4db7632b',
    },
    {
      id: 747508436,
      name: 'BroCrew-0.2.25-arm64.dmg.blockmap',
      size: 384140,
      digest: 'sha256:4dc874fc13bb2990f87827bcb86c28519749503ba743e505c29d111cc7e67681',
    },
    {
      id: 747508441,
      name: 'BroCrew-Setup-0.2.25-x64.exe',
      size: 260140296,
      digest: 'sha256:fc93349a5f93a7409d7b0d91369cb736953c00213f3dea9d5557fe49e8b6dfdf',
    },
    {
      id: 747508500,
      name: 'BroCrew-Setup-0.2.25-x64.exe.blockmap',
      size: 271913,
      digest: 'sha256:8bc9ddebe205ce241459b63de76da9acfb93a4d2c1fda10370c2f5d96f907c72',
    },
    {
      id: 747508502,
      name: 'latest-mac.yml',
      size: 509,
      digest: 'sha256:dccbac46ada419f7003effdc03c19f9879f14855de0cebdbacecd1d2fb0fdbfb',
    },
    {
      id: 747508539,
      name: 'latest.yml',
      size: 354,
      digest: 'sha256:dc2fb94d540b859005e1cbb8746e09cfcabed3b4b681a845fab699a05f80b1bf',
    },
  ],
}

export function withdrawnPublicationOf(release, tag) {
  const old = PREVIOUS_PUBLIC_025
  if (
    tag !== old.tag ||
    release?.tag_name !== old.tag ||
    release.id !== old.releaseId ||
    release.draft !== true ||
    release.published_at !== old.publishedAt ||
    release.target_commitish !== old.source ||
    release.predecessorBinding?.runId !== old.runId ||
    release.predecessorBinding.source !== old.source ||
    release.predecessorBinding.tag !== old.tag ||
    release.predecessorBinding.macArtifactId !== old.macArtifactId ||
    release.predecessorBinding.windowsArtifactId !== old.windowsArtifactId ||
    release.assets?.length !== old.assets.length
  )
    return null
  if (
    !old.assets.every((expected) =>
      release.assets.some((actual) =>
        ['id', 'name', 'size', 'digest'].every((key) => actual[key] === expected[key]),
      ),
    )
  )
    return null
  return {
    releaseId: old.releaseId,
    tag: old.tag,
    source: old.source,
    publishedAt: old.publishedAt,
    currentDraft: true,
    predecessorBinding: release.predecessorBinding,
    assets: old.assets,
  }
}
