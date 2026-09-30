// Bridges Send to CiViX between the web app and the native share sheet/Siri.
// app-shell.js calls syncDocketToken() on every launch: whichever side
// already has the citizen's docket token (their private Send to CiViX
// address) wins, and both end up with the same one.
import Capacitor

@objc(CivixSharedPlugin)
public class CivixSharedPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CivixSharedPlugin"
    public let jsName = "CivixShared"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncDocketToken", returnType: CAPPluginReturnPromise)
    ]

    // Input: { token?: string } (the web app's token, if it has one).
    // Returns { token?: string } — the token both sides should now use.
    @objc func syncDocketToken(_ call: CAPPluginCall) {
        let web = call.getString("token")?.trimmingCharacters(in: .whitespaces) ?? ""
        if !web.isEmpty {
            CivixCapture.token = web
            call.resolve(["token": web])
        } else if let native = CivixCapture.token, !native.isEmpty {
            call.resolve(["token": native])
        } else {
            call.resolve([:])
        }
    }
}

// The storyboard's view controller, so the plugin above gets registered.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CivixSharedPlugin())
    }

    #if DEBUG
    // Daily demo clip (scripts/demo-loop.sh): the UI test launches the app
    // with CIVIX_START_URL pointing at the live site's demo setup page.
    // Debug builds only; release and App Store builds never compile this.
    private var demoStartDone = false
    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !demoStartDone,
              let raw = ProcessInfo.processInfo.environment["CIVIX_START_URL"],
              let url = URL(string: raw), url.host == "mycivix.com" else { return }
        demoStartDone = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.bridge?.webView?.load(URLRequest(url: url))
        }
    }
    #endif
}
