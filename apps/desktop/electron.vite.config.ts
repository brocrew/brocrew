import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { cspMetaTag } from './src/shared/content-security-policy'
import { describeBuild, readBuildBranches } from './src/main/build-stamp'

// Bundle the internal workspace packages into main/preload (they are TS source,
// not publishable JS), while letting real deps (better-sqlite3, drizzle-orm, …)
// stay externalized so the native binding loads from node_modules at runtime.
const workspacePackages = ['@brobot2/shared', '@brobot2/runtime', '@brobot2/orchestration']

// Ports pinned deliberately off Vite's default 5173 — that and 5174/5175 are in
// use by other local dev on this machine. strictPort makes a collision loud.
//
// Overridable so a second instance can coexist with a dev app you already have open: the UI
// smoke owns its target (050) and passes free ports here, which is what lets it launch its own
// build while you keep working. Without this the CDP port and user-data dir were isolated but
// Vite's fixed ports still collided.
const RENDERER_PORT = Number(process.env.BROBOT_RENDERER_PORT ?? 5290)
const RENDERER_HMR_PORT = Number(process.env.BROBOT_RENDERER_HMR_PORT ?? 24679)

// Copy committed Drizzle migrations next to the built main bundle so the startup
// migrator resolves them via `__dirname/migrations` in both dev and build.
//
// ⛔ The destination is emptied first: a copy over it would keep every file a build before it put
// there, and D-016 deleted the forty-nine migrations it replaced with one — left behind, they would
// ship in a packaged build beside the journal that no longer names them.
function copyMigrations() {
  return {
    name: 'brobot2:copy-migrations',
    closeBundle() {
      const src = resolve(__dirname, 'src/main/db/migrations')
      const dest = resolve(__dirname, 'out/main/migrations')
      if (existsSync(src)) {
        rmSync(dest, { recursive: true, force: true })
        mkdirSync(dest, { recursive: true })
        cpSync(src, dest, { recursive: true })
      }
    },
  }
}

/**
 * Stamp the Content-Security-Policy into the PACKAGED document (071).
 *
 * Build-only. The dev server serves this same `index.html`, and a document holding both a meta
 * policy and the header the main process installs is held to the intersection of the two — so a
 * static tag would make the dev server's own websocket unreachable and break HMR. The policy and
 * the reason both live in `src/shared/content-security-policy.ts`; this is only where it is applied.
 */
function contentSecurityPolicy() {
  return {
    name: 'brobot2:csp',
    apply: 'build' as const,
    transformIndexHtml() {
      return [cspMetaTag()]
    },
  }
}

/**
 * Verify that the build stamp reached the emitted bundle. If Vite stops applying the `define`, `buildIdentity()` silently falls back to `unknown` while the chip still renders, hiding which build is running.
 *
 * ⚠️ **It asserts the literal we stamped, not a shape**, so it holds in all four states — a sha, a
 * dirty sha, `dev`, `unknown` — and it reads the emitted chunks rather than the file system, so it
 * cannot be fooled by a stale `out/` from an earlier build. `pnpm run build` is in `ci`, which is
 * what makes this a gate rather than a comment.
 *
 * ⛔ **What it cannot see, said out loud: the `unknown` build.** `build-identity.ts` spells
 * `unknown` itself as its fallback, so when `git` could not answer, the literal this looks for is in
 * the chunk whether or not the `define` was applied. ⚑ That is the one state where this guard is
 * blind, and it is the state where the app is already saying it does not know — every build that
 * has an answer to lose is still covered. Measured: with a `git` that exits 128 the bundle emits
 * `const id = "unknown".length > 0 ? "unknown" : NO_STAMP` and this passes, correctly and for a
 * reason it could not distinguish.
 */
export function stampReachedTheBundle(id: string) {
  return {
    name: 'brobot2:build-stamp-landed',
    writeBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
      const stamped = Object.values(bundle).some(
        (chunk) => chunk.type === 'chunk' && (chunk.code ?? '').includes(JSON.stringify(id)),
      )
      if (!stamped) {
        throw new Error(
          `the build stamp ${JSON.stringify(id)} is in no emitted main chunk — ` +
            '`define` did not reach `src/main/build-identity.ts`, so the running app would say ' +
            '"unknown" for its own commit. See apps/desktop/src/main/build-stamp.ts.',
        )
      }
    },
  }
}

/**
 * ⚑ **A FUNCTION rather than an object, so the build can know which build it is** (331).
 * `electron-vite` calls this with `command: 'build'` for `electron-vite build` and `'serve'` for
 * `electron-vite dev` — the one bit that separates *"this is commit e76e7c6"* from *"this is a dev
 * server and no commit describes it"*. See `src/main/build-stamp.ts` for why the second answer is
 * a word and not a stale sha.
 */
export default defineConfig(({ command }) => {
  const build = describeBuild(command)
  /**
   * ⛔ **`main` only.** The renderer already receives this over `app:info`, and a second copy
   * compiled into the renderer bundle would be a second thing to keep true.
   *
   * ⚠️ **This is the whole reason the stamp is a `define` and not a generated file**: the value
   * changes on every build, and `out/` is git-ignored while every file that is not is hashed by
   * `mutations:check` or read by `format:check`. A build must leave the tree exactly as it found
   * it.
   */
  const define = {
    __BUILD_ID__: JSON.stringify(build.id),
    __BUILD_COMMIT__: JSON.stringify(build.commit),
    __BUILD_DIRTY__: JSON.stringify(build.dirty),
    // ⚑ F077 · which of `dev`, `prompts` and `ui` a build of `develop` holds — `null` otherwise.
    __BUILD_BRANCHES__: JSON.stringify(command === 'build' ? readBuildBranches() : null),
  }
  return {
    main: {
      define,
      plugins: [
        externalizeDepsPlugin({ exclude: workspacePackages }),
        copyMigrations(),
        stampReachedTheBundle(build.id),
      ],
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
      // Two preloads: the app window's, and the recovery window's (`window.recovery` only). Both are
      // sandboxed and cannot load a shared chunk, so the two share no module but `electron`.
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/preload/index.ts'),
            recovery: resolve(__dirname, 'src/preload/recovery.ts'),
          },
        },
      },
    },
    renderer: {
      plugins: [vue(), contentSecurityPolicy()],
      // Two documents: the app, and the recovery window main loads when the data can't be opened
      // normally. Both get the CSP stamp, since the plugin above transforms every HTML input.
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            recovery: resolve(__dirname, 'src/renderer/recovery.html'),
          },
        },
      },
      server: {
        port: RENDERER_PORT,
        strictPort: true,
        hmr: { port: RENDERER_HMR_PORT },
      },
    },
  }
})
