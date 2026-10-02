// The native module's contract. React Native's codegen reads this file (see
// "codegenConfig" in package.json) to generate the TurboModule spec for the
// new architecture; on the old architecture TurboModuleRegistry falls back to
// NativeModules.RNCashier. Keep it to codegen-supported types only.
//
// Objects cross the bridge untyped (`Object`) and are shaped by
// src/marshal.ts; both native modules produce the same keys.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  configure(apiKey: string, appUserId: string | null, baseUrl: string | null): Promise<void>;
  getAppUserId(): Promise<string>;
  isAnonymous(): Promise<boolean>;
  getCustomerInfo(force: boolean): Promise<Object>;
  getOfferings(): Promise<Object>;
  purchasePackage(offeringIdentifier: string, packageIdentifier: string): Promise<Object>;
  restorePurchases(): Promise<Object>;
  syncPurchases(): Promise<Object>;
  logIn(appUserId: string): Promise<Object>;
  logOut(): Promise<Object>;
  /**
   * Resolves `{ result, customerInfo?, error? }` once the paywall closes;
   * answers stream meanwhile as `Cashier.paywallAnswer` events tagged with
   * `requestId`.
   */
  presentPaywall(
    requestId: string,
    requiredEntitlement: string | null,
    offeringId: string | null,
    locale: string | null,
  ): Promise<Object>;

  // NativeEventEmitter bookkeeping.
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('RNCashier');
