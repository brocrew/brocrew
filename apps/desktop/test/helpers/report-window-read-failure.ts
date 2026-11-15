import { onTestFailed } from 'vitest'

export function reportWindowReadFailure(snapshot: () => unknown): void {
  onTestFailed(() => {
    console.info(JSON.stringify({ windowReadFailure: snapshot() }))
  })
}
