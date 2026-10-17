/** Publishes only the newest read in this lane and scope. */
export function readPublicationLane<Value>(callbacks: {
  readonly reading: () => void
  readonly ready: (value: Value) => void
  readonly unavailable: (error: unknown) => void
}) {
  let sequence = 0
  let closed = false
  return {
    async refresh(read: () => Promise<Value>): Promise<void> {
      if (closed) return
      const mine = ++sequence
      callbacks.reading()
      try {
        const answer = await read()
        if (!closed && mine === sequence) callbacks.ready(answer)
      } catch (error) {
        if (!closed && mine === sequence) callbacks.unavailable(error)
      }
    },
    changeScope(): void {
      sequence++
    },
    close(): void {
      closed = true
      sequence++
    },
  }
}
