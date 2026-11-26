async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

export { waitFor }
