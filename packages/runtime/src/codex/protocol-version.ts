/**
 * The Codex CLI version the vendored `protocol/` types were generated from (043, closing 036
 * P2-6). The adapter parses the app-server wire protocol through those generated types, so a
 * PATH `codex` of a different version can silently mis-parse it — new/renamed fields read as
 * `undefined`, changed unions fall to our `unknown` branches — and the failure surfaces as
 * confusing behavior rather than a clear version error.
 *
 * `assertProtocolVersion` (see `codex-runtime.ts`) compares this against the version the
 * app-server reports in its `initialize` response and fails the launch closed on a mismatch.
 *
 * **Reproduce the vendored types exactly** (verified byte-identical for 0.160.0):
 * ```
 * pnpm run protocol:check     # regenerate into a temp dir and assert no diff
 * pnpm run protocol:generate  # rewrite packages/runtime/src/codex/protocol in place
 * ```
 * Both run `codex app-server generate-ts --out <dir> --experimental`. `--experimental` is
 * REQUIRED (it emits the experimental surface we vendor), and the output must NOT be passed
 * through prettier — the checked-in files are raw ts-rs output, which is why
 * `.prettierignore` excludes the protocol directory.
 *
 * On a version bump (one version source since 014 — the app bundles its own codex): change the
 * `@openai/codex-darwin-arm64` pin in apps/desktop/package.json, `pnpm install`, run
 * `pnpm run protocol:generate` (which uses the bundled binary, never a PATH one), update this
 * constant, and re-run the suites.
 */
export const CODEX_PROTOCOL_VERSION = '0.160.0'

/**
 * The Codex version an `initialize` response advertises, or `null` when it carries none we can
 * read. The app-server reports a `userAgent` whose FIRST token is `<clientName>/<codexVersion>`
 * — e.g. `brobot2/0.145.0 (Mac OS 26.3.0; arm64) …` — where the client name is the one we sent
 * in `clientInfo`; our own client version appears later in the string and is deliberately not
 * matched here.
 */
export function codexVersionFromUserAgent(userAgent: string): string | null {
  const match = /^[^/\s]+\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(userAgent.trim())
  return match ? match[1]! : null
}
