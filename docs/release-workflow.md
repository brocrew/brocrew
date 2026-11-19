# Release BroCrew

## RC and signing checks without Windows signing charges

For RC/test builds, the release operator uses `macos.yml` with `signed_release_validation: true` on a reserved `vX.Y.Z-mac-signing-check.N` tag (`N` starts at 1). Set `package_version` to `X.Y.Z`, `accepted_source_sha` to the reviewed full commit SHA at that tag, and leave `guided_update_rehearsal` false. The workflow checks the tag, version and actual checkout before signing.

This route uses the release Mac build flags (`released: '1'`), Developer ID signing and notarization, and keeps the five Mac distribution files in `mac-signing-validation-<run_id>-<run_attempt>`. It has no Windows build or SSL.com signing calls and publishes no release. Reserved tags are excluded from `release.yml`; do not use normal release tags for RC/test runs. Keep existing secrets and environments unchanged.

Majid tests the release once on the RC. That human acceptance carries to the final build only for the exact same commit and release flags; any source change requires a new RC. Run the normal final release workflow once for Windows signing. Its final signed files must still pass the automated upgrade rows on both OSes, signature/notarization checks and file hash checks before publication. Retain the accepted RC commit/flags and final run/artifact IDs and hashes, then publish the existing draft bytes unchanged. No second Majid retest is required for that unchanged source and release configuration; RC acceptance does not replace checks of the newly built final files.

For 0.2.30, existing draft release `450695914` already holds the actual signed RC2 files. Publish those existing bytes only on Majid's YES; do not rebuild them.

## Required full-workspace AWS qualification before every cut

Before creating a version tag, run the full fictional workspace qualification on the exact selected release commit. The checkout must contain that commit, and `AWS_RUN` must name the installed AWS lane wrapper (`aws-run.sh`):

```sh
release_sha="$(git -C "$release_checkout" rev-parse HEAD)"
"$AWS_RUN" "$release_sha" --from "$release_checkout" --host big \
  pnpm exec vitest run --config vitest.gate-only.config.ts \
  --project gate-only-desktop \
  apps/desktop/gate-only/window-workspace-memory.test.ts --maxWorkers=1
```

Retain the full source SHA/tree, command, fixture counts, query timings and terminal output. This qualification uses 1,960 fictional conversations, 115,640 turns and 10,291,960 events, with the production worker limits of 128 MB old generation and 16 MB young generation. Require all 1,960 expected conversation IDs, complete legacy list reads, zero worker OOMs, zero main-thread history reads and the asserted query deadline. A missing receipt, failure or different release source stops the cut; qualify the actual selected source before proceeding.

The compact historical-memory regression is also required in hosted CI, release and upgrade checks. Its receipt does not replace this full AWS qualification, and the full fixture does not run implicitly in ordinary hosted shards.

A release is one run of `.github/workflows/release.yml`, started by a version tag:

1. Push an annotated tag `vX.Y.Z` on `main`. Any other tag stops in the first job.
2. The run builds and signs Windows (`windows-signing` environment) and the Mac (`mac-signing` environment: Developer ID, notarized). Each build runs its packaged, update-file and recovery checks.
3. The upgrade test runs on each OS with this run's own files, starting from the latest published release:
   - the Mac test installs the published version, makes data in three workspaces, takes the guided update to this build, and checks that the data, saved keys, drafts, workspaces and file permissions survive two starts;
   - the Windows test installs the published version, makes data, installs this build over it, and checks the data, the recovery copy and the conversations.

   It does not cover installed plugins or upgrades from older releases.
4. When everything passes, the run makes a draft release with exactly these eight files and the notes from `scripts/beta-release.mjs`:

   | Mac | Windows |
   | --- | --- |
   | `BroCrew-<version>-arm64.dmg` | `BroCrew-Setup-<version>-x64.exe` |
   | `BroCrew-<version>-arm64.dmg.blockmap` | `BroCrew-Setup-<version>-x64.exe.blockmap` |
   | `BroCrew-<version>-arm64-mac.zip` | `latest.yml` |
   | `BroCrew-<version>-arm64-mac.zip.blockmap` | |
   | `latest-mac.yml` | |

5. The release's required reviewer opens the draft, reads its files and notes, and approves the `release` deployment in Actions. The release then becomes public and latest.

If a job fails, nothing is public. Use "Re-run failed jobs" for a flaky step: re-running a build re-runs the upgrade test and the draft after it. A source fix needs a new version tag. Re-running the draft replaces an earlier draft of the same version; a version that is already published is never replaced.

Operate one release at a time: approve only the newest run, so an older run cannot move "latest" backward.

## Settings this relies on

- `windows-signing`: the four eSigner secrets, restricted to `v*` tags.
- `mac-signing`: `MAC_CERT_P12_BASE64`, `MAC_CERT_P12_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, restricted to `v*` tags.
- `release`: one required reviewer, administrator bypass off, restricted to `v*` tags.
- `RELEASE_REPO`, when set, must name this repository.

The signed Mac action maps `MAC_CERT_P12_BASE64` to electron-builder's `CSC_LINK` and `MAC_CERT_P12_PASSWORD` to `CSC_KEY_PASSWORD`. It writes `APPLE_API_KEY_P8` to a temporary `.p8` file named by `APPLE_API_KEY`, with `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` passed unchanged. electron-builder imports the certificate, signs and notarizes the app before making the updater ZIP, signs the DMG, and writes the blockmaps and `latest-mac.yml`. A DMG completion hook submits and staples the disk image and refreshes its blockmap before builder writes the update metadata.

On the first tagged release after changing signing, check that the app and the app extracted from the updater ZIP pass `codesign --verify --deep --strict`, `stapler validate` and Gatekeeper assessment. Check the DMG's signature, staple and Gatekeeper assessment, and that `release-check.mjs` accepts the final files. Download the DMG on a normal Mac and open the installed app; confirm an existing signed installation accepts the update and keeps its data. The draft must retain all eight files above, with `latest-mac.yml` naming the ZIP and DMG at their final sizes and hashes.
