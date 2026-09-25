// The CiViX share sheet: tap Share in any app, tap CiViX, (optionally) say
// why it matters, Send. Never leaves the app the citizen was in.
//
// Screenshots/photos: the text in the image is read on the phone (Vision);
// only that text is sent, never the image. Links from Podcasts keep their
// timestamp because the shared URL carries it.
import UIKit
import SwiftUI
import UniformTypeIdentifiers
import Vision

final class ShareViewController: UIViewController {
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        model.close = { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
        let host = UIHostingController(rootView: ShareView(model: model))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.load(from: extensionContext?.inputItems as? [NSExtensionItem] ?? []) }
    }
}

@MainActor
final class ShareModel: ObservableObject {
    enum Phase: Equatable { case loading, ready, sending, done(String), error(String) }

    @Published var phase: Phase = .loading
    @Published var title = ""
    @Published var text = ""
    @Published var url = ""
    @Published var why = ""
    @Published var fromImage = false
    var close: () -> Void = {}

    var preview: String {
        if !title.isEmpty { return title }
        if !text.isEmpty { return String(text.prefix(280)) }
        return url
    }
    var host: String { URL(string: url)?.host?.replacingOccurrences(of: "www.", with: "") ?? "" }

    func load(from items: [NSExtensionItem]) async {
        for item in items {
            if title.isEmpty, let t = item.attributedContentText?.string, !t.isEmpty { text = t }
            for provider in item.attachments ?? [] {
                if url.isEmpty, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let u = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    if u.isFileURL, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                        // a file URL to an image: handled below
                    } else { url = u.absoluteString; continue }
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let s = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    if text.isEmpty { text = s } else if !text.contains(s) { text += "\n" + s }
                    continue
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                   let image = await loadImage(provider) {
                    let read = await Self.recognizeText(in: image)
                    if !read.isEmpty { fromImage = true; text = text.isEmpty ? read : text + "\n" + read }
                }
            }
        }
        // A shared page often arrives as "Title\nhttps://…": split it.
        if url.isEmpty, let found = text.firstURL { url = found; text = text.replacingOccurrences(of: found, with: "").trimmingCharacters(in: .whitespacesAndNewlines) }
        if title.isEmpty, !text.isEmpty, !fromImage, text.count <= 140, !text.contains("\n") { title = text; text = "" }
        phase = (preview.isEmpty && url.isEmpty) ? .error("There\u{2019}s nothing here CiViX can read.") : .ready
    }

    func send() async {
        phase = .sending
        var body = text
        let note = why.trimmingCharacters(in: .whitespacesAndNewlines)
        if !note.isEmpty { body = "Why it matters to me: " + note + (body.isEmpty ? "" : "\n\n" + body) }
        let item = CivixCapture.Item(title: title, text: body, url: url, source: "ios-share")
        switch await CivixCapture.send(item) {
        case .sent: phase = .done("Got it. CiViX is on it.")
        case .queued: phase = .done("Saved. It\u{2019}ll send when you\u{2019}re back online.")
        case .failed(let m): phase = .error(m); return
        }
        try? await Task.sleep(nanoseconds: 1_300_000_000)
        close()
    }

    private func loadImage(_ provider: NSItemProvider) async -> UIImage? {
        guard let obj = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) else { return nil }
        if let img = obj as? UIImage { return img }
        if let u = obj as? URL, let d = try? Data(contentsOf: u) { return UIImage(data: d) }
        if let d = obj as? Data { return UIImage(data: d) }
        return nil
    }

    // On-device text recognition — the image itself never leaves the phone.
    static func recognizeText(in image: UIImage) async -> String {
        guard let cg = image.cgImage else { return "" }
        return await withCheckedContinuation { cont in
            let req = VNRecognizeTextRequest { req, _ in
                let lines = (req.results as? [VNRecognizedTextObservation] ?? []).compactMap { $0.topCandidates(1).first?.string }
                cont.resume(returning: lines.joined(separator: "\n"))
            }
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = true
            DispatchQueue.global(qos: .userInitiated).async {
                do { try VNImageRequestHandler(cgImage: cg).perform([req]) } catch { cont.resume(returning: "") }
            }
        }
    }
}

private extension String {
    var firstURL: String? {
        guard let d = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue),
              let m = d.firstMatch(in: self, range: NSRange(startIndex..., in: self)),
              let r = Range(m.range, in: self) else { return nil }
        return String(self[r])
    }
}

// CiViX's palette: navy ink, cream paper, amber accent.
private let ink = Color(red: 10/255, green: 15/255, blue: 28/255)
private let raised = Color(red: 18/255, green: 26/255, blue: 44/255)
private let paper = Color(red: 236/255, green: 234/255, blue: 226/255)
private let dim = Color(red: 135/255, green: 146/255, blue: 168/255)
private let amber = Color(red: 224/255, green: 169/255, blue: 63/255)

struct ShareView: View {
    @ObservedObject var model: ShareModel
    @FocusState private var whyFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Wordmark()
                    Spacer()
                    if case .done = model.phase {} else {
                        Button("Cancel") { model.close() }.foregroundColor(dim)
                    }
                }
                content
            }
            .padding(20)
            .background(ink)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView().tint(amber).frame(maxWidth: .infinity, minHeight: 80)
        case .ready, .sending:
            VStack(alignment: .leading, spacing: 6) {
                if !model.host.isEmpty {
                    Text(model.host.uppercased()).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundColor(amber)
                }
                if model.fromImage {
                    Text("TEXT READ FROM YOUR IMAGE, ON THIS PHONE").font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundColor(amber)
                }
                Text(model.preview).font(.system(size: 17, weight: .semibold, design: .serif)).foregroundColor(paper).lineLimit(5)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(raised)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            TextField("Why does this matter to you? (optional)", text: $model.why, axis: .vertical)
                .lineLimit(1...4)
                .focused($whyFocused)
                .padding(12)
                .background(raised)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .foregroundColor(paper)

            Button {
                whyFocused = false
                Task { await model.send() }
            } label: {
                HStack {
                    Spacer()
                    if model.phase == .sending { ProgressView().tint(ink) } else { Text("Send to CiViX").font(.system(size: 17, weight: .bold)) }
                    Spacer()
                }
                .padding(.vertical, 14)
                .background(amber)
                .foregroundColor(ink)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .disabled(model.phase == .sending)

            Text("Goes to your private CiViX docket. Never shared, never sold. Delete it anytime.")
                .font(.system(size: 12)).foregroundColor(dim)
        case .done(let msg):
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 26)).foregroundColor(amber)
                Text(msg).font(.system(size: 18, weight: .semibold, design: .serif)).foregroundColor(paper)
            }
            .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        case .error(let msg):
            Text(msg).foregroundColor(paper)
            Button("Close") { model.close() }.foregroundColor(amber)
        }
    }
}

private struct Wordmark: View {
    var body: some View {
        (Text("C").foregroundColor(paper) + Text("i").foregroundColor(amber) + Text("V").foregroundColor(paper) +
         Text("i").foregroundColor(amber) + Text("X").foregroundColor(paper))
            .font(.system(size: 22, weight: .bold, design: .serif))
    }
}
