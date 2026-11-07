// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation
import CryptoKit

/// Discovery has an explicit read-only request vocabulary and never uses the action host.
enum ReadRequest: String {
    case scenes = "GetSceneList", inputs = "GetInputList", studio = "GetStudioModeEnabled"
    case items = "GetSceneItemList", volume = "GetInputVolume", media = "GetMediaInputStatus"
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
        return result
    }
}
