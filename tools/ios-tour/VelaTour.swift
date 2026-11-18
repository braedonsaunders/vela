// A scripted tour of Vela on an iPhone: taps, swipes and types through the app, attaching a
// screenshot (and, on request, the accessibility tree) at every step. Run with tools/ios.sh --tour;
// the screenshots land in the build directory's tour/ folder, named by step.
//
// Each test is one area, starting from a fresh launch, so one area's trouble does not cascade.
// Nothing asserts: a missing control is noted in an attachment and the tour moves on.
import ObjectiveC
import XCTest

/// Vela never goes idle (the hero's art drifts, previews loop), and XCUITest waits for an idle app
/// before every step, a minute at a time. The tour waits for itself instead.
private let skipIdleWaits: Void = {
  guard let process = NSClassFromString("XCUIApplicationProcess") else { return }
  let one: @convention(block) (AnyObject, Bool) -> Void = { _, _ in }
  let two: @convention(block) (AnyObject, Bool, Bool) -> Void = { _, _, _ in }
  for (name, block) in [("waitForQuiescenceIncludingAnimationsIdle:", one as Any), ("waitForQuiescenceIncludingAnimationsIdle:isPreEvent:", two as Any)] {
    if let method = class_getInstanceMethod(process, NSSelectorFromString(name)) {
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
  }
}()

final class VelaTour: XCTestCase {
  let app = XCUIApplication()
  private static var step = 0

  private var ownsPhone = false

  override func setUpWithError() throws {
    _ = skipIdleWaits
    let home = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    guard app.state == .runningForeground || home.state == .runningForeground else {
      throw XCTSkip("Another app is foreground; leave the owner's phone alone")
    }
    ownsPhone = true
    continueAfterFailure = true
    XCUIDevice.shared.orientation = .portrait
  }

  override func tearDown() {
    if ownsPhone { XCUIDevice.shared.orientation = .portrait }
  }

  // MARK: Areas

  func test01Launch() {
    app.launch()
    for i in 0..<4 {
      shot("launch-\(i)")
      wait(0.5)
    }
    waitForHome()
    shot("launch-home", tree: true)
  }

  func test02Home() {
    start()
    let hero = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
    hero.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.3)))
    wait(1.2)
    shot("home-hero-swiped")
    hero.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.3)))
    wait(1.2)
    shot("home-hero-swiped-2")
    for i in 0..<6 {
      app.swipeUp()
      wait(1)
      shot("home-scroll-\(i)", tree: i == 2)
    }
    // A row's own sideways scroll.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.6))
      .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.6)))
    wait(1)
    shot("home-row-scrolled")
  }

  func test03Sections() {
    start()
    for tab in ["Movies", "TV Shows", "Live TV", "Home"] {
      if tap(tab) {
        wait(2.5)
        shot("section-\(tab)", tree: tab != "Home")
      }
    }
  }

  func test04Library() {
    start()
    for section in ["Movies", "TV Shows"] {
      guard tap(section) else { continue }
      wait(4)
      for view in ["Recommended", "Library", "Collections", "Genres"] {
        if tap(view) {
          wait(4)
          shot("library-\(section)-\(view)", tree: view == "Library")
          app.swipeUp()
          wait(1.5)
          shot("library-\(section)-\(view)-scrolled")
        }
      }
    }
  }

  func test05MovieTitle() {
    start()
    guard tap("Movies") else { return }
    wait(4)
    guard let card = first(identifierPrefix: "title-") else { return note("no movie card") }
    card.tap()
    wait(3)
    shot("title-movie", tree: true)
    titleTour("movie")
  }

  func test06Series() {
    start()
    guard tap("TV Shows") else { return }
    wait(4)
    _ = tap("Library")
    wait(4)
    shot("series-library")
    guard let card = first(identifierPrefix: "title-") else { return note("no series card") }
    card.tap()
    wait(3)
    shot("series-title", tree: true)
    titleTour("series")
  }

  func test07Search() {
    start()
    guard tap("Search titles, people and moods", "Search") else { return }
    wait(1.5)
    shot("search-open", tree: true)
    // At a person's pace, then in a burst: either may lose characters while the page reshapes.
    for character in "coyote" {
      app.typeText(String(character))
      wait(0.25)
    }
    wait(2.5)
    shot("search-typed-slowly")
    let field = app.textFields.firstMatch
    clear(field)
    field.typeText("acme")
    wait(2.5)
    shot("search-typed-burst")
    clear(field)
    field.typeText("a heist that goes wrong\n")
    wait(8)
    shot("search-described", tree: true)
    app.swipeUp()
    wait(1)
    shot("search-described-scrolled")
  }

  func test08Live() {
    start()
    if !tap("Live TV") {
      drag(from: CGVector(dx: 0.8, dy: 0.14), to: CGVector(dx: 0.1, dy: 0.14))
      guard tap("Live TV") else { return }
    }
    wait(6)
    shot("live", tree: true)
    app.swipeUp()
    wait(1.5)
    shot("live-scrolled")
    drag(from: CGVector(dx: 0.8, dy: 0.6), to: CGVector(dx: 0.2, dy: 0.6))
    wait(1.5)
    shot("live-scrolled-time")
    if let channel = first(identifierPrefix: "channel-") ?? first(identifierPrefix: "guide-") {
      channel.tap()
      wait(6)
      shot("live-tuned", tree: true)
    } else {
      note("no channel to tune")
    }
  }

  func test09Player() {
    start()
    guard let resume = first(identifierPrefix: "hero-primary") else { return note("no play control on home") }
    resume.tap()
    wait(7)
    shot("player-portrait")
    showControls()
    shot("player-portrait-controls", tree: true)
    if tapID("player-audio-button") { wait(1); shot("player-audio-menu", tree: true); dismissMenu() }
    showControls()
    if tapID("player-cc-button") { wait(1); shot("player-subtitles-menu"); dismissMenu() }
    showControls()
    if tapID("player-speed-button") { wait(1); shot("player-speed-menu"); dismissMenu() }
    showControls()
    if tapID("player-quality-button") { wait(1); shot("player-quality-menu"); dismissMenu() }
    showControls()
    if tap("Back 10 seconds") { wait(1.5); shot("player-back-10") }
    showControls()
    if let bar = first(identifierPrefix: "player-scrub") {
      bar.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.3, thenDragTo: bar.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: 0.5)))
      wait(2)
      shot("player-seeked")
    }
    XCUIDevice.shared.orientation = .landscapeLeft
    wait(3)
    shot("player-landscape")
    showControls()
    shot("player-landscape-controls", tree: true)
    if tapID("player-audio-button") { wait(1); shot("player-landscape-audio-menu"); dismissMenu() }
    showControls()
    if tapID("player-cc-button") { wait(1); shot("player-landscape-subtitles-menu"); dismissMenu() }
    showControls()
    if tap("Picture in picture", "PiP") {
      wait(3)
      shot("player-pip")
      app.activate()
      wait(2)
    }
    XCUIDevice.shared.orientation = .portrait
    wait(2.5)
    showControls()
    if tapID("player-close") { wait(2.5); shot("player-left") }
  }

  func test10Profile() {
    start()
    guard tap("Profile and appearance") else { return }
    wait(1.2)
    shot("profile-menu", tree: true)
    if tap("Appearance") {
      wait(1.5)
      shot("appearance-picker", tree: true)
      app.swipeUp()
      wait(1)
      shot("appearance-picker-scrolled")
      tapAny(["Close"])
    }
  }

  func test11Skins() {
    for skin in ["Mochi", "Late Night", "Kids", "Cinematic"] {
      start()
      guard tap("Profile and appearance") else { return }
      wait(1.5)
      guard tap("Appearance") else { return }
      wait(2)
      if !tap(skin) {
        app.swipeUp()
        wait(1)
        if !tap(skin) { tapAny(["Close"]); continue }
      }
      wait(4)
      shot("skin-\(skin)-home")
      app.swipeUp()
      wait(1.5)
      shot("skin-\(skin)-home-scrolled")
      if skin != "Cinematic", let card = first(identifierPrefix: "title-") {
        card.tap()
        wait(3)
        shot("skin-\(skin)-title")
      }
    }
  }

  func test12Rotation() {
    start()
    XCUIDevice.shared.orientation = .landscapeLeft
    wait(3)
    shot("home-landscape", tree: true)
    app.swipeUp()
    wait(1.5)
    shot("home-landscape-scrolled")
    if let card = first(identifierPrefix: "title-") {
      card.tap()
      wait(3)
      shot("title-landscape")
    }
    XCUIDevice.shared.orientation = .portrait
    wait(3)
    shot("title-portrait-after-rotation")
  }

  /// How soon a library view switch answers: screenshots every ~0.3 s after each tab press, with
  /// no element queries in between (each one has the app build its accessibility tree).
  func test14LibrarySwitch() {
    start()
    guard tap("Movies") else { return }
    wait(6)
    for view in ["Library", "Recommended", "Library"] {
      guard let tab = element(label: view) else { continue }
      let frame = tab.frame
      let started = Date()
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
      while Date().timeIntervalSince(started) < 5 {
        shot(String(format: "switch-%@-%04dms", view, Int(Date().timeIntervalSince(started) * 1000)))
        wait(0.2)
      }
      wait(2)
    }
  }

  /// The libraries' full grids, scrolled, with as few element queries as possible (each one has
  /// the app build its whole accessibility tree): for watching memory while a grid fills.
  func test13LibraryGrids() {
    start()
    for section in ["Movies", "TV Shows"] {
      guard tap(section) else { continue }
      wait(5)
      guard tap("Library") else { continue }
      wait(6)
      shot("grid-\(section)")
      for _ in 0..<12 {
        drag(from: CGVector(dx: 0.5, dy: 0.8), to: CGVector(dx: 0.5, dy: 0.2))
        wait(1)
      }
      shot("grid-\(section)-scrolled")
    }
  }

  func test15Film() {
    start()
    guard tap("Movies") else { return }
    wait(4)
    guard let card = first(identifierPrefix: "title-") else { return note("no movie card") }
    card.tap()
    wait(3)
    guard tapID("detail-play") else { return }
    wait(10)
    shot("film-playing-portrait", tree: true)
    XCUIDevice.shared.orientation = .landscapeLeft
    wait(3)
    showControls()
    shot("film-playing-landscape", tree: true)
    print("VELA_IDLE_PHASE=playing")
    wait(35)
    showControls()
    if tap("Pause") {
      wait(3); shot("film-paused", tree: true)
      print("VELA_IDLE_PHASE=paused")
      wait(35)
    }
    showControls()
    if tapID("player-close") {
      wait(3); shot("film-left")
      print("VELA_IDLE_PHASE=left")
      wait(20)
    }
  }

  /// Adds a server by its address (VELA_TOUR_SERVER, else the lab) and signs in with Quick
  /// Connect: the code is printed as VELA_QUICK_CODE=<code> for an approver outside the phone.
  /// No credential is ever typed here (test logs and results record typed text).
  func testAddServer() {
    start()
    guard tap("Profile and appearance") else { return }
    wait(1.2)
    guard tapID("server-add") else { return }
    wait(2)
    shot("connect", tree: true)
    guard let field = first(identifierPrefix: "connect-address") else { return note("no address field") }
    field.tap()
    // XCTest can drop repeated keys when typing faster than native input events settle.
    let address = ProcessInfo.processInfo.environment["VELA_TOUR_SERVER"] ?? "http://192.168.68.65:32550"
    for character in address { field.typeText(String(character)); wait(0.12) }
    // Start above the keyboard; app.swipeUp() starts on the keyboard on an iPhone.
    drag(from: CGVector(dx: 0.5, dy: 0.49), to: CGVector(dx: 0.5, dy: 0.17))
    wait(1)
    // The address is checked as it is typed; Continue appears once the server has answered.
    guard let next = first(identifierPrefix: "connect-continue", timeout: 15) else {
      shot("connect-typed", tree: true)
      return note("the address found no server")
    }
    shot("connect-found")
    next.tap()
    wait(4)
    shot("connect-probed", tree: true)
    guard tapID("quick-connect") else { return }
    wait(3)
    let code = app.descendants(matching: .any).matching(identifier: "connect-code").firstMatch
    guard code.waitForExistence(timeout: 8) else { return note("no quick-connect code") }
    shot("quick-connect-code")
    print("VELA_QUICK_CODE=\(code.label.replacingOccurrences(of: " ", with: ""))")
    // The approver signs in elsewhere; the phone's poll then lands on home.
    _ = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] 'Profile and appearance'")).firstMatch.waitForExistence(timeout: 120)
    wait(4)
    shot("signed-in-home")
  }

  /// A title page: its description, its sections (seasons, episodes, extras, cast), then a person.
  private func titleTour(_ name: String) {
    if let more = first(identifierPrefix: "detail-summary-more") {
      more.tap()
      wait(1.2)
      shot("title-\(name)-description", tree: true)
      tapAny(["Close", "Done"])
      wait(1)
    }
    for label in ["Seasons", "Episodes", "Extras"] where element(label: label, timeout: 1) != nil {
      tap(label)
      wait(1.5)
      shot("title-\(name)-\(label)")
    }
    for i in 0..<5 {
      app.swipeUp()
      wait(1.2)
      shot("title-\(name)-scroll-\(i)", tree: i == 1)
    }
    // A cast tile: a button labelled with the person's name above their role.
    if let person = castTile() {
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: person.midX, dy: person.midY)).tap()
      wait(3)
      shot("person-from-\(name)", tree: true)
      app.swipeUp()
      wait(1.2)
      shot("person-from-\(name)-scrolled")
    } else {
      note("no cast tile on the \(name) page")
    }
  }

  // MARK: Helpers

  private func start() {
    app.launch()
    waitForHome()
  }

  private func waitForHome() {
    _ = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] 'Profile and appearance'")).firstMatch.waitForExistence(timeout: 20)
    wait(1.5)
  }

  private func wait(_ seconds: TimeInterval) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
  }

  private func shot(_ name: String, tree: Bool = false) {
    Self.step += 1
    let label = String(format: "%03d-%@", Self.step, name)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = label
    image.lifetime = .keepAlways
    add(image)
    if tree {
      let text = XCTAttachment(string: app.debugDescription)
      text.name = label + "-tree"
      text.lifetime = .keepAlways
      add(text)
    }
  }

  private func note(_ text: String) {
    Self.step += 1
    let attachment = XCTAttachment(string: text)
    attachment.name = String(format: "%03d-note", Self.step)
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(label: String, timeout: TimeInterval = 3) -> XCUIElement? {
    let match = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@ OR identifier == %@", label, label))
    let first = match.firstMatch
    guard first.waitForExistence(timeout: timeout) else { return nil }
    for index in 0..<min(match.count, 3) where match.element(boundBy: index).isHittable { return match.element(boundBy: index) }
    return nil
  }

  private func element(labelPrefix: String, timeout: TimeInterval = 3) -> XCUIElement? {
    let match = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH[c] %@", labelPrefix))
    guard match.firstMatch.waitForExistence(timeout: timeout) else { return nil }
    for index in 0..<min(match.count, 3) where match.element(boundBy: index).isHittable { return match.element(boundBy: index) }
    return nil
  }

  private func first(identifierPrefix: String, timeout: TimeInterval = 3) -> XCUIElement? {
    let match = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", identifierPrefix))
    guard match.firstMatch.waitForExistence(timeout: timeout) else { return nil }
    for index in 0..<min(match.count, 3) where match.element(boundBy: index).isHittable { return match.element(boundBy: index) }
    return nil
  }

  /// The frame of the first on-screen cast tile, found in one snapshot of the tree.
  private func castTile() -> CGRect? {
    guard let root = try? app.snapshot() else { return nil }
    let screen = app.frame
    var found: CGRect?
    func visit(_ node: XCUIElementSnapshot) {
      if found != nil { return }
      let f = node.frame
      if node.elementType == .button, node.identifier.isEmpty, !node.label.isEmpty,
         f.width > 60, f.width < 130, f.height > 100, screen.contains(CGPoint(x: f.midX, y: f.midY)),
         node.children.contains(where: { $0.elementType == .image || $0.elementType == .other }) {
        found = f
        return
      }
      node.children.forEach(visit)
    }
    visit(root)
    return found
  }

  private func clear(_ field: XCUIElement) {
    guard field.exists else { return }
    field.tap()
    if let value = field.value as? String, !value.isEmpty, value != field.placeholderValue {
      field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
    }
  }

  private func drag(from: CGVector, to: CGVector) {
    app.coordinate(withNormalizedOffset: from).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: to))
  }

  /// The player's controls hide on their own and a tap toggles them: show them if they are hidden.
  private func showControls() {
    if first(identifierPrefix: "player-toggle", timeout: 0.5) == nil {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
      wait(0.8)
    }
  }

  @discardableResult
  private func tap(_ labels: String...) -> Bool { tapAny(labels) }

  @discardableResult
  private func tapID(_ identifier: String) -> Bool {
    guard let found = first(identifierPrefix: identifier, timeout: 2) else {
      note("not found: #\(identifier)")
      return false
    }
    found.tap()
    return true
  }

  @discardableResult
  private func tapAny(_ labels: [String]) -> Bool {
    for label in labels {
      if let found = element(label: label, timeout: 2) {
        found.tap()
        return true
      }
    }
    note("not found: \(labels.joined(separator: " | "))")
    return false
  }

  private func dismissMenu() {
    if element(label: "Close", timeout: 0.5) != nil || element(label: "Done", timeout: 0.5) != nil {
      tapAny(["Close", "Done"])
    } else {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
    }
    wait(0.8)
  }
}
