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
