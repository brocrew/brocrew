import type { StorageError, StoragePartId } from '../../../shared/storage'
export const STORAGE_PARTS: Readonly<
  Record<StoragePartId, { name: string; meaning: string; colour: string }>
> = {
  workspace: {
    name: 'Workspace',
    meaning: 'Files your agents made and project folders',
    colour: '#5276a6',
  },
  'provider-conversations': {
    name: 'Provider conversations',
    meaning: 'Claude and Codex history and settings for each agent',
    colour: '#7b68a2',
  },
  'agent-output': {
    name: 'Agent output',
    meaning: 'Logs and results from finished work',
    colour: '#4e8c84',
  },
  database: { name: 'Database', meaning: 'Conversations, work and memory', colour: '#b08142' },
  backups: { name: 'Backups', meaning: 'Copies made before updates', colour: '#a65f72' },
  plugins: { name: 'Plugins', meaning: 'Installed plugins and their data', colour: '#6d858f' },
  cache: { name: 'Cache', meaning: 'Temporary files BroCrew can rebuild', colour: '#8b9460' },
  'app-resources': {
    name: 'Attachments',
    meaning: 'Files kept from your conversations',
    colour: '#98999d',
  },
}
export function storageSize(bytes: number | null): string {
  if (bytes === null) return 'Unavailable'
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
export function storageError(error: StorageError): string {
  switch (error) {
    case 'outside-data':
    case 'linked-path':
      return 'This folder cannot be opened safely from BroCrew’s storage folders.'
    case 'limit':
      return 'Some sizes could not be measured within the time limit.'
    case 'busy':
      return 'Storage is busy. Try again in a moment.'
    case 'cancelled':
      return 'The storage measurement was cancelled.'
    case 'not-directory':
      return 'This item is not a folder.'
    case 'invalid-location':
      return 'This folder is no longer available.'
    default:
      return 'Storage could not be read. Try again.'
  }
}
