// Turns a phone screen recording into a social demo clip: hand-picked,
// re-timed pieces, a pulsing marker wherever a finger tapped (iOS screen
// recordings don't show touches), and plain blocks over anything private
// (a contacts row, notifications). Video only; the recording's audio is
// dropped. H.264, optionally scaled down to stay under upload limits.
//   swift scripts/demo-edit.swift in.mp4 out.mp4 spec.json
// spec.json (times are seconds in the RECORDING; x/y/w/h are fractions of
// the screen, from the top-left):
//   { "scale": 0.75,
//     "pieces": [[from, to, secondsInClip], ...],
//     "taps":   [[time, x, y], ...],
//     "hide":   [[from, to, x, y, w, h], ...] }
import AVFoundation
import AppKit
import Foundation

struct Spec: Decodable { let scale: Double?; let pieces: [[Double]]; let taps: [[Double]]?; let hide: [[Double]]? }

let args = CommandLine.arguments
guard args.count == 4, let data = FileManager.default.contents(atPath: args[3]),
      let spec = try? JSONDecoder().decode(Spec.self, from: data) else {
    FileHandle.standardError.write("usage: demo-edit.swift in.mp4 out.mp4 spec.json\n".data(using: .utf8)!)
    exit(2)
}
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let output = URL(fileURLWithPath: args[2])
let sema = DispatchSemaphore(value: 0)

// Where a moment in the recording lands in the clip (nil if it was cut).
func clipTime(_ src: Double) -> Double? {
    var out = 0.0
    for p in spec.pieces {
        let (a, b, len) = (p[0], p[1], p[2])
        if src >= a && src <= b { return out + (src - a) * len / (b - a) }
        out += len
    }
    return nil
}

Task {
    do {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw NSError(domain: "demo-edit", code: 1) }
        let comp = AVMutableComposition()
        guard let out = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw NSError(domain: "demo-edit", code: 2) }
        func t(_ x: Double) -> CMTime { CMTime(seconds: x, preferredTimescale: 600) }
        var cursor = CMTime.zero
        for p in spec.pieces {
            let range = CMTimeRange(start: t(p[0]), end: t(p[1]))
            try out.insertTimeRange(range, of: track, at: cursor)
            out.scaleTimeRange(CMTimeRange(start: cursor, duration: range.duration), toDuration: t(p[2]))
            cursor = cursor + t(p[2])
        }

        let natural = try await track.load(.naturalSize)
        let scale = spec.scale ?? 1
        let size = CGSize(width: (natural.width * scale).rounded(), height: (natural.height * scale).rounded())
        let (W, H) = (size.width, size.height)

        let video = AVMutableVideoComposition()
        video.renderSize = size
        video.frameDuration = CMTime(value: 1, timescale: 30)
        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: out)
        layerInstruction.setTransform(CGAffineTransform(scaleX: scale, y: scale), at: .zero)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: cursor)
        instruction.layerInstructions = [layerInstruction]
        video.instructions = [instruction]

        // Overlays (Core Animation's y axis runs bottom-up).
        let parent = CALayer(); parent.frame = CGRect(origin: .zero, size: size)
        let videoLayer = CALayer(); videoLayer.frame = parent.frame
        parent.addSublayer(videoLayer)

        for h in spec.hide ?? [] {
            guard let a = clipTime(h[0]), let b = clipTime(h[1]), b > a else { continue }
            let block = CALayer()
            block.frame = CGRect(x: W * h[2], y: H * (1 - h[3] - h[5]), width: W * h[4], height: H * h[5])
            block.backgroundColor = CGColor(red: 0.16, green: 0.16, blue: 0.17, alpha: 1)
            block.cornerRadius = 18
            block.opacity = 0
            let show = CABasicAnimation(keyPath: "opacity")
            show.fromValue = 1; show.toValue = 1
            show.beginTime = AVCoreAnimationBeginTimeAtZero + a
            show.duration = b - a
            show.isRemovedOnCompletion = false
            block.add(show, forKey: "show")
            parent.addSublayer(block)
        }

        // Tap marker: a solid CiViX-amber dot with a white ring and a dark
        // edge (readable on light and dark screens), plus a ripple that
        // expands and fades, so each touch is unmistakable at phone size.
        let r = W * 0.06
        func circle(_ radius: CGFloat, at p: CGPoint) -> CAShapeLayer {
            let c = CAShapeLayer()
            c.frame = CGRect(x: p.x - radius, y: p.y - radius, width: 2 * radius, height: 2 * radius)
            c.path = CGPath(ellipseIn: CGRect(x: 0, y: 0, width: 2 * radius, height: 2 * radius), transform: nil)
            c.opacity = 0
            return c
        }
        func play(_ layer: CALayer, at time: Double, duration: Double, opacity: [Double], scale: [Double], keys: [NSNumber]) {
            let fade = CAKeyframeAnimation(keyPath: "opacity"); fade.values = opacity; fade.keyTimes = keys
            let grow = CAKeyframeAnimation(keyPath: "transform.scale"); grow.values = scale; grow.keyTimes = keys
            let group = CAAnimationGroup(); group.animations = [fade, grow]
            group.beginTime = AVCoreAnimationBeginTimeAtZero + max(0, time); group.duration = duration
            group.isRemovedOnCompletion = false
            layer.add(group, forKey: "tap")
        }
        for tap in spec.taps ?? [] {
            guard let at = clipTime(tap[0]) else { continue }
            let p = CGPoint(x: W * tap[1], y: H * (1 - tap[2]))
            let dot = circle(r, at: p)
            dot.fillColor = CGColor(red: 0.88, green: 0.66, blue: 0.25, alpha: 0.75)
            dot.strokeColor = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
            dot.lineWidth = r * 0.14
            dot.shadowColor = CGColor(red: 0, green: 0, blue: 0, alpha: 1)
            dot.shadowOpacity = 0.6; dot.shadowRadius = r * 0.25; dot.shadowOffset = .zero
            play(dot, at: at - 0.15, duration: 0.9, opacity: [0, 1, 1, 0], scale: [0.5, 1.0, 0.92, 0.9], keys: [0, 0.15, 0.7, 1])
            let ripple = circle(r, at: p)
            ripple.fillColor = CGColor(red: 0, green: 0, blue: 0, alpha: 0)
            ripple.strokeColor = CGColor(red: 1, green: 1, blue: 1, alpha: 0.95)
            ripple.lineWidth = r * 0.1
            play(ripple, at: at - 0.05, duration: 0.7, opacity: [0.9, 0.6, 0], scale: [1.0, 1.9, 2.6], keys: [0, 0.5, 1])
            parent.addSublayer(ripple)
            parent.addSublayer(dot)
        }
        video.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)

        try? FileManager.default.removeItem(at: output)
        guard let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else { throw NSError(domain: "demo-edit", code: 3) }
        export.videoComposition = video
        try await export.export(to: output, as: .mp4)
        print(String(format: "clip: %d pieces, %d taps, %.1fs, %.0fx%.0f", spec.pieces.count, spec.taps?.count ?? 0, cursor.seconds, W, H))
    } catch {
        FileHandle.standardError.write("demo-edit failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
    sema.signal()
}
sema.wait()
