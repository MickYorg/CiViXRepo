// Cuts a phone screen recording into a short clip from hand-picked pieces,
// each squeezed or kept to a set length (video only; the recording's audio
// is dropped). Used for the social demo clips.
//   swift scripts/clip-cut.swift in.mp4 out.mp4 "18-19.5:1.2,31.5-41:2.5,..."
// Each piece is <from>-<to seconds in the recording>:<seconds in the clip>.
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 4 else {
    FileHandle.standardError.write("usage: clip-cut.swift in.mp4 out.mp4 \"from-to:len,...\"\n".data(using: .utf8)!)
    exit(2)
}
let pieces: [(Double, Double, Double)] = args[3].split(separator: ",").compactMap { p in
    let parts = p.split(separator: ":"); guard parts.count == 2 else { return nil }
    let range = parts[0].split(separator: "-"); guard range.count == 2,
        let a = Double(range[0]), let b = Double(range[1]), let len = Double(parts[1]) else { return nil }
    return (a, b, len)
}
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let output = URL(fileURLWithPath: args[2])
let sema = DispatchSemaphore(value: 0)

Task {
    do {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw NSError(domain: "clip-cut", code: 1) }
        let comp = AVMutableComposition()
        guard let out = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw NSError(domain: "clip-cut", code: 2) }
        out.preferredTransform = try await track.load(.preferredTransform)
        func t(_ x: Double) -> CMTime { CMTime(seconds: x, preferredTimescale: 600) }
        var cursor = CMTime.zero
        for (a, b, len) in pieces {
            let range = CMTimeRange(start: t(a), end: t(b))
            try out.insertTimeRange(range, of: track, at: cursor)
            out.scaleTimeRange(CMTimeRange(start: cursor, duration: range.duration), toDuration: t(len))
            cursor = cursor + t(len)
        }
        try? FileManager.default.removeItem(at: output)
        guard let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else { throw NSError(domain: "clip-cut", code: 3) }
        try await export.export(to: output, as: .mp4)
        print(String(format: "clip: %d pieces, %.1fs", pieces.count, cursor.seconds))
    } catch {
        FileHandle.standardError.write("clip-cut failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
    sema.signal()
}
sema.wait()
