// tvOS draws a text field on a material platter of its own (a blurred, tinted capsule, white while
// focused) inside whatever box the skin draws around it: a box in a box. React Native's fields go
// without it; the skin draws the field and its focus ring. Installed once, as the module loads.
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
        // The platter is a UIVisualEffectView inside the field's floating content view, holding the
        // text in its content view: its effect is cleared (the text stays) after every layout, which
        // is when UIKit sets it up again.
        hook(field, #selector(UIView.layoutSubviews)) { object in
            if let view = object as? UIView {
                clearPlatter(in: view)
            }
        }
        #endif
    }

    private static func clearPlatter(in view: UIView) {
        for child in view.subviews {
            if let effect = child as? UIVisualEffectView {
                if effect.effect != nil {
                    effect.effect = nil
                }
                for layer in effect.subviews where layer !== effect.contentView {
                    layer.isHidden = true
                }
            } else {
                clearPlatter(in: child)
            }
        }
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
