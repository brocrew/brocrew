// Read a bounded prefix through the piece index without sorting all of its files.
export const PLUGIN_TITLE_CANDIDATES_SQL = `
  SELECT id, work_id, title, name, sha256
  FROM work_resource INDEXED BY work_resource_work_idx
  WHERE work_id = ? LIMIT 100
`
