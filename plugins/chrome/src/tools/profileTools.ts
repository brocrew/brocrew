import path from 'node:path'
import { openGuardedFile } from '../localFileGuard.js'
import { listExtensions, webStoreId, webStoreUrl } from '../extensions.js'
import { SETTING_KEYS, readSettings, validateSetting, writeSetting } from '../prefs.js'
import { ToolError } from './schema.js'
import { profileName, usableProfile } from './common.js'
import type { ToolDef } from './common.js'
const TABS_DIE = 'This restarted the profile: its tab ids are dead, call open_tab again.'
const FOLDER_MANIFEST_MAX = 1024 * 1024
function checkUnpackedFolder(folder: string, guard: Parameters<typeof openGuardedFile>[1]): void {
  const file = openGuardedFile(path.join(folder, 'manifest.json'), guard)
  let manifest: unknown
  try {
    if (file.size > FOLDER_MANIFEST_MAX) throw new ToolError('the manifest.json is too large')
    manifest = JSON.parse(file.readAll().toString('utf8'))
  } catch (e) {
    if (e instanceof ToolError) throw e
    throw new ToolError('the folder has no valid manifest.json')
  } finally {
    file.close()
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    typeof (
      manifest as {
        manifest_version?: unknown
      }
    ).manifest_version !== 'number'
  ) {
    throw new ToolError('the folder has no valid manifest.json')
  }
}
export function buildProfileToolDefs(): ToolDef[] {
  return [
    {
      spec: {
        name: 'install_extension',
        description:
          'Ask the user to install a Chrome extension in a profile. source: a Web Store id (32 letters a-p), a Web Store URL, or a folder path under {roots} (an unpacked extension with manifest.json). Nothing installs by itself: a visible Chrome window opens on the right page and the Settings → Plugins → Chrome tells the user what to click; the call returns status "opened" immediately; agents keep using the profile. Restarts the profile (its tab ids die). Needs "Allow extensions" on the profile.',
        props: {
          profile: profileName,
          source: {
            type: 'string',
            description: 'Web Store id, Web Store URL, or folder path.',
            minLength: 1,
            maxLength: 1000,
          },
        },
        required: ['profile', 'source'],
      },
      async run(a, deps) {
        const name = a.profile as string
        usableProfile(deps, name, 'allowExtensions')
        const source = (a.source as string).trim()
        deps.browser.touch(name)
        const id = webStoreId(source)
        if (id) {
          if (listExtensions(deps.browser.dir(name)).some((e) => e.id === id))
            return { json: { status: 'already-installed', id } }
          await deps.windows.open(name, webStoreUrl(id), () =>
            usableProfile(deps, name, 'allowExtensions'),
          )
          return {
            json: {
              status: 'opened',
              message:
                'A Chrome window opened on the extension page. The user has to press "Add to Chrome". ' +
                TABS_DIE,
            },
          }
        }
        if (/^https?:/i.test(source)) throw new ToolError('only Chrome Web Store URLs are accepted')
        checkUnpackedFolder(source, deps.guard())
        await deps.windows.open(name, 'chrome://extensions', () =>
          usableProfile(deps, name, 'allowExtensions'),
        )
        return {
          json: {
            status: 'opened',
            message:
              'A Chrome window opened on the extensions page. The user has to turn on Developer mode, press "Load unpacked" and pick the folder. ' +
              TABS_DIE,
          },
        }
      },
    },
    {
      spec: {
        name: 'list_extensions',
        description:
          'List the extensions installed in a profile: id, name, version, enabled, unpacked. Reads the profile files; the profile is not opened. Needs "Allow extensions".',
        props: { profile: profileName },
        required: ['profile'],
      },
      async run(a, deps) {
        usableProfile(deps, a.profile as string, 'allowExtensions')
        return { json: listExtensions(deps.browser.dir(a.profile as string)) }
      },
    },
    {
      spec: {
        name: 'remove_extension',
        description:
          'Ask the user to remove an extension: a visible window opens on its Chrome page and they click Remove. Files are never deleted by hand. Restarts the profile (its tab ids die). Needs "Allow extensions".',
        props: {
          profile: profileName,
          id: {
            type: 'string',
            description: 'Extension id (32 letters a-p) from list_extensions.',
            pattern: /^[a-p]{32}$/,
          },
        },
        required: ['profile', 'id'],
      },
      async run(a, deps) {
        const name = a.profile as string
        usableProfile(deps, name, 'allowExtensions')
        const id = a.id as string
        if (!listExtensions(deps.browser.dir(name)).some((e) => e.id === id))
          throw new ToolError('that extension is not installed in this profile')
        deps.browser.touch(name)
        await deps.windows.open(name, `chrome://extensions/?id=${id}`, () =>
          usableProfile(deps, name, 'allowExtensions'),
        )
        return {
          json: {
            status: 'opened',
            message:
              'A Chrome window opened on the extension. The user has to click "Remove". ' +
              TABS_DIE,
          },
        }
      },
    },
    {
      spec: {
        name: 'get_settings',
        description: `Read the Chrome settings an agent may manage in a profile (${SETTING_KEYS.join(', ')}); null = Chrome's default. Needs "Allow settings".`,
        props: { profile: profileName },
        required: ['profile'],
      },
      async run(a, deps) {
        usableProfile(deps, a.profile as string, 'allowSettings')
        return { json: { settings: readSettings(deps.browser.dir(a.profile as string)) } }
      },
    },
    {
      spec: {
        name: 'set_setting',
        description:
          'Change one allowlisted Chrome setting of a profile. Closes the profile\'s Chrome, writes the setting, and the next call relaunches it, so its tab ids die. Booleans take true/false, content settings 1 (allow) or 2 (block), intl.accept_languages a list like "en-US,en". Any other key is refused. Needs "Allow settings".',
        props: {
          profile: profileName,
          key: { type: 'string', description: 'The setting key.', enum: SETTING_KEYS },
          value: { type: 'scalar', description: 'The new value (boolean, 1 or 2, or text).' },
        },
        required: ['profile', 'key', 'value'],
      },
      async run(a, deps) {
        const name = a.profile as string
        usableProfile(deps, name, 'allowSettings')
        const key = a.key as string
        const value = validateSetting(key, a.value)
        const wasOpen = await deps.browser.exclusive(name, async () => {
          usableProfile(deps, name, 'allowSettings')
          const open = deps.browser.state(name) !== null
          await deps.browser.close(name)
          usableProfile(deps, name, 'allowSettings')
          writeSetting(deps.browser.dir(name), key, value)
          return open
        })
        return {
          json: {
            ok: true,
            key,
            value,
            note: wasOpen
              ? TABS_DIE
              : 'The profile was closed; the next open_tab starts it with the setting.',
          },
        }
      },
    },
  ]
}
