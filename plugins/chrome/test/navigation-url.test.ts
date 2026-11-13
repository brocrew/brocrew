import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { navigationUrl } from '../src/shared/browser/navigationUrl.js'

describe('navigation addresses', () => {
  it('encodes local filenames as paths, preserving spaces, Unicode, # and ?', () => {
    const file = '/tmp/a space/é#?.html'
    expect(navigationUrl(file)).toBe(pathToFileURL(file).href)
    expect(navigationUrl('file:///tmp/a space/é.html')).toBe('file:///tmp/a%20space/%C3%A9.html')
  })
  it('preserves network/blank and lets Chrome handle other valid URL schemes', () => {
    expect(navigationUrl('https://example.test/a')).toBe('https://example.test/a')
    expect(navigationUrl('about:blank')).toBe('about:blank')
    expect(navigationUrl('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(() => navigationUrl('relative.html')).toThrow('not valid')
  })
})

it.each(['~/.config/file.html', './relative.html', '../relative.html'])(
  'does not expand %s',
  (value) => {
    expect(() => navigationUrl(value)).toThrow('the URL is not valid')
  },
)
it.each(['data:text/html,hello', 'ftp://example.test/file', 'javascript:void(0)'])(
  'passes the navigation URL %s to Chrome',
  (value) => {
    expect(navigationUrl(value)).toBe(new URL(value).href)
  },
)
