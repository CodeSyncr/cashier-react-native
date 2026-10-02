import { NativeEventEmitter, NativeModules } from 'react-native';
import type { EmitterSubscription } from 'react-native';
import NativeCashier from './NativeCashier';
import type { Spec } from './NativeCashier';
import { CashierError, CashierErrorCode, toCashierError } from './errors';
import {
  hasEntitlement,
  toCustomerInfo,
  toCustomerInfoOrNull,
  toOfferings,
  toPaywallAnswer,
  toPurchaseResult,
} from './marshal';
import type {
  ConfigureOptions,
  CustomerInfo,
  CustomerInfoUpdateListener,
  Offerings,
  Package,
  PaywallResult,
  PresentPaywallOptions,
  PurchaseResult,
} from './types';

/** Event names the native modules emit. */
export const CashierEvents = {
  CustomerInfoUpdated: 'Cashier.customerInfoUpdated',
  PaywallAnswer: 'Cashier.paywallAnswer',
} as const;

const PAYWALL_RESULTS: PaywallResult[] = ['purchased', 'restored', 'cancelled', 'not_presented', 'error'];

const LINKING_ERROR =
  "@codesyncr/cashier-react-native: the native module is not linked. Run 'pod install' in ios/, rebuild the app, " +
  'and on Expo use a development build (Expo Go cannot load it).';

function native(): Spec {
  const mod = (NativeCashier ?? NativeModules.RNCashier) as Spec | null | undefined;
  if (!mod) throw new CashierError(CashierErrorCode.NativeModuleUnavailable, LINKING_ERROR);
  return mod;
}

let emitter: NativeEventEmitter | null = null;
function events(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter(native());
  return emitter;
}

/** Calls the native module, mapping any rejection to a CashierError. */
async function call<T>(fn: (m: Spec) => Promise<T>): Promise<T> {
  let m: Spec;
  try {
    m = native();
  } catch (e) {
    throw toCashierError(e);
  }
  try {
    return await fn(m);
  } catch (e) {
    throw toCashierError(e);
  }
}

function invalid(message: string): CashierError {
  return new CashierError(CashierErrorCode.InvalidArgument, message);
}

// ── Customer info listeners ────────────────────────────────

const listeners = new Set<CustomerInfoUpdateListener>();
let nativeSubscription: EmitterSubscription | null = null;
let lastCustomerInfo: CustomerInfo | null = null;

function remember(info: CustomerInfo | null): void {
  if (info) lastCustomerInfo = info;
}

function onNativeCustomerInfo(raw: unknown): void {
  const info = toCustomerInfo(raw);
  remember(info);
  for (const fn of Array.from(listeners)) {
    try {
      fn(info);
    } catch (e) {
      // One listener throwing must not starve the others.
      setTimeout(() => {
        throw e;
      }, 0);
    }
  }
}

let paywallSeq = 0;

/**
 * Nimbus Cashier for React Native: purchases through StoreKit 2 / Google Play
 * Billing, verified by your Cashier app, gated on entitlements. A thin bridge
 * over the native NimbusCashier (iOS) and com.nimbus.cashier (Android) SDKs.
 *
 * ```ts
 * await Cashier.configure({ apiKey: 'cshr_pub_…' });
 * if (!(await Cashier.isEntitled('premium'))) {
 *   const result = await Cashier.presentPaywall({ requiredEntitlement: 'premium' });
 * }
 * ```
 */
export const Cashier = {
  /**
   * Configures the SDK once, early in app launch. Calling it again replaces
   * the configuration (a different key or user).
   */
  async configure(options: ConfigureOptions): Promise<void> {
    const apiKey = typeof options?.apiKey === 'string' ? options.apiKey.trim() : '';
    if (!apiKey) throw new CashierError(CashierErrorCode.Configuration, 'Cashier.configure needs your public apiKey');
    // The iOS SDK stops the app (precondition) on a secret key; refuse it here.
    if (apiKey.startsWith('cshr_live_')) {
      throw new CashierError(
        CashierErrorCode.Configuration,
        'That is your SECRET key. Use the public key (cshr_pub_…) in an app.',
      );
    }
    const appUserId = typeof options.appUserId === 'string' && options.appUserId.trim() ? options.appUserId.trim() : null;
    lastCustomerInfo = null;
    await call((m) => m.configure(apiKey, appUserId, options.baseUrl ?? null));
  },

  /** The app user id purchases and reads are attributed to. */
  getAppUserId(): Promise<string> {
    return call((m) => m.getAppUserId());
  },

  /** Whether the current user is an anonymous one the SDK generated. */
  isAnonymous(): Promise<boolean> {
    return call((m) => m.isAnonymous());
  },

  /** What the current user holds; cached for 5 minutes unless `force`. */
  async getCustomerInfo(options: { force?: boolean } = {}): Promise<CustomerInfo> {
    const info = toCustomerInfo(await call((m) => m.getCustomerInfo(options.force === true)));
    remember(info);
    return info;
  },

  /** Whether an entitlement grants access now (uses the cached customer info when fresh). */
  async isEntitled(entitlementId: string): Promise<boolean> {
    if (typeof entitlementId !== 'string' || !entitlementId) throw invalid('isEntitled needs an entitlement id');
    return hasEntitlement(await Cashier.getCustomerInfo(), entitlementId);
  },

  /**
   * The console's offerings with store products attached. `current` is the
   * offering to show now — the experiment's variant when the user is in one.
   */
  async getOfferings(): Promise<Offerings> {
    return toOfferings(await call((m) => m.getOfferings()));
  },

  /** Buys a package from `getOfferings()`. A cancelled store sheet resolves with `userCancelled: true`. */
  async purchasePackage(pkg: Pick<Package, 'identifier' | 'offeringIdentifier'>): Promise<PurchaseResult> {
    if (!pkg || typeof pkg.identifier !== 'string' || !pkg.identifier || typeof pkg.offeringIdentifier !== 'string' || !pkg.offeringIdentifier) {
      throw invalid('purchasePackage needs a package from getOfferings()');
    }
    const result = toPurchaseResult(await call((m) => m.purchasePackage(pkg.offeringIdentifier, pkg.identifier)));
    remember(result.customerInfo);
    return result;
  },

  /**
   * Restores purchases. On iOS this syncs with the App Store and may ask the
   * user to sign in — call it from a "Restore purchases" button only.
   */
  async restorePurchases(): Promise<CustomerInfo> {
    const info = toCustomerInfo(await call((m) => m.restorePurchases()));
    remember(info);
    return info;
  },

  /**
   * Sends purchases the store already knows about to Cashier without any
   * prompt — for migrating existing subscribers. (Android has no prompt
   * either way; it is the same as restorePurchases there.)
   */
  async syncPurchases(): Promise<CustomerInfo> {
    const info = toCustomerInfo(await call((m) => m.syncPurchases()));
    remember(info);
    return info;
  },

  /** Identifies the user as `appUserId`. Anything bought while anonymous moves to that account. */
  async logIn(appUserId: string): Promise<CustomerInfo> {
    const id = typeof appUserId === 'string' ? appUserId.trim() : '';
    if (!id) throw invalid('logIn needs your own, non-empty user id');
    const info = toCustomerInfo(await call((m) => m.logIn(id)));
    remember(info);
    return info;
  },

  /** Signs out: the device becomes a fresh anonymous subscriber. */
  async logOut(): Promise<CustomerInfo> {
    lastCustomerInfo = null;
    const info = toCustomerInfo(await call((m) => m.logOut()));
    remember(info);
    return info;
  },

  /**
   * Calls `listener` with every CustomerInfo the SDK learns about (purchases,
   * renewals, restores, logins, refreshes), starting with the last known one.
   * Returns a function that removes it.
   */
  addCustomerInfoUpdateListener(listener: CustomerInfoUpdateListener): () => void {
    if (typeof listener !== 'function') throw invalid('addCustomerInfoUpdateListener needs a function');
    listeners.add(listener);
    if (!nativeSubscription) {
      nativeSubscription = events().addListener(CashierEvents.CustomerInfoUpdated, onNativeCustomerInfo);
    }
    const current = lastCustomerInfo;
    if (current) {
      Promise.resolve().then(() => {
        if (listeners.has(listener)) listener(current);
      });
    }
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      listeners.delete(listener);
      if (listeners.size === 0 && nativeSubscription) {
        nativeSubscription.remove();
        nativeSubscription = null;
      }
    };
  },

  /**
   * Presents the paywall designed in the Cashier console, full screen, drawn
   * natively (SwiftUI / Jetpack Compose) with store prices. Resolves when it
   * closes; never rejects — failures resolve "error" and call `onError`.
   *
   * - "purchased": a purchase Cashier accepted
   * - "restored": a restore ran (with `requiredEntitlement`, one that granted it)
   * - "cancelled": closed without buying
   * - "not_presented": the user already had `requiredEntitlement`
   * - "error": the paywall could not load or be shown
   */
  async presentPaywall(options: PresentPaywallOptions = {}): Promise<PaywallResult> {
    const { requiredEntitlement, locale, onAnswer, onError } = options;
    const offeringId = options.offering?.identifier ?? options.offeringId ?? null;
    const requestId = `pw_${Date.now().toString(36)}_${++paywallSeq}`;
    let answers: EmitterSubscription | null = null;
    const fail = (e: unknown): PaywallResult => {
      if (onError) {
        try {
          onError(toCashierError(e));
        } catch {
          // The caller's handler failing does not change the result.
        }
      }
      return 'error';
    };
    try {
      const m = native();
      if (onAnswer) {
        answers = events().addListener(CashierEvents.PaywallAnswer, (raw: unknown) => {
          const r = (raw ?? {}) as { requestId?: unknown };
          if (r.requestId !== requestId) return;
          onAnswer(toPaywallAnswer(raw));
        });
      }
      const raw = (await m.presentPaywall(requestId, requiredEntitlement ?? null, offeringId, locale ?? null)) as {
        result?: unknown;
        customerInfo?: unknown;
        error?: { code?: unknown; message?: unknown; userInfo?: unknown };
      } | null;
      remember(toCustomerInfoOrNull(raw?.customerInfo));
      const result = raw?.result as PaywallResult;
      if (result === 'error') return fail(raw?.error ?? { message: 'The paywall could not be shown' });
      return PAYWALL_RESULTS.includes(result) ? result : 'cancelled';
    } catch (e) {
      return fail(e);
    } finally {
      answers?.remove();
    }
  },

  /**
   * Presents the paywall only when the user lacks `requiredEntitlement`
   * (resolving "not_presented" otherwise), and closes it once a purchase or
   * restore grants it.
   */
  presentPaywallIfNeeded(
    options: PresentPaywallOptions & { requiredEntitlement: string },
  ): Promise<PaywallResult> {
    if (!options || typeof options.requiredEntitlement !== 'string' || !options.requiredEntitlement) {
      return Promise.reject(invalid('presentPaywallIfNeeded needs requiredEntitlement'));
    }
    return Cashier.presentPaywall(options);
  },
};

/** @internal Test hook: forget listeners and cached state. */
export function __resetForTests(): void {
  listeners.clear();
  nativeSubscription?.remove();
  nativeSubscription = null;
  lastCustomerInfo = null;
  emitter = null;
  paywallSeq = 0;
}
