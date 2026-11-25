import Metal
import QuartzCore

// Replays the glrec command buffer (packages/visualizer/runtime/PROTOCOL.md) with Metal.
// GL state is mirrored here; render passes open lazily on the first draw or clear for a framebuffer and close when
// another framebuffer is needed, at a resolve, or at the end of the frame. Uploads go through a staging ring and a
// blit, so they stay in order with the GPU work around them (a texture the previous frame is still reading is
// never overwritten from the CPU).

private enum GL {
    static let TEXTURE_MIN_FILTER: Int32 = 0x2801, TEXTURE_MAG_FILTER: Int32 = 0x2800, TEXTURE_WRAP_S: Int32 = 0x2802, TEXTURE_WRAP_T: Int32 = 0x2803
    static let NEAREST: Int32 = 0x2600, LINEAR: Int32 = 0x2601, LINEAR_MIPMAP_LINEAR: Int32 = 0x2703, LINEAR_MIPMAP_NEAREST: Int32 = 0x2701
    static let REPEAT: Int32 = 0x2901, MIRRORED_REPEAT: Int32 = 0x8370
    static let RED: Int32 = 0x1903, RG: Int32 = 0x8227, RGBA: Int32 = 0x1908
    static let UNSIGNED_BYTE: Int32 = 0x1401, FLOAT: Int32 = 0x1406, HALF_FLOAT: Int32 = 0x140B, UNSIGNED_INT: Int32 = 0x1405
    static let COLOR_ATTACHMENT0: Int32 = 0x8CE0, DEPTH_ATTACHMENT: Int32 = 0x8D00
    static let COLOR_BUFFER_BIT: Int32 = 0x4000, DEPTH_BUFFER_BIT: Int32 = 0x0100
    static let FRONT: Int32 = 0x0404, BACK: Int32 = 0x0405
}

final class MetalExecutor {
    struct Member { let offset: Int; let count: Int; let arrayStride: Int; let matrixStride: Int }
    struct StageInfo { let library: MTLLibrary; let entry: String; let ubo: Int; let uboSize: Int; let members: [String: Member]; let textures: [(name: String, texture: Int, sampler: Int)] }
    final class Program {
        let vs: StageInfo, vsScreen: MTLFunction, fs: StageInfo
        let names: [String]                         // location id -> uniform name
        var vsData: [UInt8], fsData: [UInt8]
        var units: [String: Int] = [:]              // sampler uniform -> texture unit
        var pipelines: [String: MTLRenderPipelineState] = [:]
        init(vs: StageInfo, vsScreen: MTLFunction, fs: StageInfo, names: [String]) {
            self.vs = vs; self.vsScreen = vsScreen; self.fs = fs; self.names = names
            vsData = [UInt8](repeating: 0, count: max(16, vs.uboSize)); fsData = [UInt8](repeating: 0, count: max(16, fs.uboSize))
        }
    }
    final class Tex { var mtl: MTLTexture?; var format: MTLPixelFormat = .rgba8Unorm; var w = 0, h = 0
        var minF = GL.LINEAR, magF = GL.LINEAR, wrapS: Int32 = 0x812F, wrapT: Int32 = 0x812F; var sampler: MTLSamplerState? }
    final class RB { var mtl: MTLTexture?; var samples = 1 }
    enum Attach { case tex(Int32), rb(Int32) }
    final class FB { var color: Attach?; var depth: Attach? }
    struct Attrib { var buf: Int32 = 0, size: Int32 = 4, type: Int32 = GL.FLOAT, stride: Int32 = 0, offset: Int32 = 0, divisor: Int32 = 0, on = false }
    final class VAO { var attribs: [Int32: Attrib] = [:]; var elements: Int32 = 0; var signature = "" }

    let device: MTLDevice
    let queue: MTLCommandQueue
    private let table: [String: ShaderTable.Entry]
    private var textures: [Int32: Tex] = [:], fbs: [Int32: FB] = [:], rbs: [Int32: RB] = [:], bufs: [Int32: MTLBuffer] = [:], vaos: [Int32: VAO] = [:]
    private var programs: [Int32: Program] = [:]
    private var depthStates: [Int: MTLDepthStencilState] = [:], samplers: [String: MTLSamplerState] = [:]
    // dynamic GL state
    private var curFb: Int32 = 0, viewport = (Int32(0), Int32(0), Int32(1), Int32(1)), curProgram: Int32 = 0
    private var flags: Int32 = 16, blendSrc: Int32 = 1, blendDst: Int32 = 0, depthFunc: Int32 = 0x0201, cull: Int32 = GL.BACK, colorMask: Int32 = 15
    private var units = [Int32](repeating: 0, count: 32)
    // per frame
    private var cmd: MTLCommandBuffer?, enc: MTLRenderCommandEncoder?, encFb: Int32 = -1
    private var encColorFormat: MTLPixelFormat = .invalid, encDepthFormat: MTLPixelFormat = .invalid, encSamples = 1, encHeight = 0
    var layer: CAMetalLayer?
    private var drawable: CAMetalDrawable?
    private let staging: [MTLBuffer]; private var stagingAt = 0, stagingIx = 0
    private let inFlight = DispatchSemaphore(value: 2)
    // measurements
    private(set) var gpuMs: Double = 0, encodeMs: Double = 0, linkMs: Double = 0, draws = 0, passes = 0
    var onFrameDone: ((Double) -> Void)?

    init(device: MTLDevice, table: ShaderTable) {
        self.device = device; queue = device.makeCommandQueue()!; self.table = table.entries
        staging = (0..<3).map { _ in device.makeBuffer(length: 4 << 20, options: .storageModeShared)! }
    }

    // MARK: link (synchronous, from JS)
    func link(id: Int32, vs: String, fs: String) -> [String: Any] {
        let t0 = CACurrentMediaTime()
        defer { linkMs += (CACurrentMediaTime() - t0) * 1000 }
        guard let e = table[vs + "\u{0}" + fs] else { return ["ok": false, "log": "program not in apple-shaders.json (rebuild the shader table)"] }
        do {
            func stage(_ s: ShaderTable.Stage) throws -> StageInfo {
                let lib = try device.makeLibrary(source: s.msl, options: nil)
                var m: [String: Member] = [:]
                for x in s.members { m[x.name] = Member(offset: x.offset, count: x.count, arrayStride: x.arrayStride, matrixStride: x.matrixStride) }
                return StageInfo(library: lib, entry: s.entry, ubo: s.ubo, uboSize: s.uboSize, members: m, textures: s.textures.map { ($0.name, $0.texture, $0.sampler) })
            }
            let v = try stage(e.vs), f = try stage(e.fs)
            let screenLib = try device.makeLibrary(source: e.vsScreenMsl, options: nil)
            guard let screenFn = screenLib.makeFunction(name: e.vs.entry) else { throw NSError(domain: "viz", code: 1) }
            programs[id] = Program(vs: v, vsScreen: screenFn, fs: f, names: e.uniforms.map { $0.name })
            return ["ok": true, "log": "", "uniforms": e.uniforms.map { ["name": $0.name, "type": $0.type, "size": $0.size] }]
        } catch { return ["ok": false, "log": "\(error)"] }
    }

    // MARK: replay
    func run(_ raw: UnsafeMutableRawPointer, words: Int) {
        let t0 = CACurrentMediaTime()
        let I = raw.assumingMemoryBound(to: Int32.self)
        @inline(__always) func f(_ k: Int) -> Float { raw.load(fromByteOffset: k * 4, as: Float.self) }
        if cmd == nil { beginFrame() }
        var k = 1
        while k < words {
            let op = I[k]; k += 1
            switch op {
            case 1: textures[I[k]] = Tex(); k += 1
            case 2: textures[I[k]] = nil; k += 1
            case 3: // TEX_IMAGE tex, ifmt, w, h, fmt, type, flipY, bytes
                let t = textures[I[k]] ?? Tex(); textures[I[k]] = t
                let ifmt = I[k + 1], w = Int(I[k + 2]), h = Int(I[k + 3]), fmt = I[k + 4], type = I[k + 5], flip = I[k + 6] != 0; k += 7
                t.format = Self.pixelFormat(ifmt); t.w = w; t.h = h
                let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: t.format, width: max(1, w), height: max(1, h), mipmapped: false)
                d.usage = [.shaderRead, .renderTarget]; d.storageMode = .private
                t.mtl = device.makeTexture(descriptor: d); t.sampler = nil
                let len = Int(I[k])
                if len > 0 { upload(t, x: 0, y: 0, w: w, h: h, fmt: fmt, type: type, flip: flip, src: raw.advanced(by: (k + 1) * 4), len: len) }
                k += 1 + (len + 3) / 4
            case 4: // TEX_SUB tex, x, y, w, h, fmt, type, bytes
                let t = textures[I[k]]!, x = Int(I[k + 1]), y = Int(I[k + 2]), w = Int(I[k + 3]), h = Int(I[k + 4]), fmt = I[k + 5], type = I[k + 6]; k += 7
                let len = Int(I[k]); upload(t, x: x, y: y, w: w, h: h, fmt: fmt, type: type, flip: false, src: raw.advanced(by: (k + 1) * 4), len: len)
                k += 1 + (len + 3) / 4
            case 5: // TEX_PARAM
                if let t = textures[I[k]] { let p = I[k + 1], v = I[k + 2]
                    if p == GL.TEXTURE_MIN_FILTER { t.minF = v } else if p == GL.TEXTURE_MAG_FILTER { t.magF = v } else if p == GL.TEXTURE_WRAP_S { t.wrapS = v } else if p == GL.TEXTURE_WRAP_T { t.wrapT = v }
                    t.sampler = nil }
                k += 3
            case 6: k += 1   // TEX_MIPMAP: only the text atlas uses mips (not in the spike scenes)
            case 7: fbs[I[k]] = FB(); k += 1
            case 8: fbs[I[k]] = nil; k += 1
            case 9: if let fb = fbs[I[k]] { if I[k + 1] == GL.DEPTH_ATTACHMENT { fb.depth = .tex(I[k + 2]) } else { fb.color = .tex(I[k + 2]) } }; k += 3
            case 10: if let fb = fbs[I[k]] { if I[k + 1] == GL.DEPTH_ATTACHMENT { fb.depth = .rb(I[k + 2]) } else { fb.color = .rb(I[k + 2]) } }; k += 3
            case 11: rbs[I[k]] = RB(); k += 1
            case 12: rbs[I[k]] = nil; k += 1
            case 13: // RB_STORAGE rb, samples, ifmt, w, h
                if let r = rbs[I[k]] {
                    let samples = Int(max(1, I[k + 1])), fmt = Self.pixelFormat(I[k + 2])
                    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: fmt, width: Int(I[k + 3]), height: Int(I[k + 4]), mipmapped: false)
                    d.usage = [.renderTarget]; d.storageMode = .private
                    if samples > 1 { d.textureType = .type2DMultisample; d.sampleCount = samples }
                    r.mtl = device.makeTexture(descriptor: d); r.samples = samples
                }
                k += 5
            case 14: k += 1
            case 15: // BUF_DATA buf, isElements, bytes
                let id = I[k], len = Int(I[k + 2]); k += 2
                bufs[id] = device.makeBuffer(bytes: raw.advanced(by: (k + 1) * 4), length: max(4, len), options: .storageModeShared)
                k += 1 + (len + 3) / 4
            case 16: vaos[I[k]] = VAO(); k += 1
            case 17: // VAO_ATTRIB vao, loc, buf, size, type, norm, stride, offset, divisor, enabled
                if let v = vaos[I[k]] { v.attribs[I[k + 1]] = Attrib(buf: I[k + 2], size: I[k + 3], type: I[k + 4], stride: I[k + 6], offset: I[k + 7], divisor: I[k + 8], on: I[k + 9] != 0)
                    v.signature = v.attribs.keys.sorted().map { let a = v.attribs[$0]!; return "\($0):\(a.on ? 1 : 0):\(a.size):\(a.stride):\(a.offset):\(a.divisor)" }.joined(separator: ",") }
                k += 10
            case 18: vaos[I[k]]?.elements = I[k + 1]; k += 2
            case 19: curProgram = I[k]; k += 1
            case 20: // UNIFORM program, loc, kind, count, data
                let p = programs[I[k]], loc = Int(I[k + 1]), kind = I[k + 2], count = Int(I[k + 3]); k += 4
                let comps = kind == 6 ? 9 : kind == 7 ? 16 : kind == 5 ? 1 : Int(kind)
                if let p = p, loc < p.names.count {
                    let name = p.names[loc]
                    if kind == 5 { p.units[name] = Int(I[k]) }
                    else {
                        if let m = p.vs.members[name] { write(&p.vsData, m, kind: kind, comps: comps, count: count, raw: raw, at: k) }
                        if let m = p.fs.members[name] { write(&p.fsData, m, kind: kind, comps: comps, count: count, raw: raw, at: k) }
                    }
                }
                k += comps * count
            case 21: curFb = I[k]; k += 1
            case 22: viewport = (I[k], I[k + 1], I[k + 2], I[k + 3]); k += 4
            case 23: // CLEAR mask, r, g, b, a, depth
                clear(mask: I[k], color: MTLClearColor(red: Double(f(k + 1)), green: Double(f(k + 2)), blue: Double(f(k + 3)), alpha: Double(f(k + 4))), depth: Double(f(k + 5))); k += 6
            case 24: flags = I[k]; blendSrc = I[k + 1]; blendDst = I[k + 2]; depthFunc = I[k + 3]; cull = I[k + 4]; colorMask = I[k + 5]; k += 6
            case 25: units[Int(I[k])] = I[k + 1]; k += 2
            case 26: draw(mode: I[k], first: Int(I[k + 1]), count: Int(I[k + 2]), instances: Int(I[k + 3]), vao: I[k + 4], indexed: nil); k += 5
            case 27: draw(mode: I[k], first: 0, count: Int(I[k + 1]), instances: Int(I[k + 4]), vao: I[k + 5], indexed: (I[k + 2], Int(I[k + 3]))); k += 6
            case 28: resolve(read: I[k], draw: I[k + 1]); k += 12
            case 29: programs[I[k]] = nil; k += 1
            case 30: endFrame()
            default: fatalError("viz: unknown opcode \(op) at word \(k - 1)")
            }
        }
        encodeMs += (CACurrentMediaTime() - t0) * 1000
    }

    // MARK: frame
    private func beginFrame() {
        inFlight.wait()
        cmd = queue.makeCommandBuffer(); stagingIx = (stagingIx + 1) % staging.count; stagingAt = 0; draws = 0; passes = 0
    }
    private func endFrame() {
        endEncoder()
        guard let c = cmd else { return }
        if let d = drawable { c.present(d) }
        c.addCompletedHandler { [weak self] cb in
            let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
            self?.gpuMs = ms; self?.onFrameDone?(ms); self?.inFlight.signal()
        }
        c.commit(); cmd = nil; drawable = nil
    }
    private func endEncoder() { enc?.endEncoding(); enc = nil; encFb = -1 }

    private func colorTexture(_ fb: Int32) -> MTLTexture? {
        if fb == 0 { if drawable == nil { drawable = layer?.nextDrawable() }; return drawable?.texture }
        guard let a = fbs[fb]?.color else { return nil }
        switch a { case .tex(let t): return textures[t]?.mtl; case .rb(let r): return rbs[r]?.mtl }
    }
    private func depthTexture(_ fb: Int32) -> MTLTexture? {
        guard fb != 0, let a = fbs[fb]?.depth else { return nil }
        switch a { case .tex(let t): return textures[t]?.mtl; case .rb(let r): return rbs[r]?.mtl }
    }
    private func openEncoder(fb: Int32, clearMask: Int32 = 0, color: MTLClearColor = MTLClearColor(), depth: Double = 1) {
        endEncoder()
        let d = MTLRenderPassDescriptor()
        guard let ct = colorTexture(fb) else { return }
        d.colorAttachments[0].texture = ct
        d.colorAttachments[0].loadAction = clearMask & GL.COLOR_BUFFER_BIT != 0 ? .clear : .load
        d.colorAttachments[0].clearColor = color; d.colorAttachments[0].storeAction = .store
        let dt = depthTexture(fb)
        if let dt = dt { d.depthAttachment.texture = dt; d.depthAttachment.loadAction = clearMask & GL.DEPTH_BUFFER_BIT != 0 ? .clear : .load
            d.depthAttachment.clearDepth = depth; d.depthAttachment.storeAction = .store }
        enc = cmd!.makeRenderCommandEncoder(descriptor: d); encFb = fb; passes += 1
        encColorFormat = ct.pixelFormat; encDepthFormat = dt?.pixelFormat ?? .invalid; encSamples = ct.sampleCount; encHeight = ct.height
    }
    private func clear(mask: Int32, color: MTLClearColor, depth: Double) { openEncoder(fb: curFb, clearMask: mask, color: color, depth: depth) }
    private func resolve(read: Int32, draw: Int32) {
        endEncoder()
        guard let src = colorTexture(read), let dst = colorTexture(draw) else { return }
        let d = MTLRenderPassDescriptor()
        d.colorAttachments[0].texture = src; d.colorAttachments[0].loadAction = .load
        d.colorAttachments[0].storeAction = .multisampleResolve; d.colorAttachments[0].resolveTexture = dst
        cmd!.makeRenderCommandEncoder(descriptor: d)?.endEncoding(); passes += 1
    }

    // MARK: draw
    private func draw(mode: Int32, first: Int, count: Int, instances: Int, vao: Int32, indexed: (Int32, Int)?) {
        guard let p = programs[curProgram] else { return }
        if enc == nil || encFb != curFb { openEncoder(fb: curFb) }
        guard let e = enc else { return }
        let screen = curFb == 0
        let v = vao != 0 ? vaos[vao] : nil
        let topo: MTLPrimitiveTopologyClass = mode == 0 ? .point : (mode == 1 || mode == 3) ? .line : .triangle
        let key = "\(screen ? 1 : 0)|\(encColorFormat.rawValue)|\(encDepthFormat.rawValue)|\(encSamples)|\(flags & 9)|\(blendSrc)|\(blendDst)|\(colorMask)|\(topo.rawValue)|\(v?.signature ?? "")"
        let pso: MTLRenderPipelineState
        if let cached = p.pipelines[key] { pso = cached } else {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = screen ? p.vsScreen : p.vs.library.makeFunction(name: p.vs.entry)
            d.fragmentFunction = p.fs.library.makeFunction(name: p.fs.entry)
            d.colorAttachments[0].pixelFormat = encColorFormat
            d.depthAttachmentPixelFormat = encDepthFormat
            d.rasterSampleCount = encSamples
            d.isAlphaToCoverageEnabled = flags & 8 != 0
            d.inputPrimitiveTopology = topo
            let ca = d.colorAttachments[0]!
            ca.writeMask = MTLColorWriteMask(rawValue: UInt((colorMask & 1 != 0 ? 8 : 0) | (colorMask & 2 != 0 ? 4 : 0) | (colorMask & 4 != 0 ? 2 : 0) | (colorMask & 8 != 0 ? 1 : 0)))
            if flags & 1 != 0 {
                ca.isBlendingEnabled = true
                ca.sourceRGBBlendFactor = Self.blend(blendSrc); ca.sourceAlphaBlendFactor = Self.blend(blendSrc)
                ca.destinationRGBBlendFactor = Self.blend(blendDst); ca.destinationAlphaBlendFactor = Self.blend(blendDst)
            }
            if let v = v {
                let vd = MTLVertexDescriptor()
                for (loc, a) in v.attribs where a.on {
                    let l = Int(loc), bi = 16 + l
                    vd.attributes[l].format = [MTLVertexFormat.float, .float2, .float3, .float4][Int(a.size) - 1]
                    vd.attributes[l].offset = 0; vd.attributes[l].bufferIndex = bi
                    vd.layouts[bi].stride = Int(a.stride != 0 ? a.stride : a.size * 4)
                    if a.divisor > 0 { vd.layouts[bi].stepFunction = .perInstance; vd.layouts[bi].stepRate = Int(a.divisor) }
                }
                d.vertexDescriptor = vd
            }
            do { pso = try device.makeRenderPipelineState(descriptor: d) } catch { NSLog("viz: pipeline: \(error)"); return }
            p.pipelines[key] = pso
        }
        e.setRenderPipelineState(pso)
        e.setDepthStencilState(depthState())
        e.setCullMode(flags & 4 != 0 ? (cull == GL.FRONT ? .front : .back) : .none)
        // GL fronts are counter-clockwise; flipping Y for offscreen passes turns them clockwise (to be confirmed on a culled scene).
        e.setFrontFacing(screen ? .counterClockwise : .clockwise)
        let (vx, vy, vw, vh) = viewport
        e.setViewport(MTLViewport(originX: Double(vx), originY: screen ? Double(encHeight) - Double(vy) - Double(vh) : Double(vy), width: Double(vw), height: Double(vh), znear: 0, zfar: 1))
        if p.vs.ubo >= 0 { p.vsData.withUnsafeBytes { e.setVertexBytes($0.baseAddress!, length: $0.count, index: p.vs.ubo) } }
        if p.fs.ubo >= 0 { p.fsData.withUnsafeBytes { e.setFragmentBytes($0.baseAddress!, length: $0.count, index: p.fs.ubo) } }
        for t in p.vs.textures { if let tx = textures[units[p.units[t.name] ?? 0]], let m = tx.mtl { e.setVertexTexture(m, index: t.texture); e.setVertexSamplerState(sampler(tx), index: t.sampler) } }
        for t in p.fs.textures { if let tx = textures[units[p.units[t.name] ?? 0]], let m = tx.mtl { e.setFragmentTexture(m, index: t.texture); e.setFragmentSamplerState(sampler(tx), index: t.sampler) } }
        if let v = v { for (loc, a) in v.attribs where a.on { if let b = bufs[a.buf] { e.setVertexBuffer(b, offset: Int(a.offset), index: 16 + Int(loc)) } } }
        let prim: MTLPrimitiveType = mode == 0 ? .point : mode == 1 ? .line : mode == 3 ? .lineStrip : mode == 5 ? .triangleStrip : .triangle
        if let (_, offset) = indexed, let v = v, let ib = bufs[v.elements] {
            e.drawIndexedPrimitives(type: prim, indexCount: count, indexType: .uint32, indexBuffer: ib, indexBufferOffset: offset, instanceCount: instances)
        } else {
            e.drawPrimitives(type: prim, vertexStart: first, vertexCount: count, instanceCount: instances)
        }
        draws += 1
    }

    private func depthState() -> MTLDepthStencilState {
        let test = flags & 2 != 0, write = test && flags & 16 != 0
        let key = (test ? 1 : 0) | (write ? 2 : 0) | Int(depthFunc) << 2
        if let s = depthStates[key] { return s }
        let d = MTLDepthStencilDescriptor()
        d.isDepthWriteEnabled = write
        d.depthCompareFunction = !test ? .always : [0x0200: .never, 0x0201: .less, 0x0202: .equal, 0x0203: .lessEqual, 0x0204: .greater, 0x0206: .greaterEqual, 0x0207: .always][depthFunc] ?? .less
        let s = device.makeDepthStencilState(descriptor: d)!; depthStates[key] = s; return s
    }
    private func sampler(_ t: Tex) -> MTLSamplerState {
        if let s = t.sampler { return s }
        let key = "\(t.minF)|\(t.magF)|\(t.wrapS)|\(t.wrapT)"
        if let s = samplers[key] { t.sampler = s; return s }
        let d = MTLSamplerDescriptor()
        d.minFilter = t.minF == GL.NEAREST ? .nearest : .linear; d.magFilter = t.magF == GL.NEAREST ? .nearest : .linear
        d.mipFilter = t.minF == GL.LINEAR_MIPMAP_LINEAR ? .linear : t.minF == GL.LINEAR_MIPMAP_NEAREST ? .nearest : .notMipmapped
        let wrap: (Int32) -> MTLSamplerAddressMode = { $0 == GL.REPEAT ? .repeat : $0 == GL.MIRRORED_REPEAT ? .mirrorRepeat : .clampToEdge }
        d.sAddressMode = wrap(t.wrapS); d.tAddressMode = wrap(t.wrapT)
        let s = device.makeSamplerState(descriptor: d)!; samplers[key] = s; t.sampler = s; return s
    }

    // MARK: uniforms and uploads
    private func write(_ data: inout [UInt8], _ m: Member, kind: Int32, comps: Int, count: Int, raw: UnsafeMutableRawPointer, at k: Int) {
        let n = min(count, m.count)
        data.withUnsafeMutableBytes { dst in
            for e in 0..<n {
                let base = m.offset + e * (m.count > 1 ? m.arrayStride : 0)
                if kind == 6 {          // mat3: three columns, each padded to 16 bytes
                    for c in 0..<3 { for r in 0..<3 { let o = base + c * max(16, m.matrixStride) + r * 4; if o + 4 <= dst.count { dst.storeBytes(of: raw.load(fromByteOffset: (k + e * 9 + c * 3 + r) * 4, as: Float.self), toByteOffset: o, as: Float.self) } } }
                } else {
                    for c in 0..<comps { let o = base + c * 4; if o + 4 <= dst.count { dst.storeBytes(of: raw.load(fromByteOffset: (k + e * comps + c) * 4, as: Float.self), toByteOffset: o, as: Float.self) } }
                }
            }
        }
    }

    private func upload(_ t: Tex, x: Int, y: Int, w: Int, h: Int, fmt: Int32, type: Int32, flip: Bool, src: UnsafeMutableRawPointer, len: Int) {
        guard let tex = t.mtl, w > 0, h > 0 else { return }
        let comps = fmt == GL.RED ? 1 : fmt == GL.RG ? 2 : 4
        let half = t.format == .rgba16Float || t.format == .r16Float || t.format == .rg16Float
        let outBpp = comps * (half ? 2 : type == GL.UNSIGNED_BYTE ? 1 : 4)
        let rowBytes = w * outBpp, size = rowBytes * h
        // stage
        var buf = staging[stagingIx], off = (stagingAt + 255) & ~255
        if off + size > buf.length { buf = device.makeBuffer(length: size, options: .storageModeShared)!; off = 0 } else { stagingAt = off + size }
        let dst = buf.contents().advanced(by: off)
        let inBpp = comps * (type == GL.UNSIGNED_BYTE ? 1 : type == GL.HALF_FLOAT ? 2 : 4)
        for row in 0..<h {
            let s = src.advanced(by: (flip ? h - 1 - row : row) * w * inBpp), d = dst.advanced(by: row * rowBytes)
            if half && type == GL.FLOAT {
                let fs = s.assumingMemoryBound(to: Float.self), hs = d.assumingMemoryBound(to: Float16.self)
                for i in 0..<(w * comps) { hs[i] = Float16(fs[i]) }
            } else { d.copyMemory(from: s, byteCount: min(rowBytes, w * inBpp)) }
        }
        _ = len
        endEncoder()
        let b = cmd!.makeBlitCommandEncoder()!
        b.copy(from: buf, sourceOffset: off, sourceBytesPerRow: rowBytes, sourceBytesPerImage: size, sourceSize: MTLSize(width: w, height: h, depth: 1),
               to: tex, destinationSlice: 0, destinationLevel: 0, destinationOrigin: MTLOrigin(x: x, y: y, z: 0))
        b.endEncoding()
    }

    static func pixelFormat(_ ifmt: Int32) -> MTLPixelFormat {
        switch ifmt {
        case 0x8058: return .rgba8Unorm
        case 0x881A: return .rgba16Float
        case 0x8814: return .rgba32Float
        case 0x822D: return .r16Float
        case 0x822E: return .r32Float
        case 0x822F: return .rg16Float
        case 0x822B: return .rg8Unorm
        case 0x8229: return .r8Unorm
        case 0x81A6, 0x8CAC, 0x81A5: return .depth32Float
        case 0x1908: return .rgba8Unorm
        default: NSLog("viz: unknown internal format 0x\(String(ifmt, radix: 16))"); return .rgba8Unorm
        }
    }
    static func blend(_ f: Int32) -> MTLBlendFactor {
        switch f {
        case 0: return .zero; case 1: return .one
        case 0x0300: return .sourceColor; case 0x0301: return .oneMinusSourceColor
        case 0x0302: return .sourceAlpha; case 0x0303: return .oneMinusSourceAlpha
        case 0x0304: return .destinationAlpha; case 0x0305: return .oneMinusDestinationAlpha
        case 0x0306: return .destinationColor; case 0x0307: return .oneMinusDestinationColor
        default: return .one
        }
    }
    func takeStats() -> (encodeMs: Double, linkMs: Double, draws: Int, passes: Int) { let r = (encodeMs, linkMs, draws, passes); encodeMs = 0; linkMs = 0; return r }
}
