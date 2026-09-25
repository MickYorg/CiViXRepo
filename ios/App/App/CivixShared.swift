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
}
