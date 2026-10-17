/**
 * 🔴 **A BroBot started by BroBot is built, never copied** (A2's rule): its arguments are named one
 * by one — the folder, and nothing of this launch's own (`--remote-debugging-port`, a test's
 * switches) — and so is its environment.
 */

/**
 * The environment a BroBot this one starts runs in: this one, without what only this launch was
 * given — BroBot's own switches (`BROBOT_…`), Electron's (`ELECTRON_…`) and Node's (`NODE_OPTIONS`).
 */
export function builtEnvironment(
  env: NodeJS.ProcessEnv,
  /** Names kept all the same: a development build's `ELECTRON_RENDERER_URL`, its renderer. */
  keep: readonly string[] = [],
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => keep.includes(name) || !/^(BROBOT_|ELECTRON_)|^NODE_OPTIONS$/i.test(name),
    ),
  )
}
