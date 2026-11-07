# Windows failed-beta-install to candidate recovery TEST

Owner Remy W15.51; Teo and Fabijan review; Sara alone pushes/dispatches. W4's 20:15 decision supersedes the earlier beta-installed starting state. Original failed runs remain RED.

Invoke the unchanged six-flag CLI with --execute, --source-root, --candidate-dir, --candidate-sha, --candidate-version 0.2.11, --inputs and --evidence. Without --execute it prints a plan. Node 24+ and the exact candidate checkout's frozen observer dependencies are required. Main and observer files stay together; evidence uses a fresh driver child directory.

The artifact-only workflow verifies the original commit-suffixed installer hash, records its path/size/run/artifact, copies only those job-owned verified bytes to the fixed driver name and checks the copied hash. No rebuild. Inputs remain the actual public 0.1.36 installer/release JSON, published Windows Chrome 0.1.8 and WhatsApp 0.1.4, and Dara's exact candidate.

## Current five-phase journey

1. Verify provenance and prepare only the observer bundle.
2. Install actual public 0.1.36. Bind registry, raw native ProductVersion and installed executable. Accept only expected or exactly expected plus .0; retain raw identity.
3. Launch beta, review and attempt published Chrome installation through Settings. REQUIRE its observed failed baseline and record full reply/host receipts/screenshot. Attempt normal native quit; if it cannot certify shutdown, retain that failure and contain only owned processes. Baseline forced containment is explicitly not normal shutdown proof. Preserve the complete actual root without deletion, seeding, rewriting or repair. Hash only residual state/package-vault files without exporting contents/auth.
4. Upgrade the same registration/location to the exact supplied candidate. Before launch require residual state/package-vault content hashes unchanged by NSIS. Candidate recovery after launch may legitimately change them.
5. Launch candidate and verify version/full source commit/clean stamp. In candidate Settings install both exact published plugins, or retry an exact installed entry left by baseline failure without deleting it. Require EVERY candidate operation and both installed identities. Bind installed service/resources; call Chrome list_browser_profiles and WhatsApp tools/list over plain loopback MCP HTTP. Hold observer routes/person/lease during native FILETIME and deployed-payload witness capture. Release observer, quit candidate and require normal stopped owner, matching new host exit receipts and no tracked native processes. Forced candidate/final cleanup FAILS. Recheck resulting candidate installation identities.

Terminal summary requires all five phases, the explicit expected baseline failure, and no unexpected failure. The changed case is a W4 requirement, not relabeling either earlier failed run. Candidate install/start failure is an immediate reported blocker.

No accounts/messages/providers/real browser profiles. The observer's automatic synthetic person-control acceptance does not prove native approval UI. Native taskkill quit is not UI quit proof. Residual hashes cover state/package-vault only; the complete root remains in place. No auth/capability/launch-config/full data-root upload. No in-app updater, signing, SmartScreen or complete release qualification. Earlier Darwin copied-state work supplies a call pattern only. Early success requires the SAME harness with actual final source/installer for final proof.
