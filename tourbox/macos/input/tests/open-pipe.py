# SPDX-License-Identifier: GPL-2.0-or-later
#!/usr/bin/env python3
"""Exercise the real bounded stdin reader with no shortcuts, AX, UI or OBS."""
import selectors
import subprocess
import sys

process = subprocess.Popen([sys.argv[1], "--self-test-stdio"], stdin=subprocess.PIPE,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
selector = selectors.DefaultSelector()
selector.register(process.stdout, selectors.EVENT_READ)

def line():
    if not selector.select(3):
        raise AssertionError("No immediate reply with stdin still open")
    result = process.stdout.readline().decode("utf-8").rstrip("\r\n")
    if not result:
        raise AssertionError("Unexpected EOF")
    return result

try:
    assert line() == "PIPE_READY"
    for command, reply in [(b"ARM 1\n", "PIPE ARM 1"), (b"DISARM\r\n", "PIPE DISARM"),
                           (b"ARM 2\r\n", "PIPE ARM 2"), (b"QUIT\n", "PIPE QUIT")]:
        process.stdin.write(command)
        process.stdin.flush()
        assert line() == reply
    # QUIT must exit with stdin still open; no EOF is used to flush earlier commands.
    assert process.wait(timeout=3) == 0
    print("PASS: immediate LF/CRLF command replies on an open pipe and QUIT without EOF. No native shortcuts or OBS.")
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    selector.close()
