/** The words a person reads about themes: the Themes section and the toast an agent's change raises. */
export const THEME_WORDS = {
  section: 'Themes',
  loading: 'Loading themes…',
  use: 'Use',
  inUse: 'In use',
  builtIn: 'Built in',
  duplicate: 'Duplicate',
  delete: 'Delete',
  openFolder: 'Open themes folder',
  cannotUse: (reason: string): string => `Can't use this theme: ${reason}`,
  changedBy: (agent: string, theme: string): string => `${agent} changed the theme to ${theme}.`,
  deleted: "Theme deleted. It's in the Trash.",
  copyName: (name: string): string => `${name} copy`,
  notDone: "That didn't work. Try again.",
} as const
