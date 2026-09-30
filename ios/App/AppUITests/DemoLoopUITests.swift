// The daily demo clip (scripts/demo-loop.sh records the screen while this
// runs): the whole CiViX promise loop, as a person would do it.
//   Safari story -> Share -> CiViX -> Send -> (real background dig) ->
//   "CiViX dug in" push -> tap -> the response on Take Action -> its first
//   move -> the drafted action.
// The push itself is delivered by demo-loop.sh with `xcrun simctl push`
// once the dig is done (the simulator can't receive real FCM pushes).
// Settings come from TEST_RUNNER_* environment variables (xcodebuild strips
// the prefix): DEMO_TOKEN (the demo Send to CiViX address, never a
// citizen's) and DEMO_ARTICLE_URL.
import XCTest

final class DemoLoopUITests: XCTestCase {
    let env = ProcessInfo.processInfo.environment
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")

    override func setUp() { continueAfterFailure = false }

    func testPromiseLoop() throws {
        let token = env["DEMO_TOKEN"] ?? ""
        let article = env["DEMO_ARTICLE_URL"] ?? "https://apnews.com/"
        XCTAssertFalse(token.isEmpty, "DEMO_TOKEN missing")

        // 1. CiViX with the demo manifesto and demo address; allow alerts.
        let app = XCUIApplication()
        app.launchEnvironment["CIVIX_START_URL"] =
            "https://mycivix.com/dev/?demo=medium&token=\(token)&go=../take-action.html"
        app.launch()
        tapIfAppears(springboard.buttons["Allow"], within: 25)
        XCTAssertTrue(app.webViews.staticTexts["Take Action"].waitForExistence(timeout: 40), "Take Action didn't load")
        sleep(2)

        // 2. A real story in Safari, shared to CiViX.
        XCUIDevice.shared.system.open(URL(string: article)!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        for label in ["Continue", "Not Now", "Close"] { tapIfAppears(safari.buttons[label], within: 2) }
        sleep(6) // let the story render
        openShareSheet()
        // The share sheet is a remote view: its elements report positions
        // relative to the sheet, not the screen, so tap them as elements.
        let civixCell = safari.cells["CiViX"]
        if !civixCell.waitForExistence(timeout: 10), let more = spot(label: "More", in: safari) {
            tap(more, in: safari); sleep(2)
        }
        XCTAssertTrue(civixCell.waitForExistence(timeout: 10), "CiViX isn't in the share sheet")
        sheetTap(civixCell)
        sleep(3)
        let send = safari.buttons["Send to CiViX"]
        XCTAssertTrue(send.waitForExistence(timeout: 20), "Send to CiViX button not found")
        sleep(2) // let the viewer see what's being sent
        sheetTap(send)
        tapIfAppears(firstExisting([safari.buttons["Close"], springboard.buttons["Close"]], within: 20), within: 1)

        // 3. Home screen; wait for "CiViX dug in" (demo-loop.sh pushes it
        //    when the real dig finishes), then tap it.
        XCUIDevice.shared.press(.home)
        let banner = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'CiViX dug in'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 300), "no 'CiViX dug in' notification")
        press(banner)

        // 4. The response on Take Action, then its first move.
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        sleep(5)
        if let move = latestFirstMove(token: token) {
            let button = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", move)).firstMatch
            if button.waitForExistence(timeout: 15) {
                sleep(2)
                press(button)
                sleep(10) // the drafted action fills in
                app.swipeUp()
                sleep(3)
            }
        }
    }

    // iOS 26 Safari: the Share action lives in the toolbar's "…" menu.
    // Several elements are labelled "Share" (some hidden), so pick the one
    // actually on screen, lowest down (the open menu).
    func openShareSheet() {
        if let more = firstExisting([safari.buttons["MoreMenuButton"], safari.buttons["MoreButton"], safari.buttons["More"]], within: 8) {
            press(more)
            sleep(2)
        }
        if let share = spot(label: "Share", in: safari) { tap(share, in: safari) }
        sleep(3)
    }

    // Finds an on-screen element by label from one snapshot of the screen
    // (live queries go stale while menus animate); the lowest match wins.
    func spot(label: String, in app: XCUIApplication) -> CGRect? {
        guard let root = try? app.snapshot() else { return nil }
        let screen = root.frame
        var hits: [CGRect] = []
        var all: [String] = []
        func walk(_ n: XCUIElementSnapshot) {
            if !n.label.isEmpty && !n.frame.isEmpty && screen.intersects(n.frame) {
                all.append("\(n.label)[\(n.elementType.rawValue)]@\(Int(n.frame.minX)),\(Int(n.frame.minY)) \(Int(n.frame.width))x\(Int(n.frame.height))")
                if n.label == label { hits.append(n.frame) }
            }
            n.children.forEach(walk)
        }
        walk(root)
        NSLog("DEMO: %@ -> %@ (screen %@)", label, hits.map { NSCoder.string(for: $0) }.joined(separator: ", "), NSCoder.string(for: screen))
        if hits.isEmpty || label == "CiViX" { NSLog("DEMO: visible: %@", all.suffix(60).joined(separator: " | ")) }
        return hits.max(by: { $0.minY < $1.minY })
    }

    // Taps an element inside a remote sheet (share sheet, share extension).
    // A normal tap maps its position correctly when XCUITest allows it;
    // otherwise shift its sheet-relative frame down to where the sheet
    // sits on screen (anchored to the bottom).
    func sheetTap(_ element: XCUIElement) {
        if element.isHittable { element.tap(); return }
        guard let root = try? safari.snapshot() else { return }
        var maxY: CGFloat = 0
        func walk(_ n: XCUIElementSnapshot) {
            if n.frame.height < root.frame.height - 1 { maxY = max(maxY, n.frame.maxY) }
            n.children.forEach(walk)
        }
        walk(root)
        let offset = max(0, root.frame.height - 22 - maxY)
        let f = element.frame
        NSLog("DEMO: sheet tap %@ offset %.0f", NSCoder.string(for: f), offset)
        tap(CGRect(x: f.minX, y: f.minY + offset, width: f.width, height: f.height), in: safari)
    }

    func tap(_ rect: CGRect, in app: XCUIApplication) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: rect.midX, dy: rect.midY)).tap()
    }

    // iOS 26's floating menus and share sheet report some real, visible
    // items as not hittable, so an item that exists counts, and press()
    // taps its position when a normal tap isn't allowed.
    func firstExisting(_ elements: [XCUIElement], within seconds: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(seconds)
        repeat {
            if let hit = elements.first(where: { $0.exists && $0.isHittable }) { return hit }
            if let seen = elements.first(where: { $0.exists && !$0.frame.isEmpty }) { return seen }
            usleep(300_000)
        } while Date() < deadline
        return nil
    }

    func press(_ element: XCUIElement) {
        if element.isHittable { element.tap() }
        else { element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
    }

    func tapIfAppears(_ element: XCUIElement?, within seconds: TimeInterval) {
        guard let element = element else { return }
        if element.waitForExistence(timeout: seconds) && !element.frame.isEmpty { press(element) }
    }

    // The newest capture on the demo address, and its first suggested move.
    func latestFirstMove(token: String) -> String? {
        guard let url = URL(string: "https://civix-capture.mycivix.workers.dev/api/filings?token=\(token)") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("https://mycivix.com", forHTTPHeaderField: "Origin")
        var result: String?
        let done = expectation(description: "filings")
        URLSession.shared.dataTask(with: request) { data, _, _ in
            defer { done.fulfill() }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let items = json["items"] as? [[String: Any]],
                  let dig = items.first?["dig"] as? [String: Any],
                  let moves = dig["moves"] as? [[String: Any]],
                  let title = moves.first?["title"] as? String else { return }
            result = title
        }.resume()
        wait(for: [done], timeout: 20)
        return result
    }
}
