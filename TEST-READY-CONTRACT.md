# Windows installed-plugin upgrade TEST contract

Owner: Remy, W15.51. Driver: Arjun, W15.51.1. Independent checks: Teo W15.51.2 and Fabijan W15.51.3. Hosted operator: Sara W4.1509.

Status: Contract SOURCE AGREE by Teo at 19:38 UTC. Carrier immutable commit/final integrated review and actual installer receipt are pending. Windows execution is UNRUN. This document is not dispatch clearance.

## Inputs

- Actual public `BroCrew-Setup-0.1.36-x64.exe`: SHA256 `856b87c2fd1306745a881f7e5e97591888695dbf9a15d784b477a85f8f35578f`, 248268080 bytes, asset 710643454.
- Published Chrome 0.1.8 `chrome-win32-x64.tar.gz`: SHA256 `d05363044da6b65cacfccee0149772b97c1a7e5dca83c8262bf91e70de84c8a0`, 3608965 bytes, asset 709910700. Manifest SHA256 `b8432edfc43657715a695dcca57164c7ba0e9229fd98570d4159afeb9be8f7d3`.
- Published WhatsApp 0.1.4 `whatsapp-win32-x64.tar.gz`: SHA256 `49497b4c15adffefdbc63f8490da542ebae78016975a72c6b55e4476aa3dc769`, 8228798 bytes, asset 667716216. Manifest SHA256 `fe6f04050ac0ec9cc0b577de9d57dc249987d7d3a43cc7e16a9350e68ca83c8d`.
- Dara's actual Windows 0.2.11 installer: required exact source SHA, hosted artifact run ID/name, installer SHA256 and size/build-origin receipt. The test does not build another installer. Artifact intake must contain exactly one Setup EXE. Preserve its original path, size and hash, then copy those verified bytes to the job-owned `candidate-normalized/BroCrew-Setup-0.2.11-x64.exe` expected by the driver. Verify the copied hash again; this accepts the builder's commit-suffixed original name without changing installer bytes.
- Stage: `early-recipe` or `final-candidate`. Early recipe target confirmed by Dara is source `3f2683a3b7400dfb4b3e7e92eba8190b0e5682e5`, tree `7faa8321f2392b202e42af8fea475d40319cab9c`, version 0.2.11. Its installer receipt is pending. The final candidate is not frozen; final proof requires the actual final source and installer receipt.

## One harness, one hosted job per invocation

Sara pushes the reviewed disposable carrier, never merges it, and dispatches the existing `upgrade-path.yml` entry point on that scratch ref. It contains one `windows-2022` job. The same carrier takes different installer inputs for early recipe and final proof; early success cannot qualify changed final inputs.

1. Download actual public inputs and retain release metadata. Verify their hashes before installation. Check out the exact candidate source separately for observer/control-client instrumentation; retain HEAD/tree and clean-state receipts.
2. Install and start actual 0.1.36 via NSIS. Bind Windows app registration, executable version and CDP process identity.
3. Use that installed beta's Settings API to install both published plugins. Retain their selected committed activation and vault archive/manifest identities before upgrade.
4. Quit beta with native process-exit evidence. Install the supplied 0.2.11 NSIS over the same Windows registration and installation location, preserving the same data root.
5. Start the installed candidate and verify version, exact source commit and clean build stamp. Verify retained plugin identities and bind its live service to installed resources.
6. Attach a separate synthetic observer workspace to that existing service. Obtain routes through its actual control protocol and call plain loopback MCP HTTP: Chrome `list_browser_profiles`; WhatsApp `tools/list`. Hold observer routes, person control and lease while the parent captures the native host/process birth and deployed published-payload witnesses; acknowledge that capture before observer detach.
7. Release observer resources, quit the app and retain service/host exit and process-cleanup evidence. Failures remain failures even if forced containment succeeds.

## Expected outputs

`windows-installed-plugin-upgrade-evidence` contains public release/hash witnesses, carrier SHA, candidate installer artifact/hash receipt, observer source SHA/tree, stage, and driver evidence. The driver must finish every required phase with no failures, produce a terminal `summary.json` with `finished` and `passed:true`, and provide successful requested tool responses plus installed-state/service/root/cleanup witnesses. An exit-zero plan printout cannot satisfy the invocation; workflow uses `--execute`.

No real accounts, WhatsApp messages or real Chrome profiles are used. The synthetic observer accepts its existing person-control requests; this does not establish a native approval UI flow, provider behavior or account behavior. The check does not qualify the in-app updater, SmartScreen, signing, the full application, or a final installer different from the one supplied.

## Current files

All carrier paths below are relative to the TEST checkout root.

- `windows-upgrade-test.yml` is copied to `carrier-source/.github/workflows/upgrade-path.yml`.
- `windows-plugin-upgrade.mjs` orchestrates installation, upgrade and evidence.
- `windows-plugin-upgrade-driver.ts` observes the installed candidate's service and sends MCP HTTP calls.
- `windows-plugin-upgrade-README.md` describes invocation and evidence.

The prior Darwin copied-state call reference supplied the MCP call pattern only. This harness must establish the Windows installation and upgrade sequence independently.
