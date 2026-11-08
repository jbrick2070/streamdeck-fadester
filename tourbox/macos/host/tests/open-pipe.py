# SPDX-License-Identifier: GPL-2.0-or-later
#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Real production stdin/ingress regression; no OBS, AX, shortcuts or config access.

Usage: python3 open-pipe.py PATH/TO/FadesterMacHost
   or: python open-pipe.py dotnet PATH/TO/FadesterMacHost.dll
"""
import os
from queue import Empty, Queue
import subprocess
import sys
from threading import Thread
import time


class PipeSession:
    def __init__(self, command):
        environment = {k: v for k, v in os.environ.items()
                       if not k.upper().startswith("FADESTER_")}
        self.process = subprocess.Popen([*command, "--self-test-stdio"],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, env=environment)
        self.lines = Queue()

        def read():
            for line in self.process.stdout:
                self.lines.put(line.decode("utf-8").rstrip("\r\n"))
            self.lines.put(None)

        self.reader = Thread(target=read, daemon=True)
        self.reader.start()
        try:
            self.expect("PIPE_READY 1", timeout=10)
        except BaseException:
            self.close()
            raise

    def send(self, value):
        self.process.stdin.write(value)
        self.process.stdin.flush()

    def expect(self, expected, timeout=3):
        try:
            actual = self.lines.get(timeout=timeout)
        except Empty:
            raise AssertionError("No immediate reply while stdin remains open") from None
        assert actual == expected, f"Expected {expected!r}, received {actual!r}"

    def quiet(self):
        try:
            actual = self.lines.get(timeout=0.1)
        except Empty:
            return
        raise AssertionError(f"Partial command produced output: {actual!r}")

    def finish(self):
        self.expect("PIPE_STOPPED")
        assert self.process.wait(timeout=3) == 0, "Host exited unsuccessfully"
        self.expect(None)

    def close(self):
        if self.process.poll() is None:
            self.process.kill()  # Only this test's no-service subprocess.
            self.process.wait(timeout=3)
        self.reader.join(timeout=1)
        for stream in (self.process.stdin, self.process.stdout):
            stream.close()


def run(command):
    session = PipeSession(command)
    try:
        for message, reply in [(b"action preview.status\n", "PIPE 1 preview.status"),
                               (b"action fader.status\r\n", "PIPE 1 fader.status")]:
            session.send(message)
            session.expect(reply)
        session.send(b"action recording.")
        session.quiet()
        session.send(b"status\r")
        session.quiet()
        session.send(b"\n")
        session.expect("PIPE 1 recording.status")
        session.send(b"action StartStream\n")
        session.expect("DROPPED: unknown action")
        session.send(b"a" * 300 + b"\n")
        session.expect("DROPPED: command exceeds 256 characters.")
        session.send(b"action preview.status\n")
        session.expect("PIPE 1 preview.status")
        session.send(b"event 0 0 preview.status\n")
        session.expect("DROPPED: inactive connection generation")
        session.send(f"event 1 {int(time.time() * 1000)} preview.status\n".encode("ascii"))
        session.expect("PIPE 1 preview.status")
        # Replies above and quit below MUST arrive before stdin is closed.
        session.send(b"quit\r\n")
        session.finish()
    finally:
        session.close()

    session = PipeSession(command)
    try:
        session.send(b"action fader.status\n")
        session.expect("PIPE 1 fader.status")
        session.send(b"action preview.status")
        session.quiet()
        session.process.stdin.close()
        session.finish()  # Unterminated EOF input must not become an action.
    finally:
        session.close()
    print("PASS: production host stdin/ingress immediate LF/CRLF and fragmented replies, "
          "malformed/overflow/generation guards, recovery, quit with open pipe and partial EOF. "
          "No OBS, native helper, shortcuts or configuration access.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: open-pipe.py HOST [HOST_ARGUMENTS...]")
    run(sys.argv[1:])
