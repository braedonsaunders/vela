import ExpoModulesCore
import Foundation
import Security

public final class VelaInstallStorageModule: Module {
    private let marker = "vela.install-initialized"

    public func definition() -> ModuleDefinition {
        Name("VelaInstallStorage")

        Function("isInitialized") { UserDefaults.standard.bool(forKey: self.marker) }
        Function("markInitialized") { UserDefaults.standard.set(true, forKey: self.marker) }

        Function("containerCreatedAt") { () -> Double? in
            let container = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            let metadata = try? container.resourceValues(forKeys: [.creationDateKey])
            return metadata?.creationDate?.timeIntervalSince1970
        }

        Function("secretUpdatedAt") { (key: String) -> Double? in
            for query in self.queries(for: key) {
                var attributes = query
                attributes[kSecReturnAttributes as String] = true
                var result: CFTypeRef?
                let status = SecItemCopyMatching(attributes as CFDictionary, &result)
                if status == errSecItemNotFound { continue }
                try self.check(status)
                let values = result as? [String: Any]
                guard let date = values?[kSecAttrModificationDate as String] as? Date else {
                    throw NSError(domain: "VelaInstallStorage", code: Int(errSecDecode))
                }
                return date.timeIntervalSince1970
            }
            return nil
        }

        Function("removeSecret") { (key: String) in
            for query in self.queries(for: key) {
                try self.check(SecItemDelete(query as CFDictionary))
            }
        }
    }

    // Match expo-secure-store's default service and its authenticated and legacy aliases.
    private func queries(for key: String) -> [[String: Any]] {
        let account = Data(key.utf8)
        return ["app:no-auth", "app:auth", "app"].map { service in
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrGeneric as String: account,
                kSecAttrAccount as String: account,
            ]
        }
    }

    private func check(_ status: OSStatus) throws {
        if status != errSecSuccess && status != errSecItemNotFound {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }
}
