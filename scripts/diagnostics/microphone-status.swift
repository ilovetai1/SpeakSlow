// Read-only CoreAudio input status. Does not open a microphone or request access.
// Output PIDs only; the caller can scope these to its owned application processes.
import Foundation
import CoreAudio
func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}
func scalar(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> UInt32 {
    var key = address(selector), size = UInt32(MemoryLayout<UInt32>.size), value: UInt32 = 0
    let status = AudioObjectGetPropertyData(object, &key, 0, nil, &size, &value)
    guard status == noErr else { throw NSError(domain: "CoreAudio", code: Int(status)) }
    return value
}
if #available(macOS 14.2, *) {
    do {
        var key = address(kAudioHardwarePropertyProcessObjectList), size: UInt32 = 0
        let status = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &key, 0, nil, &size)
        guard status == noErr else { throw NSError(domain: "CoreAudio", code: Int(status)) }
        if size == 0 { FileHandle.standardOutput.write(Data("[]".utf8)); exit(0) }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        let read = objects.withUnsafeMutableBytes { AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &key, 0, nil, &size, $0.baseAddress!) }
        guard read == noErr else { throw NSError(domain: "CoreAudio", code: Int(read)) }
        let rows = try objects.map { object -> [String: Any] in
            ["pid": try scalar(object, kAudioProcessPropertyPID), "runningInput": try scalar(object, kAudioProcessPropertyIsRunningInput) != 0]
        }
        let data = try JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
    } catch { FileHandle.standardError.write(Data("CoreAudio status unavailable\n".utf8)); exit(1) }
} else { FileHandle.standardError.write(Data("Requires macOS 14.2\n".utf8)); exit(1) }
