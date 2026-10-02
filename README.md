# Nimbus Cashier for React Native

App Store and Google Play subscriptions for React Native apps, backed by [Nimbus Cashier](https://nimbusgo.space/docs/cashier-cloud). Purchases go through StoreKit 2 and Google Play Billing. Cashier verifies every one with the store, keeps it current through renewals, refunds and billing problems, and tells your app whether the user is entitled to premium.

This package is a thin bridge over the two native SDKs, [cashier-ios](https://github.com/CodeSyncr/cashier-ios) (`NimbusCashier`) and [cashier-android](https://github.com/CodeSyncr/cashier-android) (`com.nimbus.cashier`). Paywalls you design in the Cashier console are drawn natively, in SwiftUI on iOS and Jetpack Compose on Android.

**Requirements:** React Native 0.71+ (old or new architecture), iOS 15+, Android minSdk 24, Java 17.

## Install

```sh
npm install @codesyncr/cashier-react-native
```

### iOS

The native SDK comes from CocoaPods. Until `NimbusCashier` is on the CocoaPods trunk, point your `ios/Podfile` at its git tag (inside your app target):

```ruby
pod 'NimbusCashier', :git => 'https://github.com/CodeSyncr/cashier-ios.git', :tag => '1.1.0'
```

Then:

```sh
cd ios && pod install
```

In Xcode, add the **In-App Purchase** capability.

### Android

`com.github.CodeSyncr:cashier-android` is published through JitPack. The React Native Gradle Plugin already adds JitPack to every project. On an older setup, or if Gradle cannot resolve it, add the repository in `android/build.gradle` (`allprojects { repositories { … } }`) or `settings.gradle` (`dependencyResolutionManagement`):

```groovy
maven { url "https://jitpack.io" }
```

Autolinking registers the module. The Play Billing permission and the paywall's activity come from the SDK's manifest.

Overrides are optional. Set them in the root `android/build.gradle` `ext { }`: `cashierAndroidVersion` (default `1.1.0`), `kotlinVersion`, `compileSdkVersion`, `targetSdkVersion`, `minSdkVersion` (at least 24).

## Configure

Call `configure` once, early. Use the **public** key (`cshr_pub_…`) from your Cashier app's Settings & keys. The secret key (`cshr_live_…`) is refused.

```ts
import { Cashier } from '@codesyncr/cashier-react-native';

await Cashier.configure({
  apiKey: 'cshr_pub_…',
  appUserId: user?.id,   // optional: omit for the last identified user, else an anonymous id
  // baseUrl: 'https://cashier.example.com',  // self-hosted Nimbus Cloud
});
```

## Gate on entitlements

```ts
if (await Cashier.isEntitled('premium')) unlockPremium();

const info = await Cashier.getCustomerInfo();              // cached for 5 minutes
const fresh = await Cashier.getCustomerInfo({ force: true });
info.entitlements.premium?.expirationDate;                  // ISO 8601 string or null

// Every change: purchases, renewals, restores, logins, refreshes.
// The listener is called right away with the last known value, if there is one.
const remove = Cashier.addCustomerInfoUpdateListener((info) => {
  setPremium(info.entitlements.premium?.isActive === true);
});
// later: remove();
```

## Paywalls

Design a paywall in the Cashier console (Paywalls → attach it to an offering) and present it:

```ts
const result = await Cashier.presentPaywall({
  requiredEntitlement: 'premium', // optional: show nothing if they already have it; close once granted
  offeringId: 'winter_sale',      // optional: default is the current offering
  locale: 'es',                   // optional: default is the device language
});
// 'purchased' | 'restored' | 'cancelled' | 'not_presented' | 'error'

// Only when the entitlement is missing:
await Cashier.presentPaywallIfNeeded({ requiredEntitlement: 'premium' });
```

The paywall is shown full screen. On iOS it is presented from the key window's top view controller. On Android it opens in the SDK's own activity. Store prices, trials and savings are filled in natively. Purchases and restores go through Cashier.

`presentPaywall` never rejects. A paywall that cannot load or be shown resolves `'error'`, and you get the reason from `onError`:

```ts
await Cashier.presentPaywall({ onError: (e) => log(e.code, e.message) });
```

What each result means:

| result | when |
| --- | --- |
| `purchased` | a purchase Cashier accepted |
| `restored` | a restore ran. With `requiredEntitlement`, only a restore that granted it counts. |
| `cancelled` | closed without buying |
| `not_presented` | the user already had `requiredEntitlement` |
| `error` | the offering could not load, there was nothing to present from, or another paywall was open |

On iOS, an offering without a published paywall shows a plain list of its packages as a sheet the user can swipe away.

### Answers, experiments, languages

**Answers.** Buttons on Feedback / Marketing Consent screens carry an answer. It is recorded with Cashier and also passed to `onAnswer`:

```ts
await Cashier.presentPaywall({
  onAnswer: ({ screenId, question, answer }) => analytics.track('paywall_answer', { screenId, question, answer }),
});
```

**Experiments.** If the user is enrolled in a paywall A/B test, `current` is already their variant, and the experiment is reported on both levels:

```ts
const offerings = await Cashier.getOfferings();
offerings.experiment;          // { id: 7, variant: 'b' } | null
offerings.current?.experiment; // same, on the offering it chose
offerings.current?.paywallId;  // the published paywall's id
offerings.current?.hasPaywall;
```

Views, closes and answers are reported to Cashier with the variant, so the console can compare variants.

**Languages.** Paywalls translated in the console are drawn in the best match for `locale`: the exact tag first (`pt-BR`), then the same language (`pt`), then the default texts. Leave `locale` out to use the device language.

## Offerings and purchases (your own UI)

```ts
const offerings = await Cashier.getOfferings();
const pkg = offerings.current?.annual; // also monthly, sixMonth, threeMonth, twoMonth, weekly, lifetime
if (pkg) {
  pkg.product.priceString;      // "$49.99", from the store
  pkg.product.freeTrialPeriod;  // "P7D" | null
  const { customerInfo, userCancelled, isPending } = await Cashier.purchasePackage(pkg);
}

await Cashier.restorePurchases(); // "Restore purchases" button (iOS may ask for the Apple ID password)
await Cashier.syncPurchases();    // no prompt: migrate existing subscribers (Android: same as restore)
```

If the user cancels the store sheet, `purchasePackage` resolves with `userCancelled: true`. It does not throw. `isPending` means the purchase is waiting on approval or payment (Ask to Buy, SCA, cash). A customer info update follows when it clears.

## Identity

```ts
await Cashier.logIn(user.id);   // anything bought while anonymous moves to this account
await Cashier.logOut();         // back to a fresh anonymous user
await Cashier.getAppUserId();
await Cashier.isAnonymous();
```

## Errors

Every rejection is a `CashierError` with a stable `code`, the same on both platforms:

```ts
import { CashierError, CashierErrorCode } from '@codesyncr/cashier-react-native';

try {
  await Cashier.purchasePackage(pkg);
} catch (e) {
  if (e instanceof CashierError && e.code === CashierErrorCode.ReceiptInUse) { /* … */ }
  if (e instanceof CashierError && e.isTransient) { /* retry later */ }
}
```

| code | meaning |
| --- | --- |
| `not_configured` | `configure` was not called |
| `configuration_error` | unusable configuration: a secret key, a bad user id, `logOut` while anonymous |
| `invalid_argument` | an argument the call cannot use |
| `network_error` | Cashier could not be reached (transient) |
| `server_error` | Cashier refused. See `status` and `serverCode`. 5xx and 429 are transient |
| `invalid_receipt` / `receipt_in_use` / `store_not_configured` | Cashier's own reasons |
| `store_error` | the App Store or Play purchase failed. See `storeCode` (Android: `billing_<responseCode>`) |
| `store_unavailable` | Play Billing or the App Store is unavailable on this device |
| `product_already_owned` | Google Play: the user already owns it |
| `not_found` | no such offering or package |
| `paywall_in_progress` | another paywall is already on screen |
| `ui_unavailable` | no activity or view controller to present from |
| `native_module_unavailable` | the native module is not linked (see Expo) |
| `unknown` | anything else. `underlyingError` holds the original |

## Expo

The package contains native code, so **Expo Go cannot load it**. Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) (`npx expo run:ios` / `run:android`, or EAS Build). No config plugin is needed. After `expo prebuild`:

- add the `pod 'NimbusCashier', :git => …` line above to `ios/Podfile`. If you don't commit `ios/`, use a small config plugin or `expo-build-properties`' `ios.extraPods`: `[{ name: 'NimbusCashier', git: 'https://github.com/CodeSyncr/cashier-ios.git', tag: '1.1.0' }]`;
- set `ios.deploymentTarget` to at least `15.0`, and Android `minSdkVersion` to at least 24 (with `expo-build-properties`).

In Expo Go, calls reject with `native_module_unavailable`, and `presentPaywall` resolves `'error'`.

## Architecture

- `src/NativeCashier.ts` is the TurboModule spec. Codegen (`codegenConfig` in package.json) generates `RNCashierSpec` from it. On the old architecture the same module is reached through `NativeModules.RNCashier`.
- iOS: `ios/RNCashierImpl.swift` calls `NimbusCashier`, and `ios/RNCashier.mm` exports it as an `RCTEventEmitter`, which is also a TurboModule when `RCT_NEW_ARCH_ENABLED` is set.
- Android: `RNCashierModule` extends the codegen'd `NativeCashierSpec` on the new architecture (`src/newarch`) and `ReactContextBaseJavaModule` on the old one (`src/oldarch`).
- Events: `Cashier.customerInfoUpdated` and `Cashier.paywallAnswer`. The paywall answer event is tagged with the `requestId` of the `presentPaywall` call that opened it.

## Development

```sh
npm install
npm test          # jest, native module mocked
npm run typecheck # tsc --noEmit
npm run build     # lib/
```

## License

MIT
