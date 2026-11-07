import * as disk from '../../src/main/plugins/state/disk'
export function displayRead(options: { root: string; workspaceRoots: string[] }, id: string) {
  const read = Reflect.get(disk, 'readInstalledPluginDescriptor') as
    ((options: { root: string; workspaceRoots: string[] }, id: string) => unknown) | undefined
  return read?.(options, id) ?? null
}
