"""Windows OBS 33.0.1 integration fixture. Requires Python with pywin32, psutil and Pillow, and .NET 8.

Builds and runs the shipping StudioFader (or AudioDesk with --audio) against an authenticated disposable OBS instance.
Its independent Windows desktop is never displayed. No installed OBS profile or action is used.
"""
import argparse
import json
import msvcrt
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import uuid

import psutil
import win32api
import win32con
import win32event
import win32process
import win32service
from PIL import Image


def put(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8")


def configure(root, name, port, password):
    config = root / "config" / "obs-studio"
    put(root / "portable_mode.txt", "")
    put(config / "global.ini", "[General]\nLastVersion=553648129\nEnableAutoUpdates=false\n")
    put(config / "user.ini", f"[General]\nFirstRun=false\n[Basic]\nProfile={name}\nProfileDir={name}\n"
        f"SceneCollection={name}\nSceneCollectionFile={name}\n[BasicWindow]\nSysTrayEnabled=true\n"
        "SysTrayWhenStarted=false\nPreviewProgramMode=true\nRecordWhenStreaming=false\n")
    put(config / "basic" / "profiles" / name / "basic.ini", f"[General]\nName={name}\n"
        "[Video]\nBaseCX=640\nBaseCY=360\nOutputCX=640\nOutputCY=360\nFPSType=0\nFPSCommon=30\n"
        "[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n")
    sources = [{"name": f"{name} {color}", "uuid": str(uuid.uuid4()), "id": "scene", "versioned_id": "scene",
                "settings": {"items": []}, "enabled": True} for color in ("Blue", "Amber")]
    put(config / "basic" / "scenes" / (name + ".json"), {
        "name": name, "current_scene": sources[0]["name"], "current_program_scene": sources[0]["name"],
        "scene_order": [{"name": s["name"]} for s in sources], "sources": sources, "current_transition": "Fade",
        "transition_duration": 300, "transitions": [], "groups": [], "quick_transitions": [],
    })
    put(config / "plugin_config" / "obs-websocket" / "config.json", {
        "server_enabled": True, "server_port": port, "server_password": password, "auth_required": True,
        "first_load": False, "alerts_enabled": False,
    })


def own_listener(pid, exe, port):
    if Path(psutil.Process(pid).exe()).resolve() != exe:
        raise RuntimeError("Process image is outside the private runtime.")
    # Some Windows builds report wildcard TCP listening rows as NONE. Prove the
    # actual server-side four-tuple on a new local TCP connection before any RPC.
    listeners = {c.pid for c in psutil.net_connections(kind="tcp") if c.laddr.port == port and not c.raddr}
    if listeners and listeners != {pid}:
        raise RuntimeError("Another process owns the selected port. No connection was opened.")
    if listeners != {pid}:
        return False
    try:
        with socket.create_connection(("127.0.0.1", port), 1) as probe:
            local = probe.getsockname()[1]
            owners = {c.pid for c in psutil.net_connections(kind="tcp")
                      if c.laddr.port == port and c.raddr and c.raddr.port == local and
                      c.raddr.ip in ("127.0.0.1", "::ffff:127.0.0.1")}
            return owners == {pid}
    except OSError:
        return False


def run(root, source, dotnet, audio=False, mix=False, midi_plugin=None):
    bridge = Path(__file__).resolve().parent.parent / "bridge"
    project = root / "driver"
    project.mkdir()
    sources = ["BridgeConfig.cs", "ObsConnection.cs"]
    if mix:
        sources += ["StudioFader.cs", "AudioDesk.cs", "DeskActions.cs", "MixDesk.cs", "MixJournal.cs", "MixProtocolServer.cs"]
    else:
        sources += ["AudioDesk.cs" if audio else "StudioFader.cs"]
    for filename in sources:
        shutil.copyfile(bridge / filename, project / filename)
    if not audio and not mix:
        shutil.copyfile(bridge / "NativeTBar.cs", project / "NativeTBar.cs")
    driver = Path(__file__).with_name("live-mix.cs" if mix else "live-audio.cs" if audio else "live-obs.cs")
    shutil.copyfile(driver, project / "Program.cs")
    put(project / "Live.csproj", '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework>'
        '<OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>'
        '</PropertyGroup></Project>')
    subprocess.run([str(dotnet), "build", "Live.csproj", "--nologo", "-v", "quiet"], cwd=project, check=True, timeout=80)
    if not audio and not mix:
        subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        str(bridge.parent / "native/build.ps1"), "-OutputPath",
                        str(project / "bin/Debug/net8.0/FadesterNativeSlider.exe")], check=True)
    for asset in ["bin", "data", "core"]:
        # Private copies, never junctions or hardlinks back into an existing OBS installation.
        shutil.copytree(source / asset, root / asset, ignore=shutil.ignore_patterns("*.pdb"))
    exe = (root / "bin/64bit/obs64.exe").resolve()
    version = win32api.GetFileVersionInfo(str(exe), "\\")
    if (version["FileVersionMS"], version["FileVersionLS"]) != (33 << 16, 1 << 16):
        raise RuntimeError("Expected the OBS 33.0.1 executable.")
    name = "FadesterProbe" + secrets.token_hex(6)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    password = secrets.token_urlsafe(30)
    configure(root, name, port, password)
    obs_env = dict(os.environ)
    if midi_plugin:
        # OBS portable mode reads ../../plugins instead of ProgramData. Clear all optional
        # user plug-in paths and stage only the specified module and its resources.
        for key in ("OBS_PLUGINS_PATH", "OBS_LEGACY_PLUGINS_PATH", "OBS_LEGACY_PLUGINS_DATA_PATH"):
            obs_env.pop(key, None)
        dest = root / "plugins/midi-fadester"
        dest.mkdir(parents=True)
        shutil.copyfile(midi_plugin / "midi-fadester.dll", dest / "midi-fadester.dll")
        shutil.copytree(midi_plugin / "data", dest / "data")
        # Explicitly select a nonexistent MIDI endpoint; the private module must not open even a single hardware device.
        put(root / "config/obs-studio/plugin_config/midi-fadester/global.json",
            {"device_name": name + "-no-hardware-attached", "active_profile": "generic"})
    if mix:
        folder = root / "recordings"
        folder.mkdir()
        with (root / "config/obs-studio/basic/profiles" / name / "basic.ini").open("a", encoding="utf-8") as ini:
            ini.write(f"\n[Output]\nMode=Simple\n[SimpleOutput]\nFilePath={folder.as_posix()}\nRecFormat2=mkv\nRecQuality=Small\nRecEncoder=x264\n")
    desktop = win32service.CreateDesktop(name, 0, 0x000F01FF, None)
    process = None
    try:
        startup = win32process.STARTUPINFO()
        startup.lpDesktop = "winsta0\\" + name
        startup.dwFlags = win32con.STARTF_USESHOWWINDOW
        startup.wShowWindow = win32con.SW_SHOWNOACTIVATE   # Visible only inside the unused private desktop.
        argv = [str(exe), "--multi", "--portable", "--disable-updater", "--disable-shutdown-check",
                *([] if midi_plugin else ["--only-bundled-plugins"]), "--collection", name, "--profile", name]
        process, thread, pid, _ = win32process.CreateProcess(str(exe), subprocess.list2cmdline(argv),
            None, None, False, 0, obs_env, str(exe.parent), startup)
        thread.Close()
        print(f"Waiting for private PID {pid} to listen on port {port}.", flush=True)
        deadline = time.monotonic() + 35
        while not own_listener(pid, exe, port):
            if win32event.WaitForSingleObject(process, 100) == win32con.WAIT_OBJECT_0 or time.monotonic() > deadline:
                logs = sorted((root / "config/obs-studio/logs").glob("*.txt"))
                if logs:
                    print("Last private OBS log lines:", *logs[-1].read_text(encoding="utf-8-sig", errors="replace").splitlines()[-12:], sep="\n")
                raise RuntimeError("The private OBS process did not open its test port.")
        print(f"Verified the private OBS executable owns port {port} (PID {pid}).", flush=True)
        # One authenticated WebSocket, no reconnect: process replacement cannot inherit this connection.
        env = {**os.environ, "FADESTER_OBS_PASSWORD": password}
        if midi_plugin:
            env["FADESTER_FIXTURE_TEST_MIDI"] = "1"
        # The stock Windows accessibility provider and the OBS main window must share a desktop.
        # Only these inherited handles carry output; never activate or switch desktops.
        log_path = root / "driver.log"
        with open(log_path, "wb") as log, open(os.devnull, "rb") as nul:
            fileout, filein = (msvcrt.get_osfhandle(f.fileno()) for f in (log, nul))
            for h in (fileout, filein):
                os.set_handle_inheritable(h, True)
            si = win32process.STARTUPINFO()
            si.lpDesktop = startup.lpDesktop
            si.dwFlags = win32con.STARTF_USESTDHANDLES | win32con.STARTF_USESHOWWINDOW
            si.wShowWindow = win32con.SW_HIDE
            si.hStdOutput = si.hStdError = fileout
            si.hStdInput = filein
            argv = [str(dotnet), str(project / "bin/Debug/net8.0/Live.dll"), str(port), str(root), str(pid), name]
            test_proc, test_thread, _, _ = win32process.CreateProcess(str(dotnet), subprocess.list2cmdline(argv),
                None, None, True, win32con.CREATE_NO_WINDOW, env, str(project), si)
            test_thread.Close()
            try:
                if win32event.WaitForSingleObject(test_proc, 90000) == win32con.WAIT_TIMEOUT:
                    win32process.TerminateProcess(test_proc, 1)
                    win32event.WaitForSingleObject(test_proc, 5000)
                    raise RuntimeError("Isolated rehearsal timed out.")
                code = win32process.GetExitCodeProcess(test_proc)
            finally:
                test_proc.Close()
        print(log_path.read_text(encoding="utf-8", errors="replace"), flush=True)
        if code:
            raise RuntimeError("Private OBS driver failed: " + str(code))
        if mix:
            subprocess.run([shutil.which("python") or "python",
                            str(Path(__file__).with_name("verify-mix-output.py")), str(root)], check=True)
            return
        if audio:
            return  # The audio driver checks the independently read mixer level.
        pixels = {}
        for file in root.glob("*.png"):
            with Image.open(file) as image:
                pixels[file.stem] = image.convert("RGB").getpixel((image.width // 2, image.height // 2))
        print("Confirmed Program scene screenshot RGB center pixels:", pixels, flush=True)
        if pixels != {"initial": (0, 0, 255), "cancelled": (0, 0, 255),
                      "forward": (255, 153, 0), "return": (0, 0, 255), "cut": (255, 153, 0)}:
            raise RuntimeError("Endpoint scene pixels did not match the disposable solids.")
    finally:
        # The exact creation handle cannot refer to another PID, even on timeout or process replacement.
        if process is not None:
            if win32event.WaitForSingleObject(process, 0) == win32con.WAIT_TIMEOUT:
                win32process.TerminateProcess(process, 0)
                win32event.WaitForSingleObject(process, 5000)
            process.Close()
        desktop.CloseDesktop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--obs-root", type=Path, default=Path(os.environ["ProgramFiles"]) / "obs-studio")
    variant = parser.add_mutually_exclusive_group()
    variant.add_argument("--audio", action="store_true", help="test an external mixer adjustment during a live duck")
    variant.add_argument("--mix", action="store_true", help="verify grouped mixer requests and encoded two-tone output")
    parser.add_argument("--midi-plugin", type=Path, help="with --mix, also test this built midi-fadester module folder and its data/")
    parser.add_argument("--slot", default="33-0-1",
                        help="private test slot; a consistent clone path avoids repeated per-path firewall prompts")
    parser.add_argument("--dotnet", type=Path, default=shutil.which("dotnet") or Path(os.environ["LOCALAPPDATA"]) / "FadesterBuildTools/dotnet/dotnet.exe")
    args = parser.parse_args()
    if args.midi_plugin and (not args.mix or not (args.midi_plugin / "midi-fadester.dll").is_file() or
                             not (args.midi_plugin / "data").is_dir()):
        parser.error("--midi-plugin requires --mix and a module directory containing midi-fadester.dll and data/.")
    base = Path(tempfile.gettempdir()).resolve()
    if not re.fullmatch(r"[A-Za-z0-9-]{1,40}", args.slot):
        parser.error("Invalid fixture slot.")
    root = base / ("fadester-obs-lab-" + args.slot)
    root.mkdir()  # Exclusive: never adopt or delete a pre-existing directory or a concurrent run.
    try:
        run(root, args.obs_root.resolve(), Path(args.dotnet).resolve(), audio=args.audio, mix=args.mix, midi_plugin=args.midi_plugin)
    finally:
        if root.resolve().parent != base or not root.name.startswith("fadester-obs-lab-") or root.is_symlink():
            raise RuntimeError("Unexpected fixture directory; refusing cleanup.")
        # Stock OBS browser helpers can keep the private working directory open briefly after OBS exits.
        for attempt in range(20):
            try:
                shutil.rmtree(root)
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.25)
