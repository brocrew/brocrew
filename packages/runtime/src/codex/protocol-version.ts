/**
 * The Codex CLI version the vendored `protocol/` types were generated from. The adapter parses the
 * wire protocol through those types, so a different `codex` can silently mis-parse it.
 * `validateCodexProtocolVersion` (`runtime-parts/session-views.ts`) compares this against the
 * version the app-server reports in `initialize` and fails the launch on a mismatch.
 *
 * Reproduce the vendored types exactly:
 * ```
 * pnpm run protocol:check     # regenerate into a temp dir and assert no diff
 * pnpm run protocol:generate  # rewrite packages/runtime/src/codex/protocol in place
 * ```
 * Both run `codex app-server generate-ts --out <dir> --experimental`. `--experimental` is required
 * (it emits the experimental surface we vendor), and the output must not go through prettier, which
 * is why `.prettierignore` excludes the protocol directory.
 *
 * On a version bump, change the `@openai/codex-darwin-arm64` pin in apps/desktop/package.json,
 * `pnpm install`, run `pnpm run protocol:generate` (it uses the bundled binary), update this
 * constant, and re-run the suites.
 */
export const CODEX_PROTOCOL_VERSION = '0.167.1'

/**
 * The Codex version an `initialize` response advertises, or `null` when none is readable. The
 * `userAgent`'s first token is `<clientName>/<codexVersion>`, e.g. `brobot2/0.145.0 (Mac OS ...)`;
 * our own client version appears later and is deliberately not matched.
 */
export function codexVersionFromUserAgent(userAgent: string): string | null {
  const match = /^[^/\s]+\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(userAgent.trim())
  return match ? match[1]! : null
}
