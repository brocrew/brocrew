# Windows release signing

The Windows job in `release.yml` uses SSL.com's CodeSignTool through electron-builder 26.15.3's `win.signtoolOptions.sign` hook. Setup uses `sslcom/esigner-codesign` at commit `b7f8ff36fc0de8690fbbab8e5b4421d29802f747` (CodeSignTool 1.3.0), with no credentials and `--version` only. Signing happens inside packaging, before the installer blockmap and update hashes are computed. Nothing signs release files afterwards.

## Maintainer setup

A repository administrator creates the **windows-signing** GitHub environment, chooses **Selected branches and tags**, and adds a **tag** rule matching `v*`, with no branch rules. Restrict who can create release tags. A workflow's `environment:` reference cannot create these deployment restrictions: configure them before adding secrets.

The account owner activates eSigner and adds four environment secrets: `ES_USERNAME`, `ES_PASSWORD`, `CREDENTIAL_ID`, and `ES_TOTP_SECRET`. Do not put them in repository secrets, logs or files. Only the release workflow's Windows build job references this environment. The ordinary Windows workflow, CI, gate branches and upgrade-path builds have no signing account.

With all four secrets absent and the test-only recording mode off, the hook performs no file I/O or child-process calls, and no publisher policy is added. A partially configured account fails packaging. With all four present, the hook runs Java directly with an argument array, suppresses tool output, and stops on a tool failure or an invalid signature. There are no automatic signing retries. Duplicate paths are refused, and the installer cannot be signed until the app and uninstaller have both passed verification in the same process.

## Files and signing count

One x64 NSIS build makes **three CodeSignTool `sign` calls**, each signing and timestamping one file with SHA-256:

1. `win-unpacked/BroCrew.exe`.
2. `BroCrew-Setup-<version>-x64.__uninstaller.exe`, before it is embedded in the installer.
3. `BroCrew-Setup-<version>-x64.exe`, before the blockmap and update metadata.

`signingHashAlgorithms: [sha256]` avoids electron-builder's default of two calls per file. Every other offered path is skipped, including bundled `node.exe`, `codex.exe`, native modules and vendor helpers. The hook checks each signature for Windows `Valid` status, the configured publisher, certificate thumbprint `382E2CDE6834E3400371451FEBD6AB5943C71647`, and a timestamp certificate. Renewing the certificate requires updating this public pin.

Budget three signings per successful release. Setup and signature verification consume none. A rerun can consume three more, and a failed build may have consumed one or more already; confirm SSL.com's actual balance change on the first release rather than assuming its billing unit matches a CLI call. Twenty unused signings allow six complete releases with two left, if each call consumes one signing.

Versioned prereleases (`vX.Y.Z-beta.N`) in `release.yml` also sign and consume three calls, so cut them sparingly. This keeps the beta channel usable for clients that already require signatures. Ordinary `windows-beta-*` and `beta-*` builds remain unsigned.

## Packaging witness without signing

The Windows workflow's manual `signing_witness` input defaults to false. When explicitly enabled, it sets `BROCREW_WINDOWS_SIGNING_RECORD_DIR` for packaging only. This mode rejects eSigner credentials and always returns before any signing or verification subprocess. It records actual callback paths, hashes and file sizes, and preserves the actual transient uninstaller before builder deletes it. It does not claim to exercise native signing.

The following check compares the three selected callbacks with the actual app and installer outputs and the saved uninstaller, verifies their bytes, and checks every other offered file remains unchanged. The `windows-signing-witness-<SHA>` artifact contains `callbacks.jsonl`, `checked.json` and `uninstaller.exe`. Bind the run, artifact and review to the same commit. Missing, duplicate, misclassified or altered outputs fail the check. Ordinary runs and no-secret hooks have no recording I/O.

## Publisher checks and upgrades

Only a build with signing enabled passes `win.signtoolOptions.publisherName` (the publisher name set in `release.yml`). Builder writes this into that app's `app-update.yml`; electron-updater 6.8.10 then requires a valid matching signature on future downloaded installers. Unsigned builds omit `publisherName`, keeping their existing update policy and bytes. App id, package name, NSIS identity and install location are unchanged.

An existing unsigned app can install the first signed update. Afterwards, signed apps require signed updates from the same publisher; do not publish an unsigned replacement release as a rollback. Use a new signed version. The Upgrade path workflow remains unsigned and installs its candidate over the old release directly with NSIS `/S`; it does not use the automatic updater. Its green result does not prove unsigned-to-signed or signed-to-signed automatic updating.

## First signing

The first signed release is the first stable release after this change lands and the account owner has activated eSigner and configured the environment secrets. Existing releases proceed independently. The unsigned candidate first passes CI, Windows and Upgrade path and independent review, including the hosted packaging witness. The release owner then selects the next unused stable `vX.Y.Z` tag. Creating a tag and publishing a release require the release owner's approval; this implementation creates neither.

On that first build, retain the three `Verified … signature` lines and compare the account's signing balance before and after. Confirm `release-check.mjs` passes on the final signed files. On an isolated Windows machine, inspect the installer, installed app and installed uninstaller with `Get-AuthenticodeSignature`; require Valid, the configured publisher, the pinned thumbprint and a timestamp. Also confirm bundled Node and Codex hashes match their unsigned inputs.

Exercise automatic updating from the last unsigned release to the signed release, then from that signed release to the next signed release. These are separate native checks; fixture tests and the manual Upgrade path gate cannot substitute for them. Two successful signed releases cost six signing calls in total. Report the measured allowance change before choosing a subscription. OV signing establishes the publisher but does not promise immediate SmartScreen reputation.

Sources: [SSL.com CodeSignTool](https://www.ssl.com/guide/esigner-codesigntool-command-guide/), [pinned SSL.com action](https://github.com/SSLcom/esigner-codesign/tree/b7f8ff36fc0de8690fbbab8e5b4421d29802f747), [electron-builder signing manager](https://github.com/electron-userland/electron-builder/blob/v26.15.3/packages/app-builder-lib/src/codeSign/windowsSignToolManager.ts), [NSIS build order](https://github.com/electron-userland/electron-builder/blob/v26.15.3/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts), [updater publisher verification](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.10/packages/electron-updater/src/NsisUpdater.ts).
