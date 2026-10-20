import { describe, expect, it } from 'vitest'
import { createPrivateKey, createPublicKey, createSecretKey, sign } from 'node:crypto'
import { strictPluginJson } from '../src/main/plugins/strict-json'
import { pluginPackagePath, PluginPackagePaths } from '../src/main/plugins/package-path'
import { PluginVerificationError } from '../src/main/plugins/verification-error'
import {
  pluginCatalogueSignatures,
  pluginSha256,
  verifyPluginDigest,
} from '../src/main/plugins/package-digests'

const json = (text: string, limit = 1024) => strictPluginJson(Buffer.from(text), limit)

// A public, deterministic fixture seed. It is never a production catalogue signing key.
const fictionalKey = (byte = 0x42) =>
  createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, byte),
    ]),
    format: 'der',
    type: 'pkcs8',
  })

describe('one pinned catalogue key and exact-byte digests', () => {
  it('verifies exact catalogue bytes and refuses whitespace changes or another key', () => {
    const key = fictionalKey()
    const bytes = Buffer.from('{"format":1,"entries":[]}\n')
    const signature = sign(null, bytes, key)
    const verify = pluginCatalogueSignatures(createPublicKey(key))
    expect(() => verify(bytes, signature)).not.toThrow()
    expect(() => verify(Buffer.from('{"format":1,"entries":[]} '), signature)).toThrow(
      PluginVerificationError,
    )
    expect(() => verify(bytes, sign(null, bytes, fictionalKey(0x43)))).toThrow(
      PluginVerificationError,
    )
    expect(() => verify(bytes, signature.subarray(1))).toThrow(PluginVerificationError)
  })

  it('rejects a private key or a non-asymmetric key instead of silently changing key roles', () => {
    expect(() => pluginCatalogueSignatures(fictionalKey())).toThrow(PluginVerificationError)
    expect(() => pluginCatalogueSignatures(createSecretKey(Buffer.alloc(32)))).toThrow(
      PluginVerificationError,
    )
  })

  it('checks size, digest and the bound independently', () => {
    const bytes = Buffer.from('fictional recipe')
    const expected = { size: bytes.length, sha256: pluginSha256(bytes) }
    expect(() => verifyPluginDigest(bytes, expected, 100)).not.toThrow()
    expect(() => verifyPluginDigest(Buffer.from('fictional Recipe'), expected, 100)).toThrow(
      PluginVerificationError,
    )
    expect(() => verifyPluginDigest(bytes, { ...expected, size: bytes.length + 1 }, 100)).toThrow(
      PluginVerificationError,
    )
    expect(() => verifyPluginDigest(bytes, expected, 3)).toThrow(PluginVerificationError)
  })

  it('retains only the approved words when untrusted bytes fail', () => {
    try {
      verifyPluginDigest(Buffer.from('a fictional upstream reply'), { size: 0, sha256: 'x' }, 100)
      throw new Error('the invalid digest was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(PluginVerificationError)
      expect((error as Error).message).toBe('Plugin unavailable. Try again.')
      expect(Object.hasOwn(error as object, 'cause')).toBe(false)
      expect(String(error)).not.toContain('upstream')
    }
  })
})

describe('strict plugin metadata', () => {
  it('reads nested JSON without changing the bytes whose signature is checked', () => {
    expect(json(' {"a":[1,true,null,{"b":"fictional recipe"}]}\n')).toEqual({
      a: [1, true, null, { b: 'fictional recipe' }],
    })
  })

  it.each([
    '{"id":1,"id":2}',
    '{"id":1,"\\u0069d":2}',
    '{"outer":{"id":1,"id":2}}',
    '{"a":1,}',
    '[1,]',
    '{"a":01}',
    '{"a":1e999}',
    'true false',
    '"\\ud800"',
    '"\\udc00"',
  ])('refuses ambiguous or invalid metadata: %s', (text) => {
    expect(() => json(text)).toThrow(PluginVerificationError)
  })

  it('refuses invalid UTF-8 and a byte-order mark', () => {
    for (const bytes of [Buffer.from([0xc0, 0xaf]), Buffer.from('\ufeff{}')]) {
      expect(() => strictPluginJson(bytes, 1024)).toThrow(PluginVerificationError)
    }
    expect(json('"\\ud83c\\udf5e"')).toBe('🍞')
  })

  it('bounds input bytes, nesting and nodes before schema processing', () => {
    expect(() => json('"recipe"', 3)).toThrow(PluginVerificationError)
    expect(() => json('['.repeat(66) + '0' + ']'.repeat(66))).toThrow(PluginVerificationError)
    const many = '[' + '0,'.repeat(100_000) + '0]'
    expect(() => json(many, many.length)).toThrow(PluginVerificationError)
  })

  it('does not let a decoded object key modify object prototypes', () => {
    const value = json('{"__proto__":{"recipe":true}}')
    expect(Object.getPrototypeOf(value)).toBeNull()
    expect(Object.hasOwn(value as object, '__proto__')).toBe(true)
    expect(Object.hasOwn({}, 'recipe')).toBe(false)
  })
})

describe('portable plugin package paths', () => {
  it.each([
    '../recipe',
    '/recipe',
    'C:/recipe',
    'C:recipe',
    'a/../recipe',
    './recipe',
    'a//b',
    'a\\b',
    '\\\\server\\recipe',
    'a:stream',
    'a.',
    'a ',
    'a/NUL.txt',
    'CON',
    'a/COM¹.js',
    'LPT9',
    'a/CONOUT$',
    'a\u0000b',
    'a\u009bb',
    'a?b',
    'a*b',
    'a|b',
    'a<b',
    'a>b',
    'a"b',
    'cafe\u0301',
    'café',
    'node_modules/recipe+extra/index.js',
    '.hidden',
    'parent/.hidden',
    'a'.repeat(256),
  ])('refuses an unsafe portable name: %s', (path) => {
    expect(() => pluginPackagePath(path)).toThrow(PluginVerificationError)
  })

  it('accepts ASCII payload names and scoped node_modules paths', () => {
    expect(pluginPackagePath('dist/recipe.mjs')).toBe('dist/recipe.mjs')
    expect(pluginPackagePath('node_modules/@fictional/bakery_1/index-2.js')).toBe(
      'node_modules/@fictional/bakery_1/index-2.js',
    )
  })

  it.each([
    [
      ['dist/recipe.js', 'file'],
      ['dist/recipe.js', 'file'],
    ],
    [
      ['Dist/a.js', 'file'],
      ['dist/b.js', 'file'],
    ],
    [
      ['dist', 'file'],
      ['dist/a.js', 'file'],
    ],
    [
      ['dist/a.js', 'file'],
      ['dist', 'file'],
    ],
    [
      ['dist', 'directory'],
      ['DIST', 'directory'],
    ],
  ] as const)('refuses collisions and file-parent conflicts: %j', (first, second) => {
    const paths = new PluginPackagePaths()
    expect(() => {
      for (const [path, kind] of [first, second]) paths.add(path, kind)
    }).toThrow(PluginVerificationError)
  })

  it('allows an explicit directory after its implied parent without losing spelling checks', () => {
    const paths = new PluginPackagePaths()
    paths.add('dist/recipe.js', 'file')
    paths.add('dist', 'directory')
    paths.add('dist/more.js', 'file')
    expect(() => paths.add('Dist/last.js', 'file')).toThrow(PluginVerificationError)
  })
})
