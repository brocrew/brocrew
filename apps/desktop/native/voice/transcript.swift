import Foundation

/// Everything the person said in one recording. After a pause, macOS can start a new
/// transcription that holds only the words since the pause, and the result that ends the
/// recording can then be empty. So each utterance's words are kept as they are heard.
struct Transcript {
    private var kept = ""
    private var current = ""

    /// One recognition result: its text, and whether it closes an utterance (a pause, or the end).
    mutating func hear(_ text: String, closesUtterance: Bool) {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !words.isEmpty {
            // A recognizer that kept the whole recording repeats the kept words.
            if !kept.isEmpty, words.range(of: kept, options: [.anchored, .caseInsensitive]) != nil {
                kept = ""
            }
            current = words
        }
        if closesUtterance {
            kept = Transcript.join(kept, current)
            current = ""
        }
    }

    var text: String { Transcript.join(kept, current) }

    private static func join(_ first: String, _ second: String) -> String {
        first.isEmpty ? second : second.isEmpty ? first : first + " " + second
    }
}
