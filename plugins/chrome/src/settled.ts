export async function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p.then(
        () => true,
        () => true,
      ),
      new Promise<false>((r) => {
        timer = setTimeout(() => r(false), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
