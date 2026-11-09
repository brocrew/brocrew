import { expect, it } from 'vitest'
import { posix, win32 } from 'node:path'
import { isInside } from '../src/paths'

it('compares containment with platform case rules and an explicit equality choice', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const paths = platform === 'win32' ? win32 : posix
    const root = platform === 'win32' ? 'C:\\Users\\Alex' : '/Users/Alex'
    const options = { platform }
    expect(isInside(root, root, options)).toBe(true)
    expect(isInside(root, root, { ...options, orSame: false })).toBe(false)
    expect(isInside(root, root.toLowerCase(), options)).toBe(platform !== 'linux')
    expect(isInside(root, root.toLowerCase(), { ...options, orSame: false })).toBe(false)
    expect(isInside(root, paths.join(root, 'file'), { ...options, orSame: false })).toBe(true)
    expect(isInside(root, paths.join(root.toLowerCase(), 'file'), options)).toBe(
      platform !== 'linux',
    )
    expect(
      isInside('MixedRoot', paths.join(paths.resolve('MixedRoot').toLowerCase(), 'file'), options),
    ).toBe(platform !== 'linux')
    expect(isInside(root, `${root}-other`, options)).toBe(false)
    expect(isInside(root, paths.dirname(root), options)).toBe(false)
    expect(isInside(root, paths.join(root, '..', 'elsewhere'), options)).toBe(false)
    expect(isInside(root, paths.join(root, '..notes'), options)).toBe(true)
    const filesystemRoot = paths.parse(root).root
    expect(isInside(filesystemRoot, filesystemRoot, { ...options, orSame: false })).toBe(false)
    expect(isInside(filesystemRoot, root, { ...options, orSame: false })).toBe(true)
  }
  expect(isInside('C:\\Users', 'D:\\Users\\Alex', { platform: 'win32' })).toBe(false)
  expect(isInside('\\\\server\\share', '\\\\other\\share\\file', { platform: 'win32' })).toBe(false)
  expect(isInside('C:\\Users', 'c:/users/Alex', { platform: 'win32' })).toBe(true)
})
