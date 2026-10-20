/** Test-only trusted fixture preload; the plugin page receives the separate production DOM bridge. */
import { contextBridge, ipcRenderer } from 'electron'
import { pluginsBridge } from '../src/preload/plugins'
contextBridge.exposeInMainWorld('fixturePlugins', pluginsBridge(ipcRenderer))
