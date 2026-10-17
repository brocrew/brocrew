export const APP_NAVIGATE_CHANNEL = 'app:navigate'
export type NavigationDirection = 'back' | 'forward'

export function isNavigationDirection(value: unknown): value is NavigationDirection {
  return value === 'back' || value === 'forward'
}
