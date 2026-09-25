// "Hey Siri, send to CiViX": capture something heard or thought, hands-free.
// Siri does the listening and transcription; CiViX only receives the text
// the citizen chose to send. Also usable from the Action Button, Back Tap,
// and the Shortcuts app.
import AppIntents

@available(iOS 16.0, *)
struct SendToCivixIntent: AppIntent {
    static var title: LocalizedStringResource = "Send to CiViX"
    static var description = IntentDescription("Send something you heard or saw to CiViX, and CiViX digs into it.")
    static var openAppWhenRun = false

    @Parameter(title: "What should CiViX look into?", requestValueDialog: "What should CiViX look into?")
    var note: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let item = CivixCapture.Item(title: "", text: note, url: "", source: "siri")
        switch await CivixCapture.send(item) {
        case .sent: return .result(dialog: "Sent to CiViX. It\u{2019}s on it.")
        case .queued: return .result(dialog: "Saved. CiViX will send it when you\u{2019}re back online.")
        case .failed(let m): return .result(dialog: "CiViX couldn\u{2019}t take that: \(m)")
        }
    }
}

@available(iOS 16.0, *)
struct CivixShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SendToCivixIntent(),
            phrases: [
                "Send to \(.applicationName)",
                "Tell \(.applicationName)",
                "Add to \(.applicationName)",
                "\(.applicationName) this"
            ],
            shortTitle: "Send to CiViX",
            systemImageName: "tray.and.arrow.down"
        )
    }
}
