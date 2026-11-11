import os from 'node:os'
import path from 'node:path'

export function browserEnvironment(
  from: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const home = os.userInfo().homedir
  return {
    ...from,
    HOME: home,
    ...(platform === 'win32'
      ? {
          USERPROFILE: home,
          APPDATA: path.win32.join(home, 'AppData', 'Roaming'),
          LOCALAPPDATA: path.win32.join(home, 'AppData', 'Local'),
        }
      : {}),
  }
}
