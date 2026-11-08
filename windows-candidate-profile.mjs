import assert from 'node:assert/strict'

export function candidateProfile(version = '0.2.11') {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'candidate version must be an exact numeric version')
  return { version, installerName: `BroCrew-Setup-${version}-x64.exe` }
}

export function assertProductVersion(actual, expected) {
  assert(actual === expected || actual === `${expected}.0`, 'unexpected installed Windows ProductVersion')
}

export function assertCandidateBuild(app, version, sourceSha) {
  assert.equal(app.version, version)
  assert.equal(app.build.commit, sourceSha, 'installed candidate must carry exact approved source commit')
  assert.equal(app.build.dirty, false)
}

export function observeCandidateExit(child, record) {
  return new Promise(resolve => child.once('exit', (code, signal) => {
    Object.assign(record, { code, signal, observed: true })
    resolve(record)
  }))
}
