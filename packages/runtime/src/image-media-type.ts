// SVG is a document and must not be served as a generated image.
export const IMAGE_MEDIA_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

export function imageMediaType(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MEDIA_TYPES.get(path.slice(dot).toLowerCase()) ?? null
}
