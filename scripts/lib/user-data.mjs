import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/**
 * Derive BroBot's default userData once for removal tools and their target guards. Two
 * independent derivations could validate one folder and remove another without a visible warning.
 * Plain Node tooling cannot ask Electron's running `app`, so reproduce its platform-state
 * folder rule using the package name. `@brobot2/desktop` includes a separator and forms a
 * nested directory, not the flattened name `@brobot2-desktop`.
 */

/**
 * ⚑ **The one data folder of every build** — a developer's and a packaged one, on every system:
 * the package's npm name, which the app also pins at launch (`apps/desktop/src/main/data-folder.ts`,
 * W4.90). ⛔ This module once said a packaged build used a folder named after its `productName`
 * (`BroBot2`); measured on a packaged build, it never did — electron-builder writes no
 * `productName` into the app's `package.json`. ⚠️ **So a packaged BroBot and a development build
 * on one machine share this folder**: a reset of one is a reset of both.
 */
export const DATA_FOLDER_NAME = join('@brobot2', 'desktop')

/** Where Electron puts `userData` for `app` when nothing overrides it. */
export function userDataFor(app, platform = process.platform, env = process.env) {
  switch (platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', app)
    case 'win32':
      return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), app)
    default:
      return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), app)
  }
}

/** The default — what `pnpm dev` writes, and an installed BroBot on the same machine too. */
export function defaultUserData(platform = process.platform, env = process.env) {
  return userDataFor(DATA_FOLDER_NAME, platform, env)
}

/**
 * The clipboard-copy directory, which is a SIBLING of `userData` rather than a child of it.
 *
 * ⚠️ **Named after `userData`'s own basename**, so it moves with `--dir` and there is no fixed
 * `pasted-images` folder anywhere. Mirrors `pastedImagesRoot` in
 * `apps/desktop/src/main/runtime/pasted-image.ts:173-175`, which a test holds this to.
 */
export function pastedImagesRoot(userData) {
  return join(dirname(userData), `${basename(userData)}-pasted-images`)
}
