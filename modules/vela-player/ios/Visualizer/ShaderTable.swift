import Foundation

// MARK: - The build-time shader table (tools/apple-shaders.ts)
struct ShaderTable {
    struct Uniform: Decodable { let name: String; let type: Int; let size: Int }
    struct Member: Decodable { let name: String; let type: String; let offset: Int; let count: Int; let arrayStride: Int; let matrixStride: Int }
    struct TextureSlot: Decodable { let name: String; let texture: Int; let sampler: Int }
    struct Stage: Decodable { let msl: String; let entry: String; let compiledEntry: String?; let ubo: Int; let uboSize: Int; let members: [Member]; let textures: [TextureSlot] }
    struct Screen: Decodable { let msl: String; let compiledEntry: String? }
    struct Stages: Decodable { let vs: Stage; let vsScreen: Screen; let fs: Stage }
    struct Row: Decodable { let vs: String; let fs: String; let uniforms: [Uniform]; let stages: Stages }
    struct Entry { let uniforms: [Uniform]; let vs: Stage; let vsScreen: Screen; let fs: Stage }
    let entries: [String: Entry]
    init(url: URL) throws {
        let rows = try JSONDecoder().decode([Row].self, from: Data(contentsOf: url))
        var e: [String: Entry] = [:]
        for r in rows { e[r.vs + "\u{0}" + r.fs] = Entry(uniforms: r.uniforms, vs: r.stages.vs, vsScreen: r.stages.vsScreen, fs: r.stages.fs) }
        entries = e
    }
}
