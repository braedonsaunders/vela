// Dedicated Ed25519 signing keys never leave the login keychain through this API.
import Foundation
import CryptoKit
import Security

func fail(_ message: String) -> Never { fputs(message + "\n", stderr); exit(1) }
let args = CommandLine.arguments
if args.count < 3 { fail("Usage: keychain <init|public|sign> <production-v1|lab-test-v1> [file]") }
let operation = args[1], account = args[2]
if !["production-v1", "lab-test-v1"].contains(account) { fail("Unknown signing identity") }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "app.vela.release-signing.ed25519", kSecAttrAccount as String: account,
    kSecAttrSynchronizable as String: false]
var lookup = query
lookup[kSecReturnData as String] = true
lookup[kSecMatchLimit as String] = kSecMatchLimitOne
var item: CFTypeRef?
var status = SecItemCopyMatching(lookup as CFDictionary, &item)
if status == errSecItemNotFound && operation == "init" {
    let key = Curve25519.Signing.PrivateKey()
    var create = query
    create[kSecValueData as String] = key.rawRepresentation
    create[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    status = SecItemAdd(create as CFDictionary, nil)
    if status != errSecSuccess { fail("Cannot create signing identity (OSStatus \(status))") }
    item = key.rawRepresentation as CFData
} else if status != errSecSuccess { fail("Cannot read signing identity (OSStatus \(status)); run init once") }
do {
    guard let bytes = item as? Data else { fail("Invalid keychain item") }
    let key = try Curve25519.Signing.PrivateKey(rawRepresentation: bytes)
    if operation == "init" || operation == "public" { print(key.publicKey.rawRepresentation.base64EncodedString()) }
    else if operation == "sign" && args.count == 4 {
        let message = try Data(contentsOf: URL(fileURLWithPath: args[3]))
        print(try key.signature(for: message).base64EncodedString())
    } else { fail("Invalid signing operation") }
} catch { fail("Signing operation failed") }
