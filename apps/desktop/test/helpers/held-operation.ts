/** A step that waits at `hold()` until released; `arrived` settles once the step is reached. */
export function heldOperation() {
  let entered!: () => void
  let release!: () => void
  const arrived = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    arrived,
    release,
    hold: async () => {
      entered()
      await held
    },
  }
}

/** A latch a test opens by hand. */
export function latch(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}
