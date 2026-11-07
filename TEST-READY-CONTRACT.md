## Explicit app compatibility mode

`test_path=app-upgrade-compat` is the separate app-release case approved by W4 via W15. It uses public Chrome0.1.8 and WhatsApp0.1.4, no custom transport. Public0.1.36 failed Chrome baseline, real residual fingerprints, same registered installer/root and exact actual candidate source/version checks remain mandatory. Strict two-plugin modes retain their existing requirements.

Only the single exported Chrome predicate may classify a candidate Chrome failure as KNOWN-ISSUE: exact published0.1.8 digest, unavailable/server-closed, and an actual captured Chrome identity-startup diagnostic plus a matching fresh process/exit pair. Run IDs and directories present before the attempt are excluded; a later exit file cannot make an old run fresh. Every nonblank stderr line must be the identity diagnostic, its generic wrapper or an explicit stack continuation; mixed unrelated diagnostics fail. Generic masked Error alone remains PARTIAL because it does not identify a cause. Chrome is never marked PASS for that case. Missing stderr is PARTIAL (exit2), not green. Different policy/hash/manifest/code/stderr failures FAIL. A successful Chrome operation retains normal Chrome tool/native checks. Wrong-cause controls cover these distinctions.

With KNOWN-ISSUE or PARTIAL, the observer requires WhatsApp init/tools-list and installed live WhatsApp payload/process witnesses; all routes/cards and Chrome failure receipts remain reported. WhatsApp Settings install, public archive/manifest/source pins, unchanged installed supervisor PID/owner epoch through the attempt, service identity, residual/state checks and NORMAL shutdown/cleanup remain mandatory. Any failure there is FAIL, including forced cleanup. Terminal app verdict distinguishes APP-COMPAT-PASS-WITH-KNOWN-CHROME-ISSUE from PARTIAL and strict PASS. This is not Chrome repair acceptance. No pre-warm, seeding or timeout/retry change.

## Unpublished input mode — instrumented transport, not public delivery

Three workflow inputs select the reviewed pre-publication fixture: plugin_run_id, plugin_artifact and plugin_receipt_sha256 (all required together). The artifact contains plugin-inputs.json and exact normal-build archive files. JSON format1 has plugins entries with archiveFilename and catalogueEntry (the normal plugin-list-entry object), plus derived id/version/sourceCommit/archiveBytes/archiveSha256/manifestSha256. Build run and artifact origin come from the outer workflow intake, not rewritten plugin receipt JSON. Chrome must be present; unchanged published WhatsApp may remain on its public pin. The harness verifies JSON hash, tar size/hash, actual plugin.json hash/version/source/platform and normal catalogue entry. No archive is repacked or rewritten.

Only candidate launch is instrumented. Existing main --inspect-brk pauses before packaged entry execution; the exact installed main and installed supervisor receive a debugger-installed exact-URL fetch wrapper for the two real catalogue bodies and pinned archive files. All installed URL, length, SHA256, manifest and lifecycle/Settings consent checks remain active; executable and installed scripts remain unchanged. No shipped flag/setting/fuse, TLS waiver or plugin state is changed. Inspector support, native PID/birth/image binding and the packaged-entry pause must pass or the test fails. The unused-port preflight plus own spawned process is the bounded fresh-fixture ownership assumption; it is not an atomic TCP owner guarantee or a recipe for concurrent user machines. Cold target identity is checked at the exact entry pause after Node preparation and before hook replacement or entry resume; live supervisor identity stays immediate. Partial-attach failure attempts restoration and retains its result with the original failure. Hook receipts must prove main catalogue and supervisor archive fetches; hooks restore before normal candidate shutdown measurement. Both paths use no deliberate PowerShell warm-up. Debugger entry pausing and native identity observations affect startup timing; this pre-publication proof does not establish uninstrumented production cold-start timing. The later public-route proof remains necessary. Beta uses published0.1.8 and is never instrumented.

Every pre-publication result is labelled **instrumented transport, not public delivery**. It cannot qualify public catalogue delivery. After Majid authorizes actual publication, one final public-route invocation is separately required before announcement. Unpublished archive builds and actual early/final installer receipts remain required inputs; no run against unknown bytes.

## Clean-install control variant

Dispatch `test_path=clean-install` to install the exact same supplied candidate installer on the fresh hosted runner without installing or launching beta. Beta input downloads may remain as unused provenance inputs; no beta executable is run. This path records its identity, requires both candidate cards initially uninstalled, then uses the unchanged strict Settings install, published identities, MCP calls, held native witness and normal candidate shutdown checks. It has three required phases. Default `failed-beta-recovery` preserves the five-phase recovery case. Clean success/failure is a separate control, never upgrade proof. No seeding, state deletion, product change, rebuild or automatic retry.

# Windows failed-beta-install to candidate recovery TEST contract

Owner Remy W15.51; independent Teo/Fabijan checks; Sara hosted operator. W4's 20:15 decision supersedes the two-working-beta-plugins starting state: record Soufiane's failed 0.1.36 Chrome install, preserve its leftovers, upgrade, install through candidate Settings. NO synthetic state seeding.

## Exact inputs

- Public 0.1.36 NSIS: 248268080 bytes, SHA256 856b87c2fd1306745a881f7e5e97591888695dbf9a15d784b477a85f8f35578f, asset 710643454.
- Chrome 0.1.8 Windows archive: 3608965 bytes, SHA256 d05363044da6b65cacfccee0149772b97c1a7e5dca83c8262bf91e70de84c8a0, manifest b8432edfc43657715a695dcca57164c7ba0e9229fd98570d4159afeb9be8f7d3.
- WhatsApp 0.1.4 Windows archive: 8228798 bytes, SHA256 49497b4c15adffefdbc63f8490da542ebae78016975a72c6b55e4476aa3dc769, manifest fe6f04050ac0ec9cc0b577de9d57dc249987d7d3a43cc7e16a9350e68ca83c8d.
- SAME early candidate source 3f2683a3b7400dfb4b3e7e92eba8190b0e5682e5/tree7faa8321f2392b202e42af8fea475d40319cab9c, build42407090126, artifact13588460691/brobot2-windows. EXE248123547 bytes SHA256 acc9610f51ce2ce3b4a9e1479d7694b8720f4d9702c856eca294bb61f60956f5. Preserve original filename/receipts; normalize only a verified job-owned copy and rehash. NO rebuild.

## One authorized new invocation

Existing disposable upgrade-path.yml, one windows-2022 job, proof_stage early-recipe. Sara alone runs configured preflights, pushes reviewed non-gate carrier and dispatches ONCE after quick review. No automatic retry/publication/permanent gate.

1. Actual beta install/launch; Settings review and attempt published Chrome install. Require and record the expected failed baseline. Collect available errors/exit receipts without inferring cause from server-closed.
2. Attempt beta normal quit; explicitly record any baseline forced containment and unproved shutdown. Retain all actual half-written state in place. No deletion, seeding or repair.
3. Same-location/registration NSIS upgrade with exact installer bytes. Bind native and running identity. Residual state/package-vault hashes must survive NSIS unchanged before candidate launch; the app may recover/migrate them afterward.
4. Candidate Settings installs BOTH exact published plugins, or retries an exact installed entry left by baseline failure. Require every operation/installed identity and resulting committed activation/archive/manifest. Candidate install/start failure is reported immediately with plain evidence.
5. Installed-service HTTP Chrome list_browser_profiles and WhatsApp tools/list; native host/payload capture while observer held; normal candidate cleanup and matching physical exits.

## Proof limits

All five phases and terminal summary must succeed with only the explicitly expected beta failure. Forced candidate cleanup fails; baseline containment is not normal shutdown. Runs42408293855/42409664795 stay RED. Synthetic observer acceptance proves no UI/account/provider behavior. No real accounts, messages or browser profiles. The previous Darwin probe is call-pattern-only. Early success cannot qualify changed final inputs; SAME-harness exact final installer proof remains required.
