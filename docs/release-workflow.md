# Release BroCrew

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
