import AVFoundation
import Foundation
import Speech

final class LocalVoice {
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let audio = AVAudioEngine()
    private var tapped = false
    private var listening = false
    private var ended = false
    private var silence: DispatchWorkItem?
    private var limit: DispatchWorkItem?
    private var finalLimit: DispatchWorkItem?
    private var transcript = Transcript()

    private func emit(_ object: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              data.count <= 16384 else { exit(1) }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }

    private func stopAudio() {
        audio.stop()
        if tapped { audio.inputNode.removeTap(onBus: 0); tapped = false }
        listening = false
        silence?.cancel()
        limit?.cancel()
    }

    private func finish(error: String? = nil, text: String? = nil) {
        guard !ended else { return }
        ended = true
        stopAudio()
        finalLimit?.cancel()
        task?.cancel()
        if let error { emit(["error": error]) }
        else if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                text.utf8.count <= 8192 { emit(["text": text]) }
        else { emit(["error": "empty"]) }
        exit(0)
    }

    /// Ends with the words heard so far, or with `error` when nothing was heard.
    private func deliver(orElse error: String) {
        let text = transcript.text
        if text.isEmpty { finish(error: error) } else { finish(text: text) }
    }

    func stop() {
        guard !ended, listening else { return }
        stopAudio()
        request?.endAudio()
        emit(["state": "transcribing"])
        let timeout = DispatchWorkItem { self.deliver(orElse: "timeout") }
        finalLimit = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
    }

    func cancel() { finish(error: "cancelled") }

    private func recognize(_ recognition: SFSpeechRecognitionRequest) {
        guard !ended, let recognizer, recognizer.supportsOnDeviceRecognition else {
            finish(error: "local"); return
        }
        recognition.requiresOnDeviceRecognition = true
        recognition.shouldReportPartialResults = true
        recognition.taskHint = .dictation
        task = recognizer.recognitionTask(with: recognition) { result, error in
            DispatchQueue.main.async {
                guard !self.ended else { return }
                if let result {
                    self.transcript.hear(
                        result.bestTranscription.formattedString,
                        closesUtterance: result.isFinal || result.speechRecognitionMetadata != nil)
                }
                if let result, result.isFinal {
                    self.finish(text: self.transcript.text)
                } else if error != nil {
                    self.deliver(orElse: "recognition")
                } else if result != nil && self.listening {
                    self.silence?.cancel()
                    let silence = DispatchWorkItem { self.stop() }
                    self.silence = silence
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: silence)
                }
            }
        }
    }

    private func record() {
        guard !ended else { return }
        guard recognizer?.supportsOnDeviceRecognition == true else { finish(error: "local"); return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        self.request = request
        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { finish(error: "audio"); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapped = true
        do {
            audio.prepare()
            try audio.start()
        } catch { finish(error: "audio"); return }
        listening = true
        emit(["state": "listening"])
        recognize(request)
        let timeout = DispatchWorkItem { self.stop() }
        limit = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 50, execute: timeout)
    }

    private func speechPermission() {
        guard !ended else { return }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: record()
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    guard !self.ended else { return }
                    if status == .authorized { self.record() }
                    else { self.finish(error: "speech") }
                }
            }
        default: finish(error: "speech")
        }
    }

    func start() {
        let args = Array(CommandLine.arguments.dropFirst())
        let fixture = args.count == 2 && args[0] == "--fixture" ? args[1] : nil
        let preflight = args == ["--preflight"]
        guard args.isEmpty || fixture != nil || preflight else { finish(error: "protocol"); return }
        recognizer = SFSpeechRecognizer(locale: fixture != nil || preflight ? Locale(identifier: "en-US") : Locale.current)
        guard recognizer?.supportsOnDeviceRecognition == true else { finish(error: "local"); return }
        if preflight {
            emit(["authorization": SFSpeechRecognizer.authorizationStatus() == .authorized ? "authorized" : "not-authorized"])
            exit(0)
        }
        if let fixture {
            // Fixture checks never request permission or open the microphone.
            guard SFSpeechRecognizer.authorizationStatus() == .authorized else { finish(error: "speech"); return }
            emit(["state": "transcribing"])
            let timeout = DispatchWorkItem { self.deliver(orElse: "timeout") }
            finalLimit = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
            recognize(SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: fixture)))
            return
        }
        emit(["state": "permission"])
        DispatchQueue.global(qos: .utility).async {
            while let line = readLine() {
                DispatchQueue.main.async {
                    if line == "stop" { self.stop() }
                    else { self.cancel() }
                }
            }
            DispatchQueue.main.async { self.cancel() }
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: speechPermission()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    guard !self.ended else { return }
                    if granted { self.speechPermission() }
                    else { self.finish(error: "microphone") }
                }
            }
        default: finish(error: "microphone")
        }
    }
}

let voice = LocalVoice()
DispatchQueue.main.async { voice.start() }
RunLoop.main.run()
