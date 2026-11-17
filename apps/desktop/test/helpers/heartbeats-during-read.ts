export function heartbeatsDuringRead(
  heartbeats: readonly number[],
  interval: { startedAt: number; finishedAt: number },
): number {
  return heartbeats.filter((at) => at > interval.startedAt && at < interval.finishedAt).length
}
