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
        // One empty lock file per OBS process used to stay behind for ever. The files of OBS processes that are gone
        // are of use to nobody: remove them. One whose process still runs, or that a helper holds, is left alone, and a
        // file is only unlinked while this process holds its lock, so an active lock is never unlinked.
        if let names = try? FileManager.default.contentsOfDirectory(atPath: base.path) {
            for name in names where name.hasPrefix("obs-") && name.hasSuffix(".lock") {
                guard let other = Int32(name.dropFirst(4).dropLast(5)), other > 0, other != pid else { continue }
                if kill(other, 0) == 0 || errno != ESRCH { continue }
                let stale = base.appendingPathComponent(name)
                let probe = open(stale.path, O_RDWR | O_CLOEXEC | O_NOFOLLOW)
                if probe < 0 { continue }
                if flock(probe, LOCK_EX | LOCK_NB) == 0 { unlink(stale.path) }
                close(probe)
            }
        }
    }
    deinit { close(descriptor) }
}
