#!/usr/bin/env swift
import AppKit

// Run from the repository root: xcrun swift scripts/render-readme.swift
// Draws the app window with made-up games, using the real Icon Composer asset and native typography.
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

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
func rounded(_ rect: NSRect, radius: CGFloat, fill: UInt32, alpha: CGFloat = 1, stroke: UInt32? = nil) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    color(fill, alpha).setFill(); path.fill()
    if let stroke { color(stroke).setStroke(); path.lineWidth = 2; path.stroke() }
}
func gradient(_ rect: NSRect, radius: CGFloat, _ from: UInt32, _ to: UInt32) {
    NSGradient(starting: color(from), ending: color(to))!
        .draw(in: NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius), angle: -45)
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
func textWidth(_ value: String, size: CGFloat, weight: NSFont.Weight = .regular) -> CGFloat {
    (value as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight)]).width
}
func drawIcon(_ rect: NSRect) {
    context.saveGraphicsState()
    context.cgContext.translateBy(x: rect.minX, y: rect.maxY)
    context.cgContext.scaleBy(x: 1, y: -1)
    icon.draw(in: NSRect(origin: .zero, size: rect.size), from: .zero, operation: .sourceOver, fraction: 1)
    context.restoreGraphicsState()
}
func line(_ points: [NSPoint], stroke: UInt32, width: CGFloat = 2) {
    let path = NSBezierPath()
    path.move(to: points[0])
    for point in points.dropFirst() { path.line(to: point) }
    path.lineWidth = width; path.lineCapStyle = .round; path.lineJoinStyle = .round
    color(stroke).setStroke(); path.stroke()
}
func polygon(_ points: [NSPoint], fill: UInt32) {
    let path = NSBezierPath()
    path.move(to: points[0])
    for point in points.dropFirst() { path.line(to: point) }
    path.close(); color(fill).setFill(); path.fill()
}
func circle(_ center: NSPoint, _ radius: CGFloat, fill: UInt32, alpha: CGFloat = 1) {
    color(fill, alpha).setFill()
    NSBezierPath(ovalIn: NSRect(x: center.x - radius, y: center.y - radius,
                                width: radius * 2, height: radius * 2)).fill()
}
/// A tag chip sized to its label; returns where the next one starts.
func chip(_ label: String, x: CGFloat, y: CGFloat, dot: UInt32? = nil) -> CGFloat {
    let inset: CGFloat = dot == nil ? 0 : 20
    let width = textWidth(label, size: 19, weight: .medium) + 28 + inset
    rounded(NSRect(x: x, y: y, width: width, height: 36), radius: 9, fill: 0x0e1114, alpha: 0.55,
            stroke: 0x3a4250)
    if let dot { circle(NSPoint(x: x + 21, y: y + 18), 6, fill: dot) }
    text(label, NSRect(x: x + 14 + inset, y: y + 6, width: width, height: 26), size: 19,
         weight: .medium, fill: 0xd7dbe0)
    return x + width + 10
}
func toggle(x: CGFloat, y: CGFloat, on: Bool) {
    rounded(NSRect(x: x, y: y, width: 58, height: 32), radius: 16, fill: on ? 0x3d8bd9 : 0x39404a)
    circle(NSPoint(x: on ? x + 42 : x + 16, y: y + 16), 12, fill: 0xffffff)
}

// Background and title.
color(0x0e1418).setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
drawIcon(NSRect(x: 102, y: 62, width: 170, height: 170))
text("Aperto", NSRect(x: 306, y: 70, width: 900, height: 100), size: 78, weight: .semibold)
text("Every game on your Mac. One library.", NSRect(x: 309, y: 172, width: 1100, height: 48),
     size: 33, weight: .medium, fill: 0xa0a2a6)
var engineX: CGFloat = 1946
for engine in ["Mac", "CrossOver", "RPG Maker", "Ren’Py", "NW.js"] {
    let width = textWidth(engine, size: 22, weight: .medium) + 32
    engineX -= width
    rounded(NSRect(x: engineX, y: 128, width: width, height: 42), radius: 21, fill: 0x1a2027,
            stroke: 0x2e3640)
    text(engine, NSRect(x: engineX, y: 136, width: width, height: 30), size: 22, weight: .medium,
         fill: 0xb7bdc4, alignment: .center)
    engineX -= 12
}

// The window, running off the bottom edge.
let window = NSRect(x: 102, y: 286, width: 1844, height: 800)
context.saveGraphicsState()
NSBezierPath(roundedRect: window, xRadius: 26, yRadius: 26).addClip()
color(0x15181c).setFill(); window.fill()

// Sidebar: search, tag and filter buttons, and the game list.
color(0x111417).setFill(); NSRect(x: 102, y: 286, width: 430, height: 800).fill()
line([NSPoint(x: 532, y: 286), NSPoint(x: 532, y: 1086)], stroke: 0x262b32)
for (index, hex) in [0xff5f57, 0xfebc2e, 0x28c840].enumerated() {
    circle(NSPoint(x: 134 + CGFloat(index) * 30, y: 318), 9, fill: UInt32(hex))
}
rounded(NSRect(x: 126, y: 356, width: 286, height: 46), radius: 12, fill: 0x1b2026, stroke: 0x2c333c)
let lens = NSBezierPath(ovalIn: NSRect(x: 143, y: 368, width: 16, height: 16))
lens.lineWidth = 2.5; color(0x7d8590).setStroke(); lens.stroke()
line([NSPoint(x: 157, y: 383), NSPoint(x: 164, y: 390)], stroke: 0x7d8590, width: 2.5)
text("Search", NSRect(x: 176, y: 366, width: 200, height: 28), size: 21, fill: 0x6c7480)
for x in [422.0, 474.0] {
    rounded(NSRect(x: x, y: 356, width: 46, height: 46), radius: 12, fill: 0x1b2026, stroke: 0x2c333c)
}
let tag = NSBezierPath()
tag.move(to: NSPoint(x: 434, y: 370)); tag.line(to: NSPoint(x: 446, y: 370))
tag.line(to: NSPoint(x: 458, y: 382)); tag.line(to: NSPoint(x: 446, y: 394))
tag.line(to: NSPoint(x: 434, y: 382)); tag.close()
tag.lineWidth = 2.5; tag.lineJoinStyle = .round; color(0xaab1ba).setStroke(); tag.stroke()
for (index, half) in [11.0, 7.0, 3.0].enumerated() {
    let y = 371 + CGFloat(index) * 7
    line([NSPoint(x: 497 - half, y: y), NSPoint(x: 497 + half, y: y)], stroke: 0xaab1ba, width: 2.5)
}
let games: [(String, UInt32, UInt32)] = [
    ("Moonlit Garden", 0xf08a5d, 0xb83b5e), ("Lantern Road", 0xf9c74f, 0xf3722c),
    ("Hollow Pines", 0x43aa8b, 0x277da1), ("Starfall Academy", 0x9d4edd, 0x5a189a),
    ("Tidewater", 0x4cc9f0, 0x4361ee), ("Ember Hall", 0xe63946, 0x6a040f),
    ("Clockwork Quarter", 0xadb5bd, 0x495057), ("Saltmarsh", 0x90be6d, 0x2d6a4f),
]
text("FAVORITES", NSRect(x: 136, y: 428, width: 300, height: 26), size: 17, weight: .semibold, fill: 0x6f7782)
text("GAMES", NSRect(x: 136, y: 534, width: 300, height: 26), size: 17, weight: .semibold, fill: 0x6f7782)
for (index, game) in games.enumerated() {
    let y = index == 0 ? 460.0 : 566.0 + CGFloat(index - 1) * 62
    if index == 0 { rounded(NSRect(x: 118, y: y - 6, width: 398, height: 58), radius: 12, fill: 0x242a32) }
    gradient(NSRect(x: 132, y: y + 4, width: 38, height: 38), radius: 9, game.1, game.2)
    text(game.0, NSRect(x: 186, y: y + 8, width: 300, height: 32), size: 23,
         weight: index == 0 ? .medium : .regular, fill: index == 0 ? 0xf5f6f7 : 0xc5cad0)
    // A running game shows a green dot.
    if index == 3 { circle(NSPoint(x: 494, y: y + 23), 6, fill: 0x2fbf71) }
}

// Game page header: banner, icon, title, favorite star, and tags.
let hero = NSRect(x: 533, y: 286, width: 1413, height: 330)
NSGradient(colors: [color(0x3b2a63), color(0x6b3a6b), color(0x1f5560)])!.draw(in: hero, angle: -12)
context.saveGraphicsState()
NSBezierPath(rect: hero).addClip()
for (x, y, r, alpha) in [(1500.0, 360.0, 150.0, 0.16), (1720.0, 470.0, 220.0, 0.1), (1180.0, 330.0, 90.0, 0.12)] {
    circle(NSPoint(x: x, y: y), r, fill: 0xffffff, alpha: alpha)
}
context.restoreGraphicsState()
NSGradient(starting: color(0x15181c, 0), ending: color(0x15181c))!
    .draw(in: NSRect(x: 533, y: 446, width: 1413, height: 172), angle: 90)
gradient(NSRect(x: 573, y: 452, width: 132, height: 132), radius: 30, 0xf08a5d, 0xb83b5e)
circle(NSPoint(x: 639, y: 518), 34, fill: 0xfff1d6)
circle(NSPoint(x: 656, y: 504), 32, fill: 0xd1606a)
text("Moonlit Garden", NSRect(x: 735, y: 452, width: 900, height: 70), size: 54, weight: .semibold)
let titleEnd = 735 + textWidth("Moonlit Garden", size: 54, weight: .semibold)
let star = NSBezierPath()
for point in 0..<10 {
    let angle = CGFloat(point) * .pi / 5 - .pi / 2
    let radius: CGFloat = point % 2 == 0 ? 15 : 6.5
    let spot = NSPoint(x: titleEnd + 30 + cos(angle) * radius, y: 489 + sin(angle) * radius)
    point == 0 ? star.move(to: spot) : star.line(to: spot)
}
star.close(); color(0xf6c445).setFill(); star.fill()
var chipX: CGFloat = 737
for (label, dot) in [("rpg", UInt32(0x9d4edd)), ("fantasy", nil), ("romance", UInt32(0xe76f8a)),
                     ("multiple endings", nil), ("+9", nil)] as [(String, UInt32?)] {
    chipX = chip(label, x: chipX, y: 538, dot: dot)
}

// Play bar.
line([NSPoint(x: 533, y: 624), NSPoint(x: 1946, y: 624)], stroke: 0x262b32)
line([NSPoint(x: 533, y: 728), NSPoint(x: 1946, y: 728)], stroke: 0x262b32)
rounded(NSRect(x: 573, y: 646, width: 210, height: 60), radius: 14, fill: 0xf2f3f5)
polygon([NSPoint(x: 625, y: 662), NSPoint(x: 625, y: 690), NSPoint(x: 649, y: 676)], fill: 0x16191c)
text("Play", NSRect(x: 664, y: 656, width: 100, height: 40), size: 29, weight: .semibold, fill: 0x16191c)
for (index, fact) in [("Last played", "Today"), ("Played for", "6h 20m"), ("Runs with", "NW.js 0.119.2")].enumerated() {
    let x = 840 + CGFloat(index) * 220
    text(fact.0, NSRect(x: x, y: 650, width: 220, height: 26), size: 19, fill: 0x7d8590)
    text(fact.1, NSRect(x: x, y: 676, width: 220, height: 32), size: 24, weight: .medium)
}
for x in [1780.0, 1844.0] {
    rounded(NSRect(x: x, y: 650, width: 52, height: 52), radius: 12, fill: 0x1b2026, stroke: 0x2c333c)
}
rounded(NSRect(x: 1795, y: 668, width: 22, height: 17), radius: 3, fill: 0xaab1ba)
rounded(NSRect(x: 1795, y: 665, width: 10, height: 6), radius: 2, fill: 0xaab1ba)
line([NSPoint(x: 1860, y: 668), NSPoint(x: 1868, y: 676), NSPoint(x: 1860, y: 684)], stroke: 0xaab1ba, width: 2.5)
line([NSPoint(x: 1872, y: 686), NSPoint(x: 1882, y: 686)], stroke: 0xaab1ba, width: 2.5)

// Settings and activity.
text("Settings", NSRect(x: 573, y: 760, width: 400, height: 34), size: 25, weight: .semibold)
rounded(NSRect(x: 573, y: 808, width: 880, height: 300), radius: 16, fill: 0x1a1e23, stroke: 0x2a3038)
let rows: [(String, String?, Bool?)] = [
    ("Protection", "No internet or other programs. Saves stay in its folder.", true),
    ("Cheat menu", "Press 1 in the game to open it.", false),
    ("getPixel fix", "Prevents a crash in newer NW.js.", true),
]
for (index, row) in rows.enumerated() {
    let y = 808 + CGFloat(index) * 70
    if index > 0 { line([NSPoint(x: 573, y: y), NSPoint(x: 1453, y: y)], stroke: 0x2a3038) }
    text(row.0, NSRect(x: 603, y: y + 22, width: 200, height: 30), size: 22, weight: .medium)
    if let on = row.2 { toggle(x: 803, y: y + 19, on: on) }
    if let note = row.1 {
        text(note, NSRect(x: row.2 == nil ? 803 : 881, y: y + 23, width: 560, height: 30), size: 19,
             fill: 0x8a929c)
    }
}
text("Activity", NSRect(x: 1497, y: 760, width: 400, height: 34), size: 25, weight: .semibold)
for (index, entry) in [("Played", "Today · 1 h 12 min"), ("Played", "Yesterday · 48 min"),
                       ("Played", "Mon · 2 h 5 min")].enumerated() {
    let y = 818 + CGFloat(index) * 66
    circle(NSPoint(x: 1513, y: y + 18), 7, fill: index == 0 ? 0x2fbf71 : 0x5d6672)
    if index < 2 { line([NSPoint(x: 1513, y: y + 32), NSPoint(x: 1513, y: y + 60)], stroke: 0x2f363f) }
    text(entry.0, NSRect(x: 1537, y: y + 4, width: 300, height: 30), size: 21, weight: .medium)
    text(entry.1, NSRect(x: 1640, y: y + 6, width: 300, height: 28), size: 19, fill: 0x8a929c)
}
context.restoreGraphicsState()
let frame = NSBezierPath(roundedRect: window, xRadius: 26, yRadius: 26)
frame.lineWidth = 2; color(0x2a3038).setStroke(); frame.stroke()

NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: output)
print("Rendered \(output.path)")
