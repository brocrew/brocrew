/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS. */
// Keep electron-builder's hook entry inside the app root; share the build-time implementation.
module.exports = require('../../../scripts/prepare-plugin-node-before-pack.cjs')
