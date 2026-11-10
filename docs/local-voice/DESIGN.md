# Local voice input on Mac


## Engine

Use Apple's Speech framework through a small bundled Swift executable owned by BroCrew. It captures the microphone with AVAudioEngine. Require both `supportsOnDeviceRecognition == true` and `requiresOnDeviceRecognition = true` before creating any recognition task. If the current system language has no local recognition, refuse with a short explanation. Never fall back to a server. Use the system locale; language selection and plugin engines come later.

The established Speech API works on older supported Macs and avoids adding model downloads, third-party binaries or large weights. SpeechAnalyzer is a later upgrade once its newer OS floor and asset lifecycle are qualified. A recording lasts until the person stops or cancels it; the app chooses no pause or length at which to stop. After Stop, allow up to 15 seconds for final transcription. The person can dictate again to append another segment after review. One recording across the app at a time. Bound helper output and lifetime, and kill only the child this voice session started if it does not exit.

## Permission and privacy

Only an explicit mic-button press can start the helper or ask for permission. The helper first checks local engine support, then requests microphone and speech authorization in order. macOS displays those prompts; the person answers them. Denial/restriction produces an actionable message naming System Settings → Privacy & Security → Microphone or Speech Recognition. Do not reset permissions, change settings or answer prompts in automation. A canceled permission request may leave an OS prompt until the person dismisses it, but must never start recording afterward.

BroCrew keeps audio in memory in its core-owned helper and requires on-device recognition. BroCrew creates no audio files, initiates no network requests or provider calls, and writes no transcripts to logs or telemetry. The Speech flags constrain recognition audio; universal OS networking, diagnostics and storage behavior are not established by these flags. Only the final text crosses the helper pipe and the trusted main/preload bridge to the initiating composer. The user can send that text to their agent using the existing Send button after reviewing it. No automatic model/asset download. Apple may need separately installed local language support; lack of support fails closed.

## Interaction

Mac only: a mic button next to Send (including Queue/Stop layouts). Hidden on Windows/Linux for now.

- Idle: “Dictate”; hint: “Your voice stays on this Mac. Review the text before sending.”
- Waiting for macOS permission: “Waiting for permission…”; Cancel remains available.
- Listening: clear active indicator, “Stop recording” and Cancel. Capture begins only after permission succeeds.
- Transcribing: “Transcribing…”; Cancel remains available.
- Error: a warning callout inside the composer (warning colour and icon), preserves the draft, allows retry and can be dismissed. A missing Microphone or Speech Recognition permission adds “Open System Settings”, which opens that Privacy & Security pane; the renderer names the pane and main holds the two fixed URLs. The next recording clears it.

Click Stop to finalize, Cancel to discard. The recognizer ending the recording itself also finishes. After a pause macOS can start a new transcription holding only the words since the pause, so the helper keeps each utterance as it is heard and ends with all of them, whichever way the recording stops. A result is treated as repeating the kept words only when its timing shows it covers the same audio and it matches whole words; otherwise it is a new utterance, since a doubled word can be deleted on review and a dropped one cannot. A recognition error or the finalization limit after words were heard also delivers those words. The complete final transcript is appended to the current draft with a separating space/newline as needed. Existing text is preserved; typed edits made while listening are preserved. No partial text enters the draft. Starting dictation invalidates any Send already waiting for an attachment; a fresh Send after review is required even if that attachment finishes later. That fresh press also chooses Queue or Stop and send anew, without inheriting the invalidated gesture’s intent. Send/Queue shortcuts and buttons are held while voice is active; the person must press Send again after review. Navigation/unmount, a change of draft identity, frozen/starting composer, window close, helper failure and app quit cancel the recording. Late results cannot land in another conversation. The renderer owns one request token and main binds it to the initiating webContents; another window cannot stop or consume it.

## Packaging and signing

Compile the helper on macOS during beforePack for the target architecture with the system Swift toolchain; copy it outside asar to `Contents/Helpers/brocrew-voice` with Mac-only `extraFiles`. Source dev uses the same explicitly built helper and reports if it is missing. Never compile at runtime. Add `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` to the app Info.plist and embed the same usage strings plus a stable helper identifier in the helper's `__info_plist` section. Explicitly list the helper as a signing binary so electron-builder signs it with the app's current identity (ad-hoc in beta) and inherited Electron runtime plus audio-input entitlements before sealing the containing app; never sign with `--deep`; preserve Electron's existing JIT entitlements and add `com.apple.security.device.audio-input` to the app/helper entitlements. No sandbox, developer certificate, notarization or updater change is introduced.

Ad-hoc signing does not establish stable TCC consent across rebuilt binaries. Packaged permission attribution, prompt appearance, denial/retry and offline recognition require the app owner's manual check on the actual candidate app. Missing SDK/compiler or local language assets must be reported, not treated as a successful native gate.

## Checks and release hold

Fake-engine tests: exclusive ownership; permission/error/timeout/cancel cleanup; malformed/oversized output; process exit; no cross-window controls. Composer tests: all states, existing edits retained, no auto-send, cancel/navigation discards late text, Windows hidden. Build/compile the real helper without requesting permission. Generate a short fictional WAV using local macOS speech synthesis and provide an opt-in real-engine fixture runner; run recognition only when authorization is already granted, otherwise report the precise skip. Never trigger an unattended speech/mic prompt for a test. No mic capture is automated.

Before shipping, the app owner must try: both permission prompts; allow/deny and System Settings recovery; offline speech in his language; Stop/Cancel, and a long recording with pauses; existing draft edits and explicit Send; conversation/window switching; app restart and rebuilt-app consent. Shipment stays on hold until the app owner has tried the mic.

## Checked sources (1 November 2026)

- [Apple: requiresOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition): local support and request flags must both hold.
- [Apple: supportsOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition).
- [Apple: speech usage string](https://developer.apple.com/documentation/bundleresources/information-property-list/nsspeechrecognitionusagedescription).
- [Apple: audio input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input).


Installed builder check: electron-builder 26.15.3 resolves `mac.binaries` relative to the app bundle; the explicit entry is `Contents/Helpers/brocrew-voice`. Its signing library sorts nested paths before the outer app. `mac.entitlementsInherit` preserves the existing Electron runtime entitlements and adds audio input; no custom signing hook or identity selection is needed.
