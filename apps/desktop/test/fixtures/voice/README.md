# Fictional voice fixture

`fictional.wav` says “The purple robot counts seven paper stars.” It was synthesized locally on macOS using the installed Samantha voice on 1 November 2026:

```
/usr/bin/say -v Samantha -o fictional.wav --file-format=WAVE --data-format=LEI16@16000 'The purple robot counts seven paper stars.'
```

It contains no recorded person or user data. Use `node scripts/test-voice-fixture.mjs` after building the helper. The runner opens no microphone and requests no permission. Exit 77 means local language support or an existing speech grant was unavailable; this is a skip, not a transcription pass. A standalone helper grant does not qualify the packaged app's permission flow.
