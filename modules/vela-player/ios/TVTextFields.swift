// tvOS gives a text field a rounded platter of its own (a dark capsule, white while focused) inside
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
        // The border style alone leaves tvOS's platter, which UIKit lays out as a private background
        // subview; it is hidden after every layout, which is when UIKit brings it back.
        hook(field, #selector(UIView.didMoveToWindow)) { ($0 as? UITextField)?.borderStyle = .none }
        hook(field, #selector(UIView.layoutSubviews)) { object in
            guard let text = object as? UITextField else {
                return
            }
            for view in text.subviews where NSStringFromClass(type(of: view)).contains("Background") {
                view.isHidden = true
            }
        }
        #endif
    }

    /// Runs `after` once the class's own (or inherited) implementation of `selector` has run.
    private static func hook(_ cls: AnyClass, _ selector: Selector, after: @escaping (AnyObject) -> Void) {
        guard let inherited = class_getInstanceMethod(cls, selector) else {
            return
        }
        typealias Call = @convention(c) (AnyObject, Selector) -> Void
        let previous = unsafeBitCast(method_getImplementation(inherited), to: Call.self)
        let block: @convention(block) (AnyObject) -> Void = { object in
            previous(object, selector)
            after(object)
        }
        let implementation = imp_implementationWithBlock(block)
        // Added to this class alone (UIView's own is left as it is), or replacing its own override.
        if !class_addMethod(cls, selector, implementation, method_getTypeEncoding(inherited)) {
            method_setImplementation(inherited, implementation)
        }
    }
}
