import Cocoa
import ApplicationServices

// Only bounded AX ranges are read. AXValue/full window traversal is never used.
struct Field {
    let element: AXUIElement
    let bundle: String
    let expires: TimeInterval
}
var fields: [String: Field] = [:]
func attr(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name as CFString, &value) == .success ? value : nil
}
func range(_ e: AXUIElement) -> CFRange? {
    guard let v = attr(e, kAXSelectedTextRangeAttribute), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var r = CFRange()
    return AXValueGetValue(unsafeBitCast(v, to: AXValue.self), .cfRange, &r) ? r : nil
}
func text(_ e: AXUIElement, _ start: Int, _ length: Int) -> String? {
    if length == 0 { return "" }
    guard start >= 0, length >= 0, length <= 1200 else { return nil }
    var r = CFRange(location: start, length: length)
    guard let parameter = AXValueCreate(.cfRange, &r) else { return nil }
    var value: CFTypeRef?
    guard AXUIElementCopyParameterizedAttributeValue(e, kAXStringForRangeParameterizedAttribute as CFString, parameter, &value) == .success else { return nil }
    return value as? String
}
func response(_ status: String, _ values: [String: Any] = [:]) -> [String: Any] {
    var out = values; out["status"] = status; out["version"] = 1; return out
}
func run(_ request: [String: Any]) -> [String: Any] {
    guard request["version"] as? Int == 1, let op = request["operation"] as? String else { return response("protocol_error") }
    if op == "release" { if let token = request["fieldId"] as? String { fields.removeValue(forKey: token) }; return response("released") }
    if op == "listApps" {
        let apps = NSWorkspace.shared.runningApplications.compactMap { app -> [String: String]? in
            guard let id = app.bundleIdentifier, app.activationPolicy == .regular else { return nil }
            return ["bundleId": id, "name": app.localizedName ?? id]
        }
        return response("available", ["apps": Array(apps.prefix(100))])
    }
    guard let front = NSWorkspace.shared.frontmostApplication, let bundle = front.bundleIdentifier else { return response("unsupported") }
    if op == "metadata" { return response("available", ["bundleId": bundle]) }
    if bundle == "com.speakslow.app" || (request["denylist"] as? [String] ?? []).contains(bundle) { return response("denied_app") }
    guard AXIsProcessTrusted() else { return response("permission_denied") }
    let app = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.06)
    guard let raw = attr(app, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return response("unsupported") }
    let e = unsafeBitCast(raw, to: AXUIElement.self)
    AXUIElementSetMessagingTimeout(e, 0.06)
    let role = attr(e, kAXRoleAttribute) as? String ?? ""
    let subrole = attr(e, kAXSubroleAttribute) as? String ?? ""
    if subrole == "AXSecureTextField" || (attr(e, "AXProtectedContent") as? Bool == true) { return response("secure_field") }
    guard ["AXTextField", "AXTextArea", "AXComboBox"].contains(role) else { return response("unsupported") }
    var settable: DarwinBoolean = false
    let editable = AXUIElementIsAttributeSettable(e, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue
    guard editable || attr(e, "AXEditable") as? Bool == true else { return response("noneditable") }
    guard let selection = range(e), selection.location >= 0, selection.length >= 0,
          let count = attr(e, kAXNumberOfCharactersAttribute) as? Int, count >= selection.location + selection.length else { return response("unsupported") }
    fields = fields.filter { $0.value.expires > ProcessInfo.processInfo.systemUptime }
    var token = request["fieldId"] as? String
    if let previous = token {
        guard let field = fields[previous], field.bundle == bundle, CFEqual(field.element, e) else { return response("focus_changed") }
    } else {
        token = UUID().uuidString
        if fields.count >= 8, let oldest = fields.min(by: { $0.value.expires < $1.value.expires })?.key { fields.removeValue(forKey: oldest) }
        fields[token!] = Field(element: e, bundle: bundle, expires: ProcessInfo.processInfo.systemUptime + 18)
    }
    let end = selection.location + selection.length
    var values: [String: Any] = ["fieldId": token!, "bundleId": bundle, "editable": true, "secure": false, "selection": ["location": selection.location, "length": selection.length], "count": count]
    if op == "validate" { return response("available", values) }
    if op == "captureContext" || op == "prepareObservation" {
        let n = op == "captureContext" ? 70 : 50
        let beforeStart = max(0, selection.location - n)
        guard let before = text(e, beforeStart, selection.location - beforeStart), let after = text(e, end, min(n, count - end)) else { return response("unsupported") }
        values["before"] = String(String.UnicodeScalarView(before.unicodeScalars.suffix(n))); values["after"] = String(String.UnicodeScalarView(after.unicodeScalars.prefix(n)))
        if op == "captureContext" {
            guard let selected = text(e, selection.location, min(60, selection.length)) else { return response("unsupported") }
            values["selected"] = String(String.UnicodeScalarView(selected.unicodeScalars.prefix(60)))
        }
        return response("available", values)
    }
    if op == "observeSpan" {
        guard let start = request["start"] as? Int, let length = request["length"] as? Int,
              start >= 0, length >= 0, length <= 1000, start <= count else { return response("unsupported") }
        let take = min(length, count - start)
        guard let span = text(e, start, take), span.unicodeScalars.count <= 500,
              let before = text(e, max(0, start - 50), min(50, start)),
              let after = text(e, start + take, min(50, count - start - take)) else { return response("unsupported") }
        values["span"] = span; values["before"] = String(String.UnicodeScalarView(before.unicodeScalars.suffix(50))); values["after"] = String(String.UnicodeScalarView(after.unicodeScalars.prefix(50)))
        return response("available", values)
    }
    return response("protocol_error")
}
func handleLine(_ line: String) {
    do {
        guard line.utf8.count <= 65536, let data = line.data(using: .utf8), let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        var result = run(request); result["id"] = request["id"]
        let encoded = try JSONSerialization.data(withJSONObject: result)
        print(String(data: encoded, encoding: .utf8)!)
        fflush(stdout)
    } catch { print("{\"version\":1,\"status\":\"protocol_error\"}"); fflush(stdout) }
}

// NSWorkspace delivers foreground changes on the main run loop. A blocking
// stdin loop on that thread leaves frontmostApplication stale after a switch.
let keepAlivePort = Port()
RunLoop.main.add(keepAlivePort, forMode: .default)
DispatchQueue(label: "com.speakslow.context-reader.input", qos: .userInitiated).async {
    while let line = readLine() {
        DispatchQueue.main.async { handleLine(line) }
    }
    DispatchQueue.main.async { exit(0) }
}
RunLoop.main.run()
