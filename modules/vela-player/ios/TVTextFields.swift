// tvOS gives a text field a rounded backing of its own (a dark capsule, white while focused) inside
// whatever box the skin draws around it: a box in a box. React Native's fields go without it; the
// skin draws the field and its focus ring. Installed once, as the module loads.
import ObjectiveC
import UIKit

enum TVTextFields {
    private static var installed = false

    static func install() {
        #if os(tvOS)
        guard !installed, let field = NSClassFromString("RCTUITextField") else {
            return
        }
        installed = true
        let selector = #selector(UIView.didMoveToWindow)
        guard let inherited = class_getInstanceMethod(field, selector) else {
            return
        }
        typealias DidMove = @convention(c) (AnyObject, Selector) -> Void
        let previous = unsafeBitCast(method_getImplementation(inherited), to: DidMove.self)
        let plain: @convention(block) (AnyObject) -> Void = { object in
            previous(object, selector)
            (object as? UITextField)?.borderStyle = .none
        }
        let implementation = imp_implementationWithBlock(plain)
        // Added to RCTUITextField alone (UIView's own is left as it is), or replacing its override.
        if !class_addMethod(field, selector, implementation, method_getTypeEncoding(inherited)) {
            method_setImplementation(inherited, implementation)
        }
        #endif
    }
}
