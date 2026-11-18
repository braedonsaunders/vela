import AetherEngine

// Keep the byte transport independent of the engine so its scope, seek and
// cancellation behavior can run under Foundation in the host tests.
typealias ScopedAetherReader = ScopedMediaByteReader

extension ScopedMediaByteReader: IOReader {
    func makeIndependentReader() -> IOReader? { makeSiblingReader() }
}
