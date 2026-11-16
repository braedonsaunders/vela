// Typecheck-only stand-in for Exact's module API (the real one is vendor/exact/host/apple/modules).
import UIKit
public typealias ExactNativeView = UIView
public struct ExactNativeRefusal: Error { public init(_ m: String) {} }
public final class ExactModuleContext { public let agent = false; public func now() -> Double { 0 } }
open class ExactModule { open class var views: [String: ExactNativeFactory] { [:] }; public let context = ExactModuleContext(); public required init() {} }
public final class ExactNativeEvents: @unchecked Sendable { public func message(_ t: String) {}; public func press() {}; public func load() {}; public func intrinsicSize(_ s: CGSize?) {} }
open class ExactNativeInstance { public let events: ExactNativeEvents; public init(events: ExactNativeEvents) { self.events = events }
  open var view: ExactNativeView { fatalError() }; open var focusTarget: ExactNativeView? { nil }
  open func setProps(_ props: [String: String]) throws {}; open func destroy() {} }
public struct ExactNativeFactory {
  public init(snapshot: Bool = false, reuse: Bool = false, firstFrame: Bool = false, make: @escaping ([String: String], ExactNativeEvents) throws -> ExactNativeInstance) {}
  public init<M: ExactModule>(for module: M.Type, snapshot: Bool = false, reuse: Bool = false, firstFrame: Bool = false, make: @escaping (M, [String: String], ExactNativeEvents) throws -> ExactNativeInstance) {}
}
let velaBuildOrigin = "https://example.invalid"
