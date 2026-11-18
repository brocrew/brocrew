import { readSmallJson } from './dock-label'
import { writeWorkspaceFile } from './themes/state'

/** Where earlier versions read how long to keep provider transcripts before deleting them. */
const TRANSCRIPT_RETENTION_FILE = 'transcript-retention.json'
const TRANSCRIPT_RETENTION_BYTES = 65536

/**
 * BroCrew never deletes provider transcripts. An earlier version reopened on this workspace reads
 * this file and deletes transcripts older than the period it names, 90 days when the file is
 * missing, so the file is set to `forever` once, keeping the rest of what it holds.
 */
export async function keepTranscriptsForever(userData: string): Promise<void> {
  const read = await readSmallJson(userData, TRANSCRIPT_RETENTION_FILE, TRANSCRIPT_RETENTION_BYTES)
  const saved =
    read !== null && typeof read === 'object' && !Array.isArray(read)
      ? (read as Record<string, unknown>)
      : {}
  if (saved.period === 'forever') return
  await writeWorkspaceFile(
    userData,
    TRANSCRIPT_RETENTION_FILE,
    JSON.stringify({ ...saved, period: 'forever', scanAfter: '' }) + '\n',
  )
}
