import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ids = new Set(['chrome', 'whatsapp'])
const git = (root, args, encoding = 'utf8') =>
  execFileSync('git', ['-C', root, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 }).trimEnd()
const pluginId = (id) => {
  if (!ids.has(id)) throw new Error('Unknown plugin source')
  return id
}
function entries(root, revision, folder) {
  return git(root, ['ls-tree', '-rz', revision, '--', `${folder}/`])
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [header, name] = entry.split('\t')
      const [mode, type, hash] = header.split(' ')
      if (!['100644', '100755'].includes(mode) || type !== 'blob')
        throw new Error('Only regular plugin source files are allowed')
      return { mode, hash, name: name.slice(folder.length + 1) }
    })
}
// The plugin's own tree, then shared runtime and UI files.
const sources = (root, revision, id) =>
  [`plugins/${pluginId(id)}`, 'plugins/shared'].map((folder) => ({
    folder,
    files: entries(root, revision, folder),
  }))

// Generated release tooling lives outside the exported source trees.
function copyPluginSource(root, destination, id) {
  const trees = sources(root, 'HEAD', id)
  if (!trees[0].files.length) throw new Error('Missing plugin source tree')
  for (const { folder, files } of trees) {
    for (const file of files) {
      const from = path.join(root, folder, file.name)
      if (!fs.lstatSync(from).isFile() || fs.lstatSync(from).isSymbolicLink())
        throw new Error('No linked export inputs')
      const to = path.join(destination, folder, file.name)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      fs.chmodSync(to, file.mode === '100755' ? 0o755 : 0o644)
    }
  }
}

/** A fresh standalone plugin repository: its source, release tooling, release test and workflow. */
export function exportPluginRepository(root, destination, id, { readme, releaseTest, workflow }) {
  if (!path.isAbsolute(destination) || fs.existsSync(destination))
    throw new Error('Use a fresh absolute export folder')
  copyPluginSource(root, destination, id)
  fs.mkdirSync(path.join(destination, 'scripts/lib'), { recursive: true })
  for (const name of ['tests-run-in-a-fictional-home.mjs', 'a-test-sees-no-real-home.setup.mjs'])
    fs.copyFileSync(
      path.join(root, 'scripts/lib', name),
      path.join(destination, 'scripts/lib', name),
    )
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'))
  fs.writeFileSync(path.join(destination, '.gitignore'), 'node_modules/\nartifact/\n*.log\n')
  fs.writeFileSync(
    path.join(destination, 'package.json'),
    JSON.stringify(
      {
        name: `brocrew-plugin-${id}`,
        version: JSON.parse(fs.readFileSync(path.join(root, `plugins/${id}/package.json`))).version,
        private: true,
        type: 'module',
        license: 'Apache-2.0',
        scripts: {
          build: `node scripts/build-plugin-release.mjs ${id}`,
          test: 'vitest run --config vitest.release.config.mts',
          typecheck: `tsc --noEmit -p plugins/${id}/tsconfig.json`,
        },
        devDependencies: { vitest: '4.1.10', typescript: '5.9.3', '@types/node': '22.19.15' },
      },
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(destination, 'package-lock.json'),
    JSON.stringify(
      JSON.parse(
        fs.readFileSync(path.join(root, `plugins/${id}/release-tooling-lock.json`), 'utf8'),
      ),
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(path.join(destination, 'README.md'), readme)
  fs.copyFileSync(
    path.join(root, 'scripts/build-plugin-release.mjs'),
    path.join(destination, 'scripts/build-plugin-release.mjs'),
  )
  fs.mkdirSync(path.join(destination, 'release-test'))
  fs.writeFileSync(path.join(destination, 'release-test/release.test.ts'), releaseTest)
  fs.writeFileSync(
    path.join(destination, 'vitest.release.config.mts'),
    `import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from './scripts/lib/tests-run-in-a-fictional-home.mjs'
export default defineConfig({
  test: { environment: 'node', env: theTestsEnv(), setupFiles: [THE_GUARD],
    include: ['plugins/${id}/test/**/*.test.ts', 'release-test/*.test.ts'],
    exclude: ['plugins/chrome/test/archive.test.ts'],
  },
})
`,
  )

  fs.mkdirSync(path.join(destination, '.github/workflows'), { recursive: true })
  fs.writeFileSync(path.join(destination, '.github/workflows/release.yml'), workflow)
}
