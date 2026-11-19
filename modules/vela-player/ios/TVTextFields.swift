// tvOS draws a text field on a material platter of its own (a blurred, tinted capsule, white while
// focused) inside whatever box the skin draws around it: a box in a box. React Native's fields go
// without it; the skin draws the field and its focus ring. Installed once, as the module loads.
import ObjectiveC
import UIKit

enum TVTextFields {
    private static var installed = false
    private static var focusStyleKey: UInt8 = 0

    private final class FocusStyle: NSObject {
        weak var shell: UIView?
        let borderColor: CGColor?
        let borderWidth: CGFloat
        let transform: CGAffineTransform
        let radius: CGFloat
        init(_ shell: UIView) {
            self.shell = shell
            borderColor = shell.layer.borderColor
            borderWidth = shell.layer.borderWidth
            transform = shell.transform
            radius = shell.layer.cornerRadius
        }
        func restore() {
            shell?.layer.borderColor = borderColor
            shell?.layer.borderWidth = borderWidth
            shell?.transform = transform
            shell?.layer.cornerRadius = radius
        }
    }

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
                styleField(view)
            }
        }
        hook(field, #selector(UIView.didMoveToWindow)) { object in
            if let view = object as? UIView { styleField(view) }
        }
        hookFocus(field)
        #endif
    }

    private static func styleField(_ view: UIView) {
        if let field = view as? UITextField {
            if field.borderStyle != .none { field.borderStyle = .none }
            if field.background != nil { field.background = nil }
            if field.disabledBackground != nil { field.disabledBackground = nil }
            if field.backgroundColor != .clear { field.backgroundColor = .clear }
            if let ink = field.defaultTextAttributes[.foregroundColor] as? UIColor {
                if field.textColor != ink { field.textColor = ink }
                let placeholder = field.value(forKey: "placeholderColor") as? UIColor ?? ink.withAlphaComponent(0.6)
                let hint = NSAttributedString(string: field.placeholder ?? "", attributes: [.foregroundColor: placeholder])
                if field.attributedPlaceholder?.isEqual(to: hint) != true { field.attributedPlaceholder = hint }
                restoreLabelInk(in: field, ink: field.text?.isEmpty == false ? ink : placeholder)
            }
            styleFocusShell(field)
        }
        // Fabric may place the floating platter beside the backed UITextField. Its immediate
        // component view contains only the input; the skin's styled shell is outside it.
        clearPlatter(in: view.superview ?? view)
    }

    private static func styleFocusShell(_ field: UITextField) {
        let focusedView = UIFocusSystem.focusSystem(for: field)?.focusedItem as? UIView
        let focused = field.isFocused || focusedView?.isDescendant(of: field) == true
        guard field.window != nil && focused else {
            if let saved = objc_getAssociatedObject(field, &focusStyleKey) as? FocusStyle {
                saved.restore()
                objc_setAssociatedObject(field, &focusStyleKey, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            }
            return
        }
        guard objc_getAssociatedObject(field, &focusStyleKey) == nil else { return }
        // The native input is transparent. Lift and outline the existing rounded skin shell,
        // never draw a second shape inside it. React's editing focus arrives only on selection.
        var ancestor = field.superview
        for _ in 0..<8 {
            guard let shell = ancestor else { break }
            let radius = max(shell.layer.cornerRadius, shell.layer.sublayers?.map(\.cornerRadius).max() ?? 0)
            if radius > 0 && shell.bounds.height < max(1, field.bounds.height) * 2 {
                let saved = FocusStyle(shell)
                objc_setAssociatedObject(field, &focusStyleKey, saved, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
                shell.layer.cornerRadius = radius
                shell.layer.borderColor = field.tintColor.cgColor
                shell.layer.borderWidth = 2
                shell.transform = saved.transform.scaledBy(x: 1.025, y: 1.025)
                break
            }
            ancestor = shell.superview
        }
    }

    #if os(tvOS)
    private static func hookFocus(_ cls: AnyClass) {
        let selector = #selector(UIView.didUpdateFocus(in:with:))
        guard let method = class_getInstanceMethod(cls, selector) else { return }
        typealias Call = @convention(c) (AnyObject, Selector, UIFocusUpdateContext, UIFocusAnimationCoordinator) -> Void
        let previous = unsafeBitCast(method_getImplementation(method), to: Call.self)
        let block: @convention(block) (AnyObject, UIFocusUpdateContext, UIFocusAnimationCoordinator) -> Void = { object, context, coordinator in
            previous(object, selector, context, coordinator)
            guard let view = object as? UIView else { return }
            styleField(view)
            // UIKit rebuilds its focused platter during the focus animation, after layout.
            coordinator.addCoordinatedAnimations({ styleField(view) }, completion: { styleField(view) })
        }
        let implementation = imp_implementationWithBlock(block)
        if !class_addMethod(cls, selector, implementation, method_getTypeEncoding(method)) {
            method_setImplementation(method, implementation)
        }
    }
    #endif

    private static func restoreLabelInk(in view: UIView, ink: UIColor) {
        for child in view.subviews {
            if let label = child as? UILabel, label.textColor != ink { label.textColor = ink }
            restoreLabelInk(in: child, ink: ink)
        }
    }

    private static func clearPlatter(in view: UIView) {
        // The focused tvOS platter can put an opaque fill inside its content view as well as
        // in the visual effect's backdrop. Text/caret ink is separate from these backgrounds.
        view.isOpaque = false
        view.layer.isOpaque = false
        view.layer.shadowOpacity = 0
        if view.backgroundColor != .clear { view.backgroundColor = .clear }
        if view.layer.backgroundColor != UIColor.clear.cgColor { view.layer.backgroundColor = UIColor.clear.cgColor }
        for child in view.subviews {
            if let effect = child as? UIVisualEffectView {
                if effect.effect != nil {
                    effect.effect = nil
                }
                if effect.backgroundColor != .clear { effect.backgroundColor = .clear }
                if effect.contentView.backgroundColor != .clear { effect.contentView.backgroundColor = .clear }
                clearPlatter(in: effect.contentView)
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
