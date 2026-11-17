// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation
import CryptoKit

/// Discovery has an explicit read-only request vocabulary and never uses the action host.
enum ReadRequest: String {
    case scenes = "GetSceneList", inputs = "GetInputList", studio = "GetStudioModeEnabled"
    case items = "GetSceneItemList", volume = "GetInputVolume", media = "GetMediaInputStatus"
    // Only ever Visual Sidechain's read-only get_signals (visualSidechain()), as the Windows bridge's catalog does.
    case vendor = "CallVendorRequest"
}
struct ObsReadFailure: Error { let code: Int }

final class ObsDiscovery {
    private let session: URLSession
    private let socket: URLSessionWebSocketTask
    private var sequence = 0
    init(port: Int) throws {
        guard (1...65535).contains(port) else { throw PanelFailure.message("Invalid local OBS port.") }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8; config.timeoutIntervalForResource = 30
        session = URLSession(configuration: config)
        socket = session.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        socket.maximumMessageSize = 2 * 1024 * 1024
    }
    func close() { socket.cancel(with: .goingAway, reason: nil); session.invalidateAndCancel() }
    private func send(_ object: [String: Any]) async throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }
    private func receive() async throws -> [String: Any] {
        let timer = Task { [socket] in
            do { try await Task.sleep(nanoseconds: 8_000_000_000); socket.cancel(with: .goingAway, reason: nil) } catch { }
        }
        defer { timer.cancel() }
        let message = try await socket.receive()
        let data: Data
        switch message { case .data(let value): data = value; case .string(let value): data = Data(value.utf8); @unknown default: throw PanelFailure.message("Unexpected OBS message.") }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw PanelFailure.message("Invalid OBS response.") }
        return json
    }
    private func authenticate(_ password: String) async throws {
        guard !password.isEmpty else { throw PanelFailure.message("OBS authentication is required.") }
        socket.resume()
        let hello = try await receive()
        guard hello["op"] as? Int == 0, let data = hello["d"] as? [String: Any],
              let auth = data["authentication"] as? [String: Any], let salt = auth["salt"] as? String, let challenge = auth["challenge"] as? String else {
            throw PanelFailure.message("OBS must have WebSocket authentication enabled.")
        }
        let secret = Data(SHA256.hash(data: Data((password + salt).utf8))).base64EncodedString()
        let proof = Data(SHA256.hash(data: Data((secret + challenge).utf8))).base64EncodedString()
        try await send(["op":1,"d":["rpcVersion":1,"authentication":proof,"eventSubscriptions":0]])
        guard try await receive()["op"] as? Int == 2 else { throw PanelFailure.message("OBS did not accept authentication.") }
    }
    private func call(_ request: ReadRequest, _ arguments: [String: Any] = [:]) async throws -> [String: Any] {
        sequence += 1; let id = String(sequence)
        try await send(["op":6,"d":["requestType":request.rawValue,"requestId":id,"requestData":arguments]])
        let response = try await receive()
        guard response["op"] as? Int == 7, let data = response["d"] as? [String: Any], data["requestId"] as? String == id,
              let status = data["requestStatus"] as? [String: Any] else { throw PanelFailure.message("Unexpected OBS discovery reply.") }
        guard status["result"] as? Bool == true else { throw ObsReadFailure(code: status["code"] as? Int ?? 0) }
        return data["responseData"] as? [String: Any] ?? [:]
    }
    func scan(password: String) async throws -> Catalog {
        let deadline = Task { [self] in
            do { try await Task.sleep(nanoseconds: 25_000_000_000); close() } catch { }
        }
        defer { deadline.cancel(); close() }
        try await authenticate(password)
        let scenes = try await call(.scenes), inputs = try await call(.inputs), studio = try await call(.studio)
        guard let sceneRows = scenes["scenes"] as? [[String: Any]], let inputRows = inputs["inputs"] as? [[String: Any]],
              sceneRows.count <= 500, inputRows.count <= 1000 else { throw PanelFailure.message("OBS discovery exceeded its bounded catalog size.") }
        var result = Catalog()
        result.program = scenes["currentProgramSceneName"] as? String ?? "—"
        result.preview = scenes["currentPreviewSceneName"] as? String ?? "—"
        result.studio = studio["studioModeEnabled"] as? Bool == true
        for row in sceneRows.sorted(by: { ($0["sceneIndex"] as? Int ?? 0) > ($1["sceneIndex"] as? Int ?? 0) }) {
            guard let name = row["sceneName"] as? String else { throw PanelFailure.message("OBS scene name is missing.") }
            result.scenes.append(name)
            let response = try await call(.items, ["sceneName":name])
            guard let items = response["sceneItems"] as? [[String: Any]], items.count <= 5000 else { throw PanelFailure.message("OBS scene items were unavailable.") }
            result.items[name] = Array(Set(items.compactMap { $0["sourceName"] as? String })).sorted()
        }
        for row in inputRows {
            guard let name = row["inputName"] as? String else { throw PanelFailure.message("OBS input name is missing.") }
            do { _ = try await call(.volume, ["inputName":name]); result.audio.append(name) }
            catch let error as ObsReadFailure where [600,602,604,605,606].contains(error.code) { }
            do {
                let status = try await call(.media, ["inputName":name])
                let state = status["mediaState"] as? String ?? "OBS_MEDIA_STATE_NONE"
                let kind = row["inputKind"] as? String ?? ""
                if state != "OBS_MEDIA_STATE_NONE" || ["ffmpeg_source","vlc_source","obs_playlister_source"].contains(kind) { result.media.append(name) }
            } catch let error as ObsReadFailure where [600,602,604,605,606].contains(error.code) { }
        }
        result.visualSidechain = await visualSidechain()
        return result
    }

    /// The Visual Sidechain meter now, as the VS-METER line the host prints (DeskActions.Catalog's "visualSidechain" on Windows);
    /// "" when OBS could not say. A missing plugin is "not loaded".
    private func visualSidechain() async -> String {
        do {
            let reply = try await call(.vendor, ["vendorName": "visual-sidechain", "requestType": "get_signals", "requestData": [String: Any]()])
            guard let data = reply["responseData"] as? [String: Any] else { return "VS-METER: not_loaded" }
            if let error = data["error"] as? String, !error.isEmpty { return "VS-METER: not_loaded" }
            return Self.meterLine(data)
        } catch let error as ObsReadFailure where [600, 604].contains(error.code) {
            return "VS-METER: not_loaded"
        } catch {
            return ""
        }
    }

    /// get_signals' reply as a VS-METER line, read as VisualSidechainMonitor.ApplySignals and FormatHudPayload read it.
    static func meterLine(_ data: [String: Any]) -> String {
        func number(_ key: String, _ fallback: Double) -> Double {
            guard let value = (data[key] as? NSNumber)?.doubleValue, value.isFinite else { return fallback }
            return value
        }
        func unit(_ value: Double) -> Double { value.isFinite ? min(1, max(0, value)) : 0 }
        func percent(_ key: String) -> Int { Int((unit(number(key, 0)) * 100).rounded()) }
        let level = unit(number("level", number("rms", 0)))
        if (data["panic"] as? Bool) ?? false { return "VS-METER: panic" }
        if !((data["audio_present"] as? Bool) ?? (level > 0.001)) { return "VS-METER: no_audio" }
        let bpm = min(300, max(30, number("bpm", 120)))
        let locked = (data["bpm_locked"] as? Bool) ?? false
        let barPhase = unit(number("bar_phase", unit(number("beat_phase", 0)) / 4))
        var beat = min(3, Int((barPhase * 4).rounded(.down)))
        if let raw = (data["beat_index"] as? NSNumber)?.doubleValue, raw.isFinite, abs(raw) < 1e9 { beat = ((Int(raw.rounded(.towardZero)) % 4) + 4) % 4 }
        return "VS-METER: active \(Int(bpm.rounded())) \(locked ? 1 : 0) \(beat + 1) \(percent("sub_bass")) \(percent("bass")) \(percent("mid")) \(percent("high"))"
    }
}
