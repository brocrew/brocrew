export type BlockedSinceIs = 'told' | 'routed' | 'not-recorded'

export function sinceWords(row: {
  readonly blockedSinceIs: BlockedSinceIs
  readonly since: string | null
}): string {
  if (row.blockedSinceIs === 'not-recorded') return 'no time recorded — listed last, not first'
  return SINCE_PHRASE[row.blockedSinceIs](row.since)
}

const SINCE_PHRASE: Readonly<
  Record<Exclude<BlockedSinceIs, 'not-recorded'>, (since: string | null) => string>
> = {
  told: (since) => `yours since ${since}`,
  routed: (since) => `waiting since ${since}`,
}
