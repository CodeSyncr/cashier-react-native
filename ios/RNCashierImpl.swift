import Foundation
import NimbusCashier
import StoreKit
import SwiftUI
import UIKit

/// The React Native bridge's Swift half: calls NimbusCashier and turns its
/// values into the plain dictionaries src/marshal.ts reads. RNCashier.mm
/// exports it to JavaScript (old architecture) and as a TurboModule (new).
///
/// Promise rejections use the codes src/errors.ts maps: E_NOT_CONFIGURED,
/// E_CONFIGURATION, E_INVALID_ARGUMENT, E_NETWORK, E_SERVER (userInfo: status,
/// serverCode), E_STORE, E_NOT_FOUND, E_PAYWALL_IN_PROGRESS, E_UI_UNAVAILABLE,
/// E_UNKNOWN.
@objc(RNCashierImpl)
public final class RNCashierImpl: NSObject {
    public typealias Resolve = (Any?) -> Void
    public typealias Reject = (String, String, [String: Any]?) -> Void

    @objc public static let customerInfoEvent = "Cashier.customerInfoUpdated"
    @objc public static let paywallAnswerEvent = "Cashier.paywallAnswer"

    /// Set by RNCashier.mm; sends an event to JavaScript when it listens.
    @objc public var emit: ((String, [String: Any]) -> Void)?

    private let lock = NSLock()
    private var streamTask: Task<Void, Never>?
    /// Packages from the last offerings fetch, keyed "offering/package":
    /// purchasePackage receives only the two ids from JavaScript.
    private var packages: [String: Package] = [:]
    /// The paywall on screen; one at a time. Main thread only.
    private var paywall: PaywallSession?
    private var paywallStarting = false

    deinit { streamTask?.cancel() }

    // MARK: - Configuration

    @objc public func configure(_ apiKey: String, appUserId: String?, baseUrl: String?,
                                resolve: @escaping Resolve, reject: @escaping Reject) {
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            return reject("E_CONFIGURATION", "Cashier.configure needs your public apiKey", nil)
        }
        // The SDK stops the app on a secret key (precondition); refuse it instead.
        guard !key.hasPrefix("cshr_live_") else {
            return reject("E_CONFIGURATION", "That is your SECRET key. Use the public key (cshr_pub_…) in an app.", nil)
        }
        var base = URL(string: "https://nimbusgo.space/")!
        if let raw = baseUrl, !raw.isEmpty {
            guard let url = URL(string: raw.hasSuffix("/") ? raw : raw + "/"), url.scheme != nil else {
                return reject("E_INVALID_ARGUMENT", "baseUrl is not a URL: \(raw)", nil)
            }
            base = url
        }
        let cashier = Cashier.configure(apiKey: key, appUserID: appUserId, baseURL: base)
        locked { packages = [:] }
        observeCustomerInfo(cashier)
        resolve(nil)
    }

    private func observeCustomerInfo(_ cashier: Cashier) {
        let task = Task { [weak self] in
            for await info in cashier.customerInfoStream {
                guard let self, !Task.isCancelled else { return }
                self.emit?(Self.customerInfoEvent, Marshal.customerInfo(info))
            }
        }
        let old: Task<Void, Never>? = locked {
            let previous = streamTask
            streamTask = task
            return previous
        }
        old?.cancel()
    }

    @objc public func getAppUserId(_ resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { Cashier.shared.appUserID }
    }

    @objc public func isAnonymous(_ resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { Cashier.shared.isAnonymous }
    }

    // MARK: - Customer info

    @objc public func getCustomerInfo(_ force: Bool, resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) {
            Marshal.customerInfo(try await Cashier.shared.customerInfo(fetchPolicy: force ? .fetchCurrent : .cachedOrFetched))
        }
    }

    // MARK: - Offerings & purchases

    @objc public func getOfferings(_ resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { [self] in await Marshal.offerings(try await loadOfferings()) }
    }

    private func loadOfferings() async throws -> Offerings {
        let offerings = try await Cashier.shared.offerings()
        var map: [String: Package] = [:]
        for offering in offerings.all.values {
            for pkg in offering.availablePackages { map[offering.identifier + "/" + pkg.identifier] = pkg }
        }
        locked { packages = map }
        return offerings
    }

    @objc public func purchasePackage(_ offeringIdentifier: String, packageIdentifier: String,
                                      resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { [self] in
            let key = offeringIdentifier + "/" + packageIdentifier
            var pkg = locked { packages[key] }
            if pkg == nil {
                _ = try await loadOfferings()
                pkg = locked { packages[key] }
            }
            guard let pkg else {
                throw BridgeError("E_NOT_FOUND", "No package \(packageIdentifier) in offering \(offeringIdentifier)")
            }
            let result = try await Cashier.shared.purchase(pkg)
            return [
                "customerInfo": result.customerInfo.map(Marshal.customerInfo) ?? NSNull(),
                "userCancelled": result.userCancelled,
                "isPending": result.isPending,
                "productIdentifier": result.transaction?.productID ?? pkg.storeProduct.id,
                "transactionId": result.transaction.map { String($0.id) } ?? NSNull(),
            ] as [String: Any]
        }
    }

    @objc public func restorePurchases(_ resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { Marshal.customerInfo(try await Cashier.shared.restorePurchases()) }
    }

    @objc public func syncPurchases(_ resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { Marshal.customerInfo(try await Cashier.shared.syncPurchases()) }
    }

    // MARK: - Identity

    @objc public func logIn(_ appUserId: String, resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { Marshal.customerInfo(try await Cashier.shared.logIn(appUserId)) }
    }

    @objc public func logOut(_ resolve: @escaping Resolve, reject: @escaping Reject) {
        run(resolve, reject) { Marshal.customerInfo(try await Cashier.shared.logOut()) }
    }

    // MARK: - Paywall

    /// Presents the offering's paywall from the key window's top view
    /// controller and resolves `{ result, customerInfo }` once it closes.
    @objc public func presentPaywall(_ requestId: String, requiredEntitlement: String?, offeringId: String?, locale: String?,
                                     resolve: @escaping Resolve, reject: @escaping Reject) {
        guard Cashier.isConfigured else { return Self.notConfigured(reject) }
        Task { @MainActor [self] in
            guard paywall == nil, !paywallStarting else {
                return reject("E_PAYWALL_IN_PROGRESS", "A paywall is already presented", nil)
            }
            paywallStarting = true
            do {
                if let entitlement = requiredEntitlement,
                   let info = try? await Cashier.shared.customerInfo(), info.isEntitled(to: entitlement) {
                    paywallStarting = false
                    return resolve(["result": "not_presented", "customerInfo": Marshal.customerInfo(info)])
                }
                // Loaded here rather than by PaywallView so a failure reaches
                // JavaScript instead of showing an empty fallback.
                let offerings = try await loadOfferings()
                let offering: Offering
                if let id = offeringId {
                    guard let o = offerings[id] else { throw BridgeError("E_NOT_FOUND", "No offering \(id)") }
                    offering = o
                } else {
                    guard let o = offerings.current else { throw BridgeError("E_NOT_FOUND", "No current offering") }
                    offering = o
                }
                guard let presenter = Self.topViewController() else {
                    throw BridgeError("E_UI_UNAVAILABLE", "No view controller to present the paywall from")
                }
                present(offering, from: presenter, requestId: requestId, requiredEntitlement: requiredEntitlement,
                        locale: locale, resolve: resolve)
            } catch {
                paywallStarting = false
                let (code, message, userInfo) = Self.map(error)
                resolve(["result": "error", "error": ["code": code, "message": message, "userInfo": userInfo]])
            }
        }
    }

    @MainActor
    private func present(_ offering: Offering, from presenter: UIViewController, requestId: String,
                         requiredEntitlement: String?, locale: String?, resolve: @escaping Resolve) {
        let session = PaywallSession { [weak self] session in
            self?.paywall = nil
            let info: Any = session.info.map { Marshal.customerInfo($0) } ?? NSNull()
            resolve(["result": session.outcome, "customerInfo": info])
        }
        let view = PaywallView(
            offering: offering,
            onPurchaseCompleted: { info in
                session.info = info
                session.outcome = "purchased"
                if requiredEntitlement.map({ info.isEntitled(to: $0) }) ?? true { session.close() }
            },
            onRestoreCompleted: { info in
                session.info = info
                let granted = requiredEntitlement.map { info.isEntitled(to: $0) } ?? true
                if granted, session.outcome != "purchased" { session.outcome = "restored" }
                if requiredEntitlement != nil, granted { session.close() }
            },
            onDismiss: { session.close() },
            locale: locale.flatMap { $0.isEmpty ? nil : Locale(identifier: $0) },
            onAnswer: { [weak self] answer in
                self?.emit?(Self.paywallAnswerEvent, [
                    "requestId": requestId,
                    "screenId": answer.screenID,
                    "question": answer.question,
                    "answer": answer.answer,
                ])
            }
        )
        let host = UIHostingController(rootView: view)
        // A designed paywall draws its own close button (or none, for a hard
        // paywall): full screen. The fallback list has none: a sheet the user
        // can swipe away.
        host.modalPresentationStyle = offering.paywall != nil ? .fullScreen : .pageSheet
        session.host = host
        host.presentationController?.delegate = session
        paywall = session
        paywallStarting = false
        presenter.present(host, animated: true)
    }

    @MainActor
    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        let window = windows.first(where: \.isKeyWindow)
            ?? scenes.first(where: { $0.activationState == .foregroundActive })?.windows.first
            ?? windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
        return top
    }

    // MARK: - Plumbing

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    /// Runs `body` once Cashier is configured, resolving its value or
    /// rejecting with the mapped error.
    private func run(_ resolve: @escaping Resolve, _ reject: @escaping Reject,
                     _ body: @escaping () async throws -> Any?) {
        guard Cashier.isConfigured else { return Self.notConfigured(reject) }
        Task {
            do {
                resolve(try await body())
            } catch {
                let (code, message, userInfo) = Self.map(error)
                reject(code, message, userInfo)
            }
        }
    }

    private static func notConfigured(_ reject: Reject) {
        reject("E_NOT_CONFIGURED", "Call Cashier.configure({ apiKey }) first", nil)
    }

    static func map(_ error: Error) -> (String, String, [String: Any]) {
        if let e = error as? BridgeError { return (e.code, e.message, [:]) }
        guard let e = error as? CashierError else { return ("E_UNKNOWN", error.localizedDescription, [:]) }
        switch e {
        case let .server(status, code, message):
            return ("E_SERVER", message.isEmpty ? (e.errorDescription ?? code) : message, ["status": status, "serverCode": code])
        case let .network(message):
            return ("E_NETWORK", message, [:])
        case let .purchase(message):
            return ("E_STORE", message, [:])
        case let .configuration(message):
            return ("E_CONFIGURATION", message, [:])
        }
    }
}

struct BridgeError: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }
}

/// One presented paywall: its outcome so far, and the single resolution
/// whichever way it closes (close button, purchase, restore, swipe).
final class PaywallSession: NSObject, UIAdaptivePresentationControllerDelegate {
    var outcome = "cancelled"
    var info: CustomerInfo?
    weak var host: UIViewController?
    private var finished = false
    private let completion: (PaywallSession) -> Void

    init(completion: @escaping (PaywallSession) -> Void) {
        self.completion = completion
    }

    func close() {
        DispatchQueue.main.async { [self] in
            guard let host, host.presentingViewController != nil else { return finish() }
            host.dismiss(animated: true) { self.finish() }
        }
    }

    func finish() {
        guard !finished else { return }
        finished = true
        completion(self)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish()
    }
}

/// NimbusCashier values as the dictionaries src/marshal.ts reads.
enum Marshal {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func date(_ d: Date?) -> Any { d.map { iso.string(from: $0) } ?? NSNull() }

    static func customerInfo(_ info: CustomerInfo) -> [String: Any] {
        var entitlements: [String: Any] = [:]
        for (id, e) in info.entitlements {
            entitlements[id] = [
                "identifier": e.identifier,
                "isActive": e.isActive,
                "willRenew": e.willRenew,
                "periodType": e.periodType.rawValue,
                "productIdentifier": e.productIdentifier ?? NSNull(),
                "source": e.source ?? NSNull(),
                "expirationDate": date(e.expirationDate),
            ] as [String: Any]
        }
        return [
            "appUserId": info.appUserID,
            "requestDate": date(info.requestDate),
            "entitlements": entitlements,
            "activeEntitlementIds": info.activeEntitlementIDs,
            "activeProductIds": info.activeProductIDs,
            "latestExpirationDate": date(info.latestExpirationDate),
        ]
    }

    static func experiment(_ e: PaywallExperiment?) -> Any {
        guard let e else { return NSNull() }
        return ["id": e.id, "variant": e.variant] as [String: Any]
    }

    static func offerings(_ o: Offerings) async -> [String: Any] {
        var all: [String: Any] = [:]
        for (id, offering) in o.all { all[id] = await Self.offering(offering) }
        return ["current": o.current?.identifier ?? NSNull(), "all": all, "experiment": experiment(o.experiment)]
    }

    static func offering(_ o: Offering) async -> [String: Any] {
        var pkgs: [[String: Any]] = []
        for p in o.availablePackages { pkgs.append(await package(p)) }
        return [
            "identifier": o.identifier,
            "serverDescription": o.serverDescription,
            "availablePackages": pkgs,
            "hasPaywall": o.paywall != nil,
            "paywallId": o.paywallID ?? NSNull(),
            "appName": o.appName,
            "experiment": experiment(o.experiment),
        ]
    }

    static func package(_ p: Package) async -> [String: Any] {
        [
            "identifier": p.identifier,
            "offeringIdentifier": p.offeringIdentifier,
            "product": await product(p.storeProduct),
            "cashierProduct": cashierProduct(p.cashierProduct),
        ]
    }

    static func cashierProduct(_ p: CashierProduct) -> [String: Any] {
        [
            "identifier": p.identifier,
            "name": p.name,
            "amount": NSNumber(value: p.amount),
            "currency": p.currency,
            "periodMonths": p.periodMonths,
            "trialDays": p.trialDays,
            "entitlements": p.entitlements,
            "appleProductId": p.appleProductID ?? NSNull(),
            "googleProductId": p.googleProductID ?? NSNull(),
        ]
    }

    static func product(_ p: Product) async -> [String: Any] {
        var trial: Any = NSNull()
        if let sub = p.subscription, let intro = sub.introductoryOffer, intro.paymentMode == .freeTrial,
           await sub.isEligibleForIntroOffer {
            trial = period(intro.period)
        }
        return [
            "identifier": p.id,
            "title": p.displayName,
            "description": p.description,
            "price": NSDecimalNumber(decimal: p.price).doubleValue,
            "priceString": p.displayPrice,
            "currencyCode": p.priceFormatStyle.currencyCode,
            "subscriptionPeriod": p.subscription.map { period($0.subscriptionPeriod) } ?? NSNull(),
            "freeTrialPeriod": trial,
        ]
    }

    /// ISO 8601 duration: P1M, P1Y, P7D, P2W.
    static func period(_ p: Product.SubscriptionPeriod) -> String {
        let unit: String
        switch p.unit {
        case .day: unit = "D"
        case .week: unit = "W"
        case .month: unit = "M"
        case .year: unit = "Y"
        @unknown default: unit = "D"
        }
        return "P\(p.value)\(unit)"
    }
}
