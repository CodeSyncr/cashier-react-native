# Changelog

## 1.0.0 (2026-10-02)

First release. A bridge over NimbusCashier for iOS 1.1.0 and com.github.CodeSyncr:cashier-android 1.1.0.

- `Cashier.configure({ apiKey, appUserId?, baseUrl? })`, which refuses a secret key.
- Customer info: `getCustomerInfo({ force? })`, `isEntitled(id)`, and `addCustomerInfoUpdateListener(fn)`, which returns a remove function and replays the last known value.
- `getOfferings()` returns offerings with store products (price, period, free trial). Each offering carries `hasPaywall`, `paywallId` and `experiment`, and the result carries `Offerings.experiment` for A/B tests.
- `purchasePackage(pkg)`, `restorePurchases()` and `syncPurchases()`.
- `logIn(id)`, `logOut()`, `getAppUserId()` and `isAnonymous()`.
- Paywalls: `presentPaywall({ requiredEntitlement?, offeringId?, offering?, locale?, onAnswer?, onError? })` and `presentPaywallIfNeeded(…)`. They resolve `'purchased' | 'restored' | 'cancelled' | 'not_presented' | 'error'`. iOS presents the SwiftUI `PaywallView` in a `UIHostingController` from the key window's top view controller. Android uses `Cashier.presentPaywall` with a `PaywallListener`.
- Typed errors: `CashierError` with stable `code`s mapped from both native SDKs, plus `status`, `serverCode`, `storeCode` and `isTransient`.
- Works with both React Native architectures: a TurboModule spec (`src/NativeCashier.ts`, codegen `RNCashierSpec`) and a bridge-module fallback.
