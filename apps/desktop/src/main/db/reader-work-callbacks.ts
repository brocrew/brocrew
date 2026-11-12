export function readerWorkCallbacks(
  cancellation: SharedArrayBuffer,
  report: (completed: number) => void,
): { cancelled: () => boolean; progress: () => void } {
  const flag = new Int32Array(cancellation)
  let completed = 0
  let reportedAt = performance.now()
  return {
    cancelled: () => Atomics.load(flag, 0) !== 0,
    progress: () => {
      if (++completed % 256 === 0 && performance.now() - reportedAt >= 100) {
        reportedAt = performance.now()
        report(completed)
      }
    },
  }
}
