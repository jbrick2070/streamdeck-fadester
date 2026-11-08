# Mac grouped-mix host

`FadesterMixHost` is a headless provider for the existing authenticated
`io.github.jbrick2070.fadester.mix.v1` protocol. It lets the Stream Deck whole-mix
controls and compatible clients share the same grouped-input gain owner. It is
not a TourBox Mac application and has no global hotkeys, Accessibility access,
native T-bar helper, or WebSocket-only Studio-fader fallback.

Build from the repository root with .NET 8:

```sh
dotnet publish tourbox/macos/bridge/FadesterMixHost.csproj -c Release \
  -r osx-arm64 --self-contained true -p:PublishSingleFile=true -o out/mix-host
./out/mix-host/FadesterMixHost --help
./out/mix-host/FadesterMixHost --paths
./out/mix-host/FadesterMixHost --self-test
```

Use `osx-x64` for Intel. The self-test uses synthetic state and a private loopback
fake OBS server, without accessing the installed OBS configuration.

Opt in explicitly when ready to run against your local OBS:

```sh
./out/mix-host/FadesterMixHost --enable-mix --mix-only
```

Alternatively create an optional configuration with `--init`, set `mixEnabled` to
`true` in that file, and run `--mix-only`. `--config PATH` selects another file.
The default is `~/Library/Application Support/FadesterTourBox/config.json`.
Defaults are port 4455, 3 dB steps and a 600 ms fade. Only loopback hosts are allowed.
No-argument startup displays help and performs no connection.

The host uses `FADESTER_OBS_PASSWORD` when explicitly supplied, otherwise reads
`~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json`
and checks its port, enabled state and authentication requirement. It never prints
or stores passwords, never accepts a password argument, and never changes OBS
settings. macOS Accessibility permission is not involved.

Type `quit`, press Ctrl+C, or send SIGTERM for shutdown. EOF is ignored so a
supervised background process can run with stdin closed. One host per local port
is allowed for the current user, independent of configuration path. Shutdown does
not raise levels automatically; the existing `mix-state` journal beside the
configuration preserves recovery. Use an explicit restore through your controller
when appropriate. This controls grouped public mixer inputs, not a native final
output master; routing/mutes stay untouched, external edits are left to the user,
and discovery of new inputs is periodic.
