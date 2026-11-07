import assert from 'node:assert/strict'

export function public019Profile(testPath, customInputs) {
  if (!['public-019-clean', 'public-019-upgrade'].includes(testPath)) return null
  assert.equal(customInputs, false, 'public019 proof forbids custom archive transport')
  return {
    chrome: {
      version: '0.1.9', bytes: 4373190,
      sha256: '9f763685263abfde06f91aa1c26ae93a726a53b568719368650251874c84e57b',
      manifest: '0f13c23a672133fd5f6334230e8c5029f167e57320a6b29bd6a67585b2d8f20a',
      sourceCommit: 'a3acd9f105e666f71d49d1eb967dfe0b790fa762',
      repo: 'brocrew-plugin-chrome',
    },
  }
}
