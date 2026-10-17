// Download the desktop package's Electron binary through its `install.js` postinstall,
// unless `ELECTRON_SKIP_BINARY_DOWNLOAD` requests an install without downloads.
// Use Node rather than a shell conditional so installation also works in Windows cmd.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

if (!process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  // ⚑ Resolved from the package being installed (pnpm runs a postinstall in its own folder).
  const require = createRequire(join(process.cwd(), 'package.json'))
  execFileSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' })
}
