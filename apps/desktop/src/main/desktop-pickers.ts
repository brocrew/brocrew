import type { HandedPath } from '../shared/attachment-contracts'
import { ipcMain } from './app-ipc'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard } from 'electron'
import type { OpenDialogOptions } from 'electron'
import type { ChosenAttachment, ChosenCwd, DroppedPathVerdict } from '../shared/runtime-ipc'
import { BUNDLE_SUFFIX, NO_IMAGE_ON_CLIPBOARD } from '../shared/runtime-ipc'
import { checkSessionCwd } from './runtime/scratch-cwd'
import { captionHandedPaths, classifyDroppedPaths, classifyHandedPath } from './runtime/handed-path'
import { pastePicture, pastedImagesRoot, tooManyPixels } from './runtime/pasted-image'

const CHOOSE_CWD_OPTIONS: OpenDialogOptions = {
  title: 'Choose a folder for this conversation',
  buttonLabel: 'Use this folder',
  properties: ['openDirectory', 'createDirectory'],
}

const CHOOSE_BUNDLE_OPTIONS: OpenDialogOptions = {
  title: 'Choose a BroCrew session bundle',
  buttonLabel: 'Restore this conversation',
  filters: [
    { name: 'BroCrew session bundle', extensions: [BUNDLE_SUFFIX.split('.').pop() ?? 'json'] },
  ],
  properties: ['openFile'],
}

const CHOOSE_ATTACHMENT_OPTIONS: OpenDialogOptions = {
  title: 'Choose a file or folder to hand to the agent',
  buttonLabel: 'Attach',
  properties: ['openFile', 'openDirectory'],
}

export const CHOOSE_WORKSPACE_OPTIONS: OpenDialogOptions = {
  title: 'Choose a workspace folder',
  buttonLabel: 'Choose',
  properties: ['openDirectory', 'createDirectory'],
}

export function registerPickerIpc(
  pick: (
    owner: BrowserWindow | null,
    options: OpenDialogOptions,
  ) => Promise<{ canceled: boolean; filePaths: string[] }>,
): void {
  ipcMain.handle('app:choose-cwd', async (event): Promise<ChosenCwd> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = await pick(owner, CHOOSE_CWD_OPTIONS)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (picked === undefined) return null
    const verdict = checkSessionCwd(picked)
    return verdict.ok ? { path: verdict.path } : { path: picked, refusal: verdict.reason }
  })
  ipcMain.handle('app:choose-bundle', async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      ...CHOOSE_BUNDLE_OPTIONS,
      defaultPath: join(app.getPath('userData'), 'exports'),
    }
    const result = await pick(owner, options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(
    'app:choose-attachment',
    async (event, input: { cwd?: string } = {}): Promise<ChosenAttachment> => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const result = await pick(owner, CHOOSE_ATTACHMENT_OPTIONS)
      const picked = result.canceled ? undefined : result.filePaths[0]
      if (picked === undefined) return null
      const verdict = await classifyHandedPath(picked, input.cwd ?? '')
      return 'refusal' in verdict ? { refusal: verdict.refusal } : { handed: verdict.handed }
    },
  )

  ipcMain.handle(
    'app:classify-attachments',
    async (_event, input: { handed?: HandedPath[]; cwd?: string } = {}): Promise<HandedPath[]> =>
      await captionHandedPaths(Array.isArray(input.handed) ? input.handed : [], input.cwd ?? ''),
  )

  ipcMain.handle(
    'app:hand-dropped-paths',
    async (_event, input: { paths?: unknown; cwd?: string } = {}): Promise<DroppedPathVerdict[]> =>
      await classifyDroppedPaths(Array.isArray(input.paths) ? input.paths : [], input.cwd ?? ''),
  )

  ipcMain.handle(
    'app:paste-image',
    async (_event, input: { cwd?: string } = {}): Promise<DroppedPathVerdict> => {
      const image = clipboard.readImage()
      if (image.isEmpty()) return { refusal: NO_IMAGE_ON_CLIPBOARD }
      const size = image.getSize()
      const refusal = tooManyPixels(size.width, size.height)
      if (refusal !== null) return { refusal }
      const root = pastedImagesRoot(app.getPath('userData'))
      return await pastePicture(root, image.toPNG(), input.cwd ?? '', Date.now())
    },
  )
}
