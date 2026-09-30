// Cuts the raw demo recording to about `target` seconds (used by
// scripts/demo-loop.sh). Three parts, paced for a viewer:
//   0 .. sent-6      setup, Safari: sped up to fit
//   sent-6 .. sent   CiViX's share screen and the Send tap: ~1.8s
//   sent .. dug      the real dig wait: squeezed to under a second
//   dug .. end       the push, the response, the action: the payoff, kept
//                    near real speed (at most ~55% of the clip)
// AVFoundation only, nothing to install.
//   swift scripts/demo-cut.swift raw.mov out.mp4 <sent> <dug> <end> <target>
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 7, let sent = Double(args[3]), let dug = Double(args[4]), let endAt = Double(args[5]), let target = Double(args[6]) else {
    FileHandle.standardError.write("usage: demo-cut.swift raw.mov out.mp4 sent dug end target\n".data(using: .utf8)!)
    exit(2)
}
let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2])
let asset = AVURLAsset(url: input)
let sema = DispatchSemaphore(value: 0)

Task {
    do {
        let total = try await asset.load(.duration).seconds
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw NSError(domain: "demo-cut", code: 1) }
        let transform = try await track.load(.preferredTransform)
        let comp = AVMutableComposition()
        guard let out = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw NSError(domain: "demo-cut", code: 2) }
        out.preferredTransform = transform

        let end = max(0, min(endAt, total))
        let s = max(0, min(sent, end)), d = max(s, min(dug, end))
        let waitOut = d > s ? 0.8 : 0
        let payoff = end - d
        let payoffOut = min(payoff / 1.5, target * 0.55)          // ~1.5x, capped
        let shareStart = max(0, s - 6), shareOut = s > shareStart ? 1.8 : 0
        let setupOut = max(1, target - waitOut - payoffOut - shareOut)
        func t(_ x: Double) -> CMTime { CMTime(seconds: x, preferredTimescale: 600) }

        // (source start, source end, output length)
        let pieces = [(0.0, shareStart, min(shareStart, setupOut)), (shareStart, s, shareOut), (s, d, waitOut), (d, end, payoffOut)]
            .filter { $0.1 > $0.0 && $0.2 > 0 }
        var cursor = CMTime.zero
        for (a, b, length) in pieces {
            let range = CMTimeRange(start: t(a), end: t(b))
            try out.insertTimeRange(range, of: track, at: cursor)
            out.scaleTimeRange(CMTimeRange(start: cursor, duration: range.duration), toDuration: t(length))
            cursor = cursor + t(length)
        }

        try? FileManager.default.removeItem(at: output)
        guard let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else { throw NSError(domain: "demo-cut", code: 3) }
        try await export.export(to: output, as: .mp4)
        print(String(format: "cut %.0fs -> %.1fs (setup %.0fs -> %.1fs, dig %.0fs -> %.1fs, payoff %.0fs -> %.1fs)",
                     total, cursor.seconds, shareStart, min(shareStart, setupOut), d - s, waitOut, payoff, payoffOut))
    } catch {
        FileHandle.standardError.write("demo-cut failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
    sema.signal()
}
sema.wait()
