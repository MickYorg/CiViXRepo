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
        let civix = firstExisting([safari.cells["CiViX"], safari.buttons["CiViX"], springboard.cells["CiViX"]], within: 10)
            ?? openMoreAndFindCivix()
        civix.tap()
        let send = firstExisting([safari.buttons["Send to CiViX"], springboard.buttons["Send to CiViX"]], within: 20)
        XCTAssertNotNil(send, "Send to CiViX button not found")
        send!.tap()
        tapIfAppears(firstExisting([safari.buttons["Close"], springboard.buttons["Close"]], within: 20), within: 1)

        // 3. Home screen; wait for "CiViX dug in" (demo-loop.sh pushes it
        //    when the real dig finishes), then tap it.
        XCUIDevice.shared.press(.home)
        let banner = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'CiViX dug in'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 300), "no 'CiViX dug in' notification")
        banner.tap()

        // 4. The response on Take Action, then its first move.
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        sleep(5)
        if let move = latestFirstMove(token: token) {
            let button = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", move)).firstMatch
            if button.waitForExistence(timeout: 15) {
                sleep(2)
                button.tap()
                sleep(10) // the drafted action fills in
                app.swipeUp()
                sleep(3)
            }
        }
    }

    // Safari's share button is in the toolbar, or (newer layouts) under More.
    func openShareSheet() {
        if let share = firstExisting([safari.buttons["ShareButton"], safari.buttons["Share"]], within: 5) {
            share.tap(); return
        }
        if let more = firstExisting([safari.buttons["MoreButton"], safari.buttons["More"]], within: 5) {
            more.tap()
            if let share = firstExisting([safari.buttons["Share"], safari.cells["Share"]], within: 5) { share.tap() }
        }
    }

    func openMoreAndFindCivix() -> XCUIElement {
        if let more = firstExisting([safari.cells["More"], safari.buttons["More"]], within: 5) { more.tap() }
        let row = firstExisting([safari.cells["CiViX"], safari.buttons["CiViX"], safari.staticTexts["CiViX"]], within: 10)
        XCTAssertNotNil(row, "CiViX isn't in the share sheet")
        return row!
    }

    func firstExisting(_ elements: [XCUIElement], within seconds: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(seconds)
        repeat {
            if let hit = elements.first(where: { $0.exists && $0.isHittable }) { return hit }
            usleep(300_000)
        } while Date() < deadline
        return nil
    }

    func tapIfAppears(_ element: XCUIElement?, within seconds: TimeInterval) {
        guard let element = element else { return }
        if element.waitForExistence(timeout: seconds) && element.isHittable { element.tap() }
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
