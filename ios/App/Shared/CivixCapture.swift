// CivixCapture — the native half of Send to CiViX, compiled into both the
// app and the share extension (and used by the Siri shortcut).
//
// The citizen's docket token (their private Send to CiViX address) lives in
// the App Group's shared UserDefaults, so the share sheet and Siri can file
// things without opening the app. The web app keeps its own copy in
// localStorage; app-shell.js syncs the two on every launch (CivixSharedPlugin).
//
// Captures go straight to the civix-capture Worker. With no signal (the boat)
// they wait in a small queue and are sent the next time the app, the share
// sheet or Siri runs with a connection.
import Foundation

enum CivixCapture {
    static let appGroup = "group.com.mycivix.ios"
    static let api = URL(string: "https://civix-capture.mycivix.workers.dev")!
    private static let tokenKey = "docketToken"
    private static let queueKey = "pendingCaptures"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static var token: String? {
        get { defaults?.string(forKey: tokenKey) }
        set { defaults?.set(newValue, forKey: tokenKey) }
    }

    struct Item: Codable {
        var title: String
        var text: String
        var url: String
        var source: String   // "ios-share" | "siri"
    }

    enum Outcome {
        case sent        // filed (or merged with something already sent)
        case queued      // no connection; will retry
        case failed(String)
    }

    /// Sends one capture, first making sure a docket exists and flushing
    /// anything queued earlier.
    static func send(_ item: Item) async -> Outcome {
        guard !(item.title + item.text + item.url).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .failed("Nothing to send.")
        }
        do {
            let token = try await ensureToken()
            await flushQueue(token: token)
            try await post(item, token: token)
            return .sent
        } catch let e as URLError {
            enqueue(item)
            _ = e
            return .queued
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    /// Called when the app comes to the foreground.
    static func flushQueue() async {
        guard let token = token else { return }
        await flushQueue(token: token)
    }

    // MARK: - internals

    private static func ensureToken() async throws -> String {
        if let t = token, !t.isEmpty { return t }
        // No address yet (never opened the builder): create one, exactly as
        // the web app's ensureDrop() does. app-shell.js adopts it on launch.
        var req = URLRequest(url: api.appendingPathComponent("api/docket"))
        req.httpMethod = "POST"
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let t = obj["token"] as? String else {
            throw CaptureError.server("Couldn\u{2019}t set up your CiViX address.")
        }
        token = t
        return t
    }

    private static func post(_ item: Item, token: String) async throws {
        var comps = URLComponents(url: api.appendingPathComponent("api/filings"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(item)
        req.timeoutInterval = 20
        let (_, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else { throw CaptureError.server("CiViX couldn\u{2019}t file that (\(code)).") }
    }

    private static func enqueue(_ item: Item) {
        var q = queue()
        q.append(item)
        if let data = try? JSONEncoder().encode(Array(q.suffix(50))) { defaults?.set(data, forKey: queueKey) }
    }

    private static func queue() -> [Item] {
        guard let data = defaults?.data(forKey: queueKey) else { return [] }
        return (try? JSONDecoder().decode([Item].self, from: data)) ?? []
    }

    private static func flushQueue(token: String) async {
        var remaining: [Item] = []
        for item in queue() {
            do { try await post(item, token: token) } catch { remaining.append(item) }
        }
        let data = try? JSONEncoder().encode(remaining)
        defaults?.set(data, forKey: queueKey)
    }

    enum CaptureError: LocalizedError {
        case server(String)
        var errorDescription: String? { if case .server(let m) = self { return m }; return nil }
    }
}
