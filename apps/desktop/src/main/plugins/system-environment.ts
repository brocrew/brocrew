/**
 * The part of a Windows environment a plugin host process cannot start without: the system folder
 * (sockets, crypto and the system's own programs need `SystemRoot`) and a PATH of the system's own
 * folders alone, so nothing a person or another program installed is found by name. Taken from
 * this app's own environment, and refused unless it names a folder on a drive.
 */
export function windowsSystemEnvironment(
  from: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const root = from['SystemRoot'] ?? from['windir']
  if (!root || !/^[A-Za-z]:\\[^;"<>|?*\0]*$/.test(root)) throw new Error('unsupported')
  return {
    SystemRoot: root,
    windir: root,
    SystemDrive: root.slice(0, 2),
    PATH: [`${root}\\System32`, root, `${root}\\System32\\WindowsPowerShell\\v1.0`].join(';'),
  }
}
