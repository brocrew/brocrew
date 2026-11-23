/** True when the promise has not settled after `ms`: it is still waiting, whichever way it ends. */
export async function stillWaiting(promise: Promise<unknown>, ms = 100): Promise<boolean> {
  const quiet = Symbol('quiet')
  const first = await Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled',
    ),
    new Promise<typeof quiet>((resolve) => setTimeout(() => resolve(quiet), ms)),
  ])
  return first === quiet
}
