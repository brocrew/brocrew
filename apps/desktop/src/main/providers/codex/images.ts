import { isAbsolute, join } from 'node:path'
import { GENERATED_IMAGES_DIRNAME, IMAGE_MEDIA_TYPES } from '@brobot2/runtime'
import type { ResolveImagePath } from '../../archive/transcript-types'
export function imageResolver(
  threadId: string,
  homeOf: () => string | null,
  resolveAsset: (candidate: string) => string | null,
): ResolveImagePath {
  return ({ imageId, savedPath }) => {
    const home = homeOf()
    // The provider's own claim first, then the naming convention both measured files follow —
    // `generated_images/<threadId>/<call_id>.<ext>`. Neither is trusted; they differ only in
    // where the string came from, and the check below is identical for both.
    const candidates = [
      ...(savedPath ? [savedPath] : []),
      ...(home === null
        ? []
        : [...IMAGE_MEDIA_TYPES.keys()].map((ext) =>
            join(home, GENERATED_IMAGES_DIRNAME, threadId, `${imageId}${ext}`),
          )),
    ]
    for (const candidate of candidates) {
      if (!isAbsolute(candidate)) continue
      const asset = resolveAsset(candidate)
      // The REAL path the door resolved, not the claim: a symlink that passes the check is served
      // as what it points at, so that is what the ledger should name.
      if (asset) return asset
    }
    return null
  }
}
