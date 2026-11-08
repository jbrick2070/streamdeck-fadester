// SPDX-License-Identifier: GPL-2.0-or-later
import Darwin
import Foundation

/// A process-lifetime, same-user ownership lease. Never unlink an active lock inode.
final class NativeLease {
    private let descriptor: Int32
    init(pid: Int32, directory: URL? = nil) throws {
        guard pid > 0 else { throw NativeFailure.guardFailed("invalid lease target") }
        let base: URL
        if let directory { base = directory }
        else {
            base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("FadesterTourBox/NativeSliderLocks", isDirectory: true)
        }
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = base.appendingPathComponent("obs-\(pid).lock")
        let fd = open(file.path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, mode_t(0o600))
        guard fd >= 0 else { throw NativeFailure.guardFailed("cannot open native slider ownership lease") }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            close(fd); throw NativeFailure.guardFailed("another native slider helper already owns this OBS PID")
        }
        descriptor = fd
    }
    deinit { close(descriptor) }
}
