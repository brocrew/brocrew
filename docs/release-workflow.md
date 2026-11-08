# Publish the tested Mac and Windows release

The release operator builds one candidate, qualifies those exact bytes, then publishes them from an annotated stable tag at the **same source commit**. A stable-tag push builds nothing and publishes nothing. Publication never rebuilds, regenerates update metadata, or overwrites an existing asset.

The Mac update remains guided: quit every workspace using the installed app, replace the app once, then reopen each workspace. Signing does not enable automatic Mac installation.

## Signing and packaging

The candidate build must pass Developer ID signing and notarization before publication. The `mac-signing` environment supplies `MAC_CERT_P12_BASE64`, `MAC_CERT_P12_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` only to the signing job. Its deployment restriction remains **tags matching `v*`**. The existing Windows signing environment is separate.

Two metadata-only environment variables supply the independent expected identity: `MAC_EXPECTED_TEAM_ID` (the certificate's team identifier) and `MAC_EXPECTED_SIGNING_AUTHORITY` (the exact full Developer ID Application authority). The operator configures them privately in existing `mac-signing` for signing, proof and qualification, and mirrors them in existing `release` for publication. Missing configuration, a team/authority mismatch or a different actual signature refuses; no committed identity or artifact-derived fallback exists. No value is committed or printed as ordinary output. Runtime steps register log masks before use. Proof/qualification receive only this metadata and their read-scoped token, never the five signing secrets; the app launch strips signing metadata and credentials. Publication retains the existing release approval. No job, environment or reviewer gate is added for metadata transfer.

The build imports the certificate into a temporary keychain, uses Developer ID Application with hardened runtime and a secure timestamp, preserves the pinned plugin Node bytes, and checks every nested Mach-O signature. Codex is signed with the app; plugin Node retains its vendor signature and exact pinned digest. The build retains nested signature descriptions and both Apple submission IDs/logs, including failed submissions.

The `afterSign` hook submits a temporary ZIP, retrieves the notary log, and staples/validates the **app** before electron-builder creates the shipped ZIP and DMG. The finalizer signs/notarizes/staples the **DMG**, then regenerates the final blockmaps and `latest-mac.yml`. Apple cannot staple a ZIP directly; it must contain the already stapled app. See [Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) and [notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

The packaged check validates Developer ID/team/timestamp/hardened code, the app staple, the DMG staple, the app extracted from the updater ZIP, and Gatekeeper assessment. It also retains the existing provider, database, plugin service, recovery and update-file checks. A normal downloaded-app confirmation may still appear. A successful hosted check does not substitute for the separately required real guided upgrade proof.

## Candidate route

### Land workflow registration before public release copy

The source handoff has two ordered commits. The **precursor** contains the operational workflows, signing, publisher, proof harness and this operator guide. Its README, Mac/Windows installation guides and release-note generator retain the existing release's copy. Admit only this precursor to the default branch initially, so both manual workflows exist there without claiming the current Mac download is notarized.

The **candidate/final copy** child changes only `README.md`, `docs/install-macos.md`, `docs/install-windows.md`, `scripts/beta-release.mjs` and its existing test. It adds the signed installation and release-note wording, including “Mac releases are signed and notarized”, while preserving the Windows warning. Keep that child off the default branch until the actual signing/notarization and native upgrade proofs pass. Create the candidate tag on this final child and run all builds, proofs, qualification and stable publication from that exact source. Candidate and stable tags must have the same commit; do not cherry-pick, merge or rebuild a different final commit after testing.

After the signed release is public and all eight files read back correctly, fast-forward the default branch to the tested final child and publish the separately held website wording. Until then the default README and install guides remain accurate for the existing unsigned Mac release. These are operator-controlled held landings, not automatic workflow steps. If integration needs another base, settle both commits and freeze the new final source **before** the candidate build; discard any earlier selection and repeat the required candidate proofs.

### Build the immutable candidate

1. Admit the exact source and tree through the ordinary source process. The new workflow must be present on the default branch before its manual dispatch routes can be used. This requirement comes from [GitHub's dispatch semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).
2. The operator creates an annotated canonical release tag such as `v0.2.12-candidate.1` at that source. Its push builds package version `0.2.12` on both platforms. Candidate tags match the existing `v*` signing-environment restrictions. Running a workflow from `main` and merely checking out a tag does not change its deployment ref; [environment restrictions match the run's ref](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
3. Retain the exact successful build run/attempt and immutable artifact IDs/digests. `release-windows` contains three update files. `release-macos` contains five update files plus `mac-signed-candidate.json`, which is proof metadata, never a public release asset. The separate `candidate-release-<attempt>` bundle contains only `build-manifest.json` and `assets/` with the eight public files.
4. The inner Mac receipt has `format: "brocrew-mac-signed-candidate-v1"`, source, tree, version, team ID and `files` rows containing name, size, SHA256 and SHA512. Its own artifact ID/digest belong in an outer acquisition reference; embedding its own transport digest would be circular.

The eight stable assets are:

| Mac | Windows |
| --- | --- |
| `BroCrew-<version>-arm64.dmg` | `BroCrew-Setup-<version>-x64.exe` |
| `BroCrew-<version>-arm64.dmg.blockmap` | `BroCrew-Setup-<version>-x64.exe.blockmap` |
| `BroCrew-<version>-arm64-mac.zip` | `latest.yml` |
| `BroCrew-<version>-arm64-mac.zip.blockmap` | |
| `latest-mac.yml` | |

The candidate job attests every final file and its manifest. Verification pins repository, workflow path, source digest, candidate ref and workflow invocation/attempt; repository-only verification is insufficient. See the [GitHub attestation verifier](https://cli.github.com/manual/gh_attestation_verify). Artifact archive digests and individual file hashes are checked separately.

## Native proof and tested selection

Do not use old-version or rebuilt installer proof. The retained tested selection binds:

- Repository, stable version, full source and tree.
- Candidate bundle artifact ID, transport digest, successful build run/attempt and manifest SHA256.
- Each required native proof's run/attempt, artifact ID/digest, receipt filename/SHA256 and its approved driver/carrier identity.
- The exact release-note text and its SHA256. Generate signed Mac installation text with `BROCREW_MAC_SIGNED=true`; the selected notes must say “Mac releases are signed and notarized”.

Windows proof uses the separately reviewed disposable installed-plugin carrier, not the product checkout's ordinary upgrade workflow. The pinned carrier source is `23630fa39854dc068fde16557b5976b8cf10fd2f`, workflow `.github/workflows/upgrade-path.yml`, numeric workflow ID `387765924`. That TEST carrier is never merged into the app source. Its driver digest is recorded in the publisher validator. Run `public-019-clean`, `final-candidate`, with every custom-plugin input empty; only after it passes run `public-019-upgrade` with the same candidate source/tree/version/build artifact/EXE hash and size.

The publisher reads `native-receipt.json` and the original summary, observer, installed-process/service, cleanup and host start/stop receipts. It checks actual child exit, owner epoch, normal cleanup, public plugin pins, paired process birth identities and retained beta-state equality. A summary's `passed` boolean alone cannot qualify a release.

The Mac proof must exercise the actual public ad hoc predecessor to the signed candidate through the guided route, including three disposable workspaces closed before the single replacement and reopened with state intact. Controlled metadata/draft-asset transport proves the real binary path without claiming public feed availability. No automatic-install proof or second test build is part of this release route.

For that proof, the operator stages the four sealed Mac binary/blockmap assets in an authenticated draft on the **candidate tag**, retaining its release ID. Keep this separate from the eventual stable-tag release; no public prerelease is needed. Dispatch `mac-signed-upgrade.yml` at the candidate source with a request containing `mode: "guided"` and `to: {runId, artifactId, artifactSha256, source, tree, version, releaseId}`. The artifact is the original `release-macos`; `artifactSha256` is its archive digest without the `sha256:` prefix. The harness acquires the pinned public `0.2.11` predecessor itself. Its `actual-signed-mac-upgrade-evidence` artifact retains `signed-upgrade-evidence/summary.json`; pin that relative receipt path and its SHA256 in the tested selection. The publisher compares the original build references and all five Mac file seals and reads the three actual workspace shutdown logs and before/after data/credential receipts.

Once the proofs exist, dispatch `release.yml` on the **candidate tag**, `mode=qualify`, supplying the complete tested-selection JSON. This is a mechanical verification and immutable artifact upload, with no new reviewer gate. Retain the resulting `tested-selection-<attempt>` artifact ID and the SHA256 printed for `tested-selection.json`. Missing, expired, altered or mismatched inputs stop qualification; the workflow never chooses the latest artifact or rebuilds a missing one.

The selection uses `format: 1`, `repository`, `version`, `source`, `tree`, `notes`, `notesSha256`, `candidate`, and `proofs`. `candidate` contains numeric `runId`, `runAttempt`, `artifactId`, plus `digest: "sha256:<archive hash>"` and `manifestSha256`. Each proof contains `kind`, numeric `runId`, `runAttempt`, `artifactId`, `digest`, `receiptFile`, and `receiptSha256`. The three kinds are exactly `mac-guided-upgrade`, `windows-clean`, and `windows-upgrade`. Both Windows entries additionally carry the pinned `carrierSha` and `driverSha`; their receipt path is `native-receipt.json`. Use actual API origins and downloaded receipt bytes to fill these fields. This document supplies no runtime proof IDs or results.

## Stable publication

1. Create the annotated stable tag `v<version>` at exactly the tested source commit. Both its canonical tagger and its peeled commit are verified. A version bump, merge, re-sign, re-staple or rebuild after qualification requires a new candidate and proof.
2. Dispatch `release.yml` on that **stable tag**, `mode=publish`, with `selection_artifact_id` and `selection_sha256`. These identify an immutable successful qualification artifact, not a moving name.
3. The job remains in the existing **`release` environment**, with its required reviewer and administrator bypass disabled. Keep those repository settings intact. The operator obtains the existing approval; this source change adds no reviewer chain.
4. The publisher revalidates selection, source/tag, build/proof origins, archive/file hashes, both update manifests and candidate attestations. It creates a draft, uploads only missing files without clobbering, downloads all eight draft assets and verifies them, then publishes. It downloads and verifies all eight public assets and attestations again and retains `publication-readback.json`.

A rerun can continue a matching partial draft only when every existing file already matches the tested inventory and the notes bind the same selection. A published matching release is verified without replacing files. Extra, changed or mismatched existing assets stop the job. A post-publication readback failure is reported as failure; it does not silently delete or rewrite the release.

This workflow currently handles stable candidates/releases. Unsupported tag shapes fail without publishing. Private beta handout workflows retain their existing behavior and do not gain access to the Mac signing environment.
