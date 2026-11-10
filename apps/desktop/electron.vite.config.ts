import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { cspMetaTag } from './src/shared/content-security-policy'
import { describeBuild, readBuildBranches } from './src/main/build-stamp'
import { buildPluginSupervisor } from '../../scripts/build-plugin-supervisor.mjs'

const workspacePackages = ['@brobot2/shared', '@brobot2/runtime', '@brobot2/orchestration']

const RENDERER_PORT = Number(process.env.BROBOT_RENDERER_PORT ?? 5290)
const RENDERER_HMR_PORT = Number(process.env.BROBOT_RENDERER_HMR_PORT ?? 24679)

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

function contentSecurityPolicy() {
  return {
    name: 'brobot2:csp',
    apply: 'build' as const,
    transformIndexHtml() {
      return [cspMetaTag()]
    },
  }
}

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

export default defineConfig(({ command }) => {
  const build = describeBuild(command)
  const define = {
    __BROCREW_RELEASE_BUILD__: JSON.stringify(process.env.BROCREW_RELEASE_BUILD === '1'),
    __BUILD_ID__: JSON.stringify(build.id),
    __BUILD_COMMIT__: JSON.stringify(build.commit),
    __BUILD_DIRTY__: JSON.stringify(build.dirty),
    __BUILD_BRANCHES__: JSON.stringify(command === 'build' ? readBuildBranches() : null),
  }
  return {
    main: {
      define,
      plugins: [
        externalizeDepsPlugin({ exclude: workspacePackages }),
        copyMigrations(),
        stampReachedTheBundle(build.id),
        { name: 'brocrew:plugin-supervisor', closeBundle: () => buildPluginSupervisor() },
      ],
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/preload/index.ts'),
            recovery: resolve(__dirname, 'src/preload/recovery.ts'),
            'plugin-ui': resolve(__dirname, 'src/preload/plugin-ui.ts'),
          },
        },
      },
    },
    renderer: {
      plugins: [vue(), contentSecurityPolicy()],
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
