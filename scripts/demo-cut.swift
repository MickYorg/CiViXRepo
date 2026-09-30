// Cuts the raw demo recording to about `target` seconds (used by
// scripts/demo-loop.sh). The real dig wait (waitStart..waitEnd, seconds
// into the recording) is squeezed to under a second; everything else is
// sped up evenly to fit. AVFoundation only, nothing to install.
//   swift scripts/demo-cut.swift raw.mov out.mp4 <waitStart> <waitEnd> <target>
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 6, let waitStart = Double(args[3]), let waitEnd = Double(args[4]), let target = Double(args[5]) else {
    FileHandle.standardError.write("usage: demo-cut.swift raw.mov out.mp4 waitStart waitEnd target\n".data(using: .utf8)!)
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

        let ws = max(0, min(waitStart, total)), we = max(ws, min(waitEnd, total))
        let waitOut = we > ws ? 0.8 : 0
        let rest = ws + (total - we)
        let speed = rest > 0 ? max(1, rest / max(1, target - waitOut)) : 1 // never slow down
        func t(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: 600) }

        // (source start, source end, output length)
        let pieces = [(0.0, ws, ws / speed), (ws, we, waitOut), (we, total, (total - we) / speed)].filter { $0.1 > $0.0 }
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
        print(String(format: "cut %.0fs -> %.1fs (%.1fx, dig wait %.0fs -> %.1fs)", total, cursor.seconds, speed, we - ws, waitOut))
    } catch {
        FileHandle.standardError.write("demo-cut failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
    sema.signal()
}
sema.wait()
