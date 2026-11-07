"""Measure known synthetic tone amplitudes independently in four fixed-level private OBS recordings."""
import json
import math
import statistics
import struct
import subprocess
import sys
import time
from pathlib import Path

root = Path(sys.argv[1]).resolve()
samples = json.loads((root / "mix-markers.json").read_text())
rate = 48000

def load(file):
    if not root.name.startswith("fadester-obs-lab-") or file.parent != root / "recordings":
        raise ValueError("Not the private test recording.")
    cmd = ["ffmpeg", "-v", "error", "-i", str(file), "-map", "0:a:0", "-ac", "1",
           "-ar", str(rate), "-f", "f32le", "pipe:1"]
    deadline = time.monotonic() + 10
    while True:
        decoded = subprocess.run(cmd, capture_output=True, timeout=20)
        if decoded.returncode == 0 and len(decoded.stdout) >= 2.4 * rate * 4:
            return decoded.stdout
        if time.monotonic() > deadline:
            raise RuntimeError(f"OBS did not finalize a decodable test recording ({file.stat().st_size} bytes): "
                               + decoded.stderr.decode(errors="replace")[:240])
        time.sleep(.25)

def tone(pcm, start, frequency):
    begin = int(start * rate)
    vals = [s[0] for s in struct.iter_unpack("<f", pcm[begin * 4:(begin + rate // 4) * 4])]
    assert len(vals) == rate // 4
    step = 2 * math.pi * frequency / rate
    return 2 * abs(complex(sum(v * math.cos(i * step) for i, v in enumerate(vals)),
                           sum(v * math.sin(i * step) for i, v in enumerate(vals)))) / len(vals)

recordings = {key: load(Path(file).resolve()) for key, file in samples.items()}
for freq in [440, 880]:
    # Use identical fixed interior windows regardless of the result, away from AAC/recording startup.
    levels = {key: statistics.median(tone(pcm, sec, freq) for sec in [1.0, 1.5, 2.0])
              for key, pcm in recordings.items()}
    assert levels["baseline"] > .003, levels
    ratios = {k: v / levels["baseline"] for k, v in levels.items()}
    print(f"Recorded track 1, {freq} Hz: half {20*math.log10(ratios['half']):.2f} dB; "
          f"silence/baseline {ratios['silent']:.6f}; restore {20*math.log10(ratios['restored']):+.2f} dB.")
    assert abs(20 * math.log10(ratios["half"]) + 6.0206) < .6, levels
    assert ratios["silent"] < .001 and abs(20 * math.log10(ratios["restored"])) < .6, levels
