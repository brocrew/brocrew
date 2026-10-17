import type { ThemeStoreProblem } from './store'
import { PRODUCT_NAME } from '../../shared/product-name'

const PROBLEMS: Readonly<Record<ThemeStoreProblem, string>> = {
  unreadable: 'The file could not be read.',
  changed: 'The file changed while it was being read.',
  link: 'Theme files cannot be symbolic links.',
  outside: "The file is outside the theme's folder.",
  'too-large': 'The theme is over the file or size limit. Use fewer or smaller files.',
  'json-size': 'The theme file is over 256 KB.',
  json: 'The theme file is not valid JSON.',
  id: "The theme's id must match its folder's name.",
  files: 'The theme has too many files or folders.',
  'duplicate-asset': 'Two assets have the same name.',
  'asset-input': 'Supply a file path or base64 for each asset.',
  'absolute-path': 'The asset path must be absolute.',
  base64: 'The asset is not valid base64.',
  decode: 'The picture could not be decoded.',
  save: 'The theme could not be saved.',
  busy: `Another ${PRODUCT_NAME} window is saving this theme. Try again when it finishes.`,
  choice: 'The theme choice could not be saved.',
  trash: 'The theme could not be moved to the Trash.',
  'open-folder': 'The themes folder could not be opened.',
  fallback: "This theme is missing or can't be used, so the default look is shown.",
}

export const themeProblem = (kind: ThemeStoreProblem): string => PROBLEMS[kind]

export const THEME_PICTURE_FORMAT_PROBLEM = "WebP pictures aren't supported yet. Use PNG or JPEG"
export const themeFilesProblem = (count: number, maximum: number): string =>
  `The theme has ${count} files; it can have up to ${maximum}.`
export const themeFontsProblem = (count: number, maximum: number): string =>
  `The theme has ${count} fonts; it can have up to ${maximum}.`

function sizeWords(
  size: number,
  maximum: number,
  complete = true,
): { size: string; limit: string } {
  const unit = maximum >= 1024 * 1024 ? 1024 * 1024 : 1024
  const label = unit === 1024 ? 'KB' : 'MB'
  const limit = `${maximum / unit} ${label}`
  const floored = Math.floor((size * 10) / unit) / 10
  return {
    size: !complete || floored * unit <= maximum ? `over ${limit}` : `${floored} ${label}`,
    limit,
  }
}

export function themeFileSizeProblem(file: string, size: number, maximum: number): string {
  const words = sizeWords(size, maximum)
  return `${file} is ${words.size}; it can be up to ${words.limit}.`
}

export function themeSizeProblem(size: number, maximum: number, complete = true): string {
  const words = sizeWords(size, maximum, complete)
  return `The theme is ${words.size}; it can be up to ${words.limit}.`
}
