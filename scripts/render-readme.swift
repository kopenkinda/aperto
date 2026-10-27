#!/usr/bin/env swift
import AppKit

// Run from the repository root: xcrun swift scripts/render-readme.swift
// Uses the real Icon Composer asset and native macOS typography.
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let output = root.appendingPathComponent("Artwork/readme/banner.png")
let temporary = root.appendingPathComponent(".build/readme")
try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
let iconURL = temporary.appendingPathComponent("Aperto-dark.png")
let developer = ProcessInfo.processInfo.environment["DEVELOPER_DIR"] ?? "/Applications/Xcode.app/Contents/Developer"
let export = Process()
export.executableURL = URL(fileURLWithPath: developer).deletingLastPathComponent()
    .appendingPathComponent("Applications/Icon Composer.app/Contents/Executables/ictool")
export.arguments = ["Artwork/Aperto.icon", "--export-image", "--output-file", iconURL.path,
                    "--platform", "macOS", "--rendition", "Dark", "--width", "512",
                    "--height", "512", "--scale", "1", "--design-generation", "27"]
try export.run()
export.waitUntilExit()
precondition(export.terminationStatus == 0, "Icon export failed")
let icon = NSImage(contentsOf: iconURL)!
let width = 2048, height = 1012
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let context = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
context.cgContext.translateBy(x: 0, y: CGFloat(height))
context.cgContext.scaleBy(x: 1, y: -1)

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}
func rounded(_ rect: NSRect, radius: CGFloat, fill: UInt32, stroke: UInt32? = nil) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    color(fill).setFill(); path.fill()
    if let stroke { color(stroke).setStroke(); path.lineWidth = 2; path.stroke() }
}
func text(_ value: String, _ rect: NSRect, size: CGFloat, weight: NSFont.Weight = .regular,
          fill: UInt32 = 0xf5f6f7, alignment: NSTextAlignment = .left) {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color(fill), .paragraphStyle: style]
    // NSString drawing uses an unflipped graphics context.
    context.saveGraphicsState()
    context.cgContext.translateBy(x: rect.minX, y: rect.minY + rect.height)
    context.cgContext.scaleBy(x: 1, y: -1)
    (value as NSString).draw(in: NSRect(x: 0, y: 0, width: rect.width, height: rect.height),
                            withAttributes: attributes)
    context.restoreGraphicsState()
}
func drawIcon(_ rect: NSRect) {
    context.saveGraphicsState()
    context.cgContext.translateBy(x: rect.minX, y: rect.maxY)
    context.cgContext.scaleBy(x: 1, y: -1)
    icon.draw(in: NSRect(origin: .zero, size: rect.size), from: .zero,
              operation: .sourceOver, fraction: 1)
    context.restoreGraphicsState()
}
func shape(_ points: [NSPoint], fill: UInt32? = nil, stroke: UInt32? = nil, width: CGFloat = 2) {
    let path = NSBezierPath()
    path.move(to: points[0])
    for point in points.dropFirst() { path.line(to: point) }
    path.lineWidth = width; path.lineCapStyle = .round; path.lineJoinStyle = .round
    if let fill { path.close(); color(fill).setFill(); path.fill() }
    if let stroke { color(stroke).setStroke(); path.stroke() }
}
func arrow(_ x: CGFloat) {
    shape([NSPoint(x: x, y: 632), NSPoint(x: x + 34, y: 632)], stroke: 0x6a737e, width: 3.5)
    shape([NSPoint(x: x + 23, y: 621), NSPoint(x: x + 34, y: 632),
           NSPoint(x: x + 23, y: 643)], stroke: 0x6a737e, width: 3.5)
}
func chip(_ label: String, x: CGFloat, y: CGFloat, width: CGFloat) {
    rounded(NSRect(x: x, y: y, width: width, height: 40), radius: 10, fill: 0x2b3038, stroke: 0x46505c)
    text(label, NSRect(x: x, y: y + 6, width: width, height: 30), size: 20, weight: .medium,
         fill: 0xc9ced4, alignment: .center)
}

color(0x0e1418).setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
drawIcon(NSRect(x: 102, y: 87, width: 205, height: 205))
text("Aperto", NSRect(x: 350, y: 94, width: 1200, height: 112), size: 86, weight: .semibold)
text("Every game on your Mac. One library.", NSRect(x: 353, y: 218, width: 1300, height: 52),
     size: 36, weight: .medium, fill: 0xa0a2a6)
for (x, label) in [(102.0, "1  POINT AT A FOLDER"), (742.0, "2  PRESS PLAY"), (1382.0, "3  STAY SANDBOXED")] {
    rounded(NSRect(x: x, y: 376, width: 564, height: 502), radius: 34, fill: 0x191918)
    text(label, NSRect(x: x + 36, y: 411, width: 492, height: 36), size: 23, weight: .semibold, fill: 0x929497)
}
// A games folder, with the kinds of games Aperto finds in it.
rounded(NSRect(x: 196, y: 498, width: 120, height: 34), radius: 10, fill: 0x3a5a78)
rounded(NSRect(x: 196, y: 516, width: 376, height: 92), radius: 14, fill: 0x4a7194)
chip("NW.js", x: 181, y: 640, width: 108)
chip("Ren’Py", x: 299, y: 640, width: 118)
chip("RPG Maker", x: 427, y: 640, width: 160)
chip("Windows", x: 264, y: 692, width: 140)
chip("Mac", x: 414, y: 692, width: 90)
arrow(686)
// The Play button on a game's page.
rounded(NSRect(x: 878, y: 560, width: 292, height: 104), radius: 22, fill: 0xf2f3f5)
shape([NSPoint(x: 944, y: 588), NSPoint(x: 944, y: 636), NSPoint(x: 984, y: 612)], fill: 0x16191c)
text("Play", NSRect(x: 1006, y: 576, width: 140, height: 72), size: 50, weight: .semibold, fill: 0x16191c)
arrow(1326)
// A shield around the running game.
shape([NSPoint(x: 1664, y: 520), NSPoint(x: 1756, y: 552), NSPoint(x: 1752, y: 636),
       NSPoint(x: 1722, y: 690), NSPoint(x: 1664, y: 724), NSPoint(x: 1606, y: 690),
       NSPoint(x: 1576, y: 636), NSPoint(x: 1572, y: 552)], fill: 0x22303a, stroke: 0x92b5a8, width: 5)
shape([NSPoint(x: 1630, y: 622), NSPoint(x: 1654, y: 648), NSPoint(x: 1702, y: 594)],
      stroke: 0x92b5a8, width: 9)
for (x, caption) in [(126.0, "Every kind of game, found."),
                     (766.0, "Runtimes download when needed."),
                     (1406.0, "No internet. No stray files.")] {
    text(caption, NSRect(x: x, y: 787, width: 516, height: 40),
         size: 28, fill: 0xa0a2a6, alignment: .center)
}
text("Electron · Apple silicon · macOS 14 or later", NSRect(x: 102, y: 938, width: 1600, height: 38),
     size: 26, fill: 0x777c80)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: output)
print("Rendered \(output.path)")
