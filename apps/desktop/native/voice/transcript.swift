import Foundation

/// Everything the person said in one recording. After a pause, macOS can start a new
/// transcription that holds only the words since the pause, and the result that ends the
/// recording can then be empty. So each utterance's words are kept as they are heard.
struct Transcript {
    private var kept = ""
    private var keptStart = 0.0
    private var keptEnd = 0.0
    private var current = ""
    private var currentStart = 0.0
    private var currentEnd = 0.0

    /// One recognition result: its text, the audio seconds its words span (zero when the
    /// recognizer gave no timing), and whether it closes an utterance (a pause, or the end).
    mutating func hear(_ text: String, from start: Double, to end: Double, closesUtterance: Bool) {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !words.isEmpty {
            if repeatsKept(words, from: start, to: end) {
                kept = ""
                keptEnd = 0
            }
            current = words
            currentStart = start
            currentEnd = end
        }
        if closesUtterance, !current.isEmpty {
            if kept.isEmpty { keptStart = currentStart }
            kept = Transcript.join(kept, current)
            keptEnd = currentEnd
            current = ""
        }
    }

    var text: String { Transcript.join(kept, current) }

    /// A recognizer that kept the whole recording repeats the kept words from the same audio.
    /// Without timing that proves it, a result is a new utterance: a doubled word can be
    /// deleted on review, a dropped one is gone.
    private func repeatsKept(_ words: String, from start: Double, to end: Double) -> Bool {
        guard !kept.isEmpty, keptEnd > keptStart, end > start, start < keptEnd,
              abs(start - keptStart) < 0.05,
              let prefix = words.range(of: kept, options: [.anchored, .caseInsensitive])
        else { return false }
        return prefix.upperBound == words.endIndex
            || !(words[prefix.upperBound].isLetter || words[prefix.upperBound].isNumber)
    }

    private static func join(_ first: String, _ second: String) -> String {
        first.isEmpty ? second : second.isEmpty ? first : first + " " + second
    }
}
