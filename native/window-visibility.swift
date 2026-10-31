import Foundation
import CoreGraphics

// Inspect only the requested window owned by our caller. No screenshots or titles.
guard CommandLine.arguments.count == 3,
      let owner = Int32(CommandLine.arguments[1]), owner == getppid(),
      let windowID = UInt32(CommandLine.arguments[2]) else {
    FileHandle.standardError.write(Data("invalid_window_query\n".utf8))
    exit(1)
}
guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
    FileHandle.standardError.write(Data("window_list_unavailable\n".utf8))
    exit(1)
}
let visible = windows.contains {
    ($0[kCGWindowOwnerPID as String] as? Int32) == owner &&
    ($0[kCGWindowNumber as String] as? UInt32) == windowID
}
print(visible ? "{\"onScreen\":true}" : "{\"onScreen\":false}")
