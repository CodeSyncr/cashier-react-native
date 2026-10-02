// Shapes the untyped objects the native modules resolve with into this
// package's types. Defensive on purpose: a missing field gets a default, never
// a crash, so an older or newer native SDK degrades gracefully.
import type {
  CashierProduct,
  CustomerInfo,
  EntitlementInfo,
  Offering,
  Offerings,
  Package,
  PackageType,
  PaywallAnswer,
  PaywallExperiment,
  PeriodType,
  Product,
  PurchaseResult,
} from './types';

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const s = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const sn = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const n = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const b = (v: unknown): boolean => v === true;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const PERIOD_TYPES: PeriodType[] = ['trial', 'intro', 'normal', 'promotional', 'grace', 'unknown'];

export function toEntitlementInfo(raw: unknown, key = ''): EntitlementInfo {
  const r = obj(raw);
  const pt = s(r.periodType, 'normal') as PeriodType;
  const periodType = PERIOD_TYPES.includes(pt) ? pt : 'unknown';
  return {
    identifier: s(r.identifier, key),
    isActive: b(r.isActive),
    willRenew: b(r.willRenew),
    periodType,
    productIdentifier: sn(r.productIdentifier),
    source: sn(r.source),
    expirationDate: sn(r.expirationDate),
    isInGracePeriod: periodType === 'grace',
  };
}

export function toCustomerInfo(raw: unknown): CustomerInfo {
  const r = obj(raw);
  const entitlements: Record<string, EntitlementInfo> = {};
  for (const [k, v] of Object.entries(obj(r.entitlements))) entitlements[k] = toEntitlementInfo(v, k);
  return {
    appUserId: s(r.appUserId),
    requestDate: sn(r.requestDate),
    entitlements,
    activeEntitlementIds: strings(r.activeEntitlementIds),
    activeProductIds: strings(r.activeProductIds),
    latestExpirationDate: sn(r.latestExpirationDate),
  };
}

export function toCustomerInfoOrNull(raw: unknown): CustomerInfo | null {
  return raw && typeof raw === 'object' ? toCustomerInfo(raw) : null;
}

/** Whether `info` has `entitlementId` active now. */
export function hasEntitlement(info: CustomerInfo | null | undefined, entitlementId: string): boolean {
  return info?.entitlements[entitlementId]?.isActive === true;
}

function toCashierProduct(raw: unknown): CashierProduct {
  const r = obj(raw);
  const identifier = s(r.identifier);
  return {
    identifier,
    name: s(r.name, identifier),
    amount: n(r.amount),
    currency: s(r.currency),
    periodMonths: n(r.periodMonths),
    trialDays: n(r.trialDays),
    entitlements: strings(r.entitlements),
    appleProductId: sn(r.appleProductId),
    googleProductId: sn(r.googleProductId),
  };
}

function toProduct(raw: unknown): Product {
  const r = obj(raw);
  return {
    identifier: s(r.identifier),
    title: s(r.title),
    description: s(r.description),
    price: n(r.price),
    priceString: s(r.priceString),
    currencyCode: s(r.currencyCode),
    subscriptionPeriod: sn(r.subscriptionPeriod),
    freeTrialPeriod: sn(r.freeTrialPeriod),
  };
}

const PACKAGE_TYPES: Record<string, PackageType> = {
  $monthly: 'monthly',
  $annual: 'annual',
  $six_month: 'six_month',
  $three_month: 'three_month',
  $two_month: 'two_month',
  $weekly: 'weekly',
  $lifetime: 'lifetime',
};

export function packageTypeOf(identifier: string): PackageType {
  return PACKAGE_TYPES[identifier] ?? 'custom';
}

function toPackage(raw: unknown, offeringIdentifier: string): Package {
  const r = obj(raw);
  const identifier = s(r.identifier);
  return {
    identifier,
    offeringIdentifier: s(r.offeringIdentifier, offeringIdentifier),
    packageType: packageTypeOf(identifier),
    product: toProduct(r.product),
    cashierProduct: toCashierProduct(r.cashierProduct),
  };
}

export function toExperiment(raw: unknown): PaywallExperiment | null {
  const r = obj(raw);
  if (typeof r.id !== 'number') return null;
  return { id: r.id, variant: s(r.variant) };
}

export function toOffering(raw: unknown, key = ''): Offering {
  const r = obj(raw);
  const identifier = s(r.identifier, key);
  const availablePackages = (Array.isArray(r.availablePackages) ? r.availablePackages : []).map((p) =>
    toPackage(p, identifier),
  );
  const find = (id: string) => availablePackages.find((p) => p.identifier === id) ?? null;
  const paywallId = typeof r.paywallId === 'number' ? r.paywallId : null;
  return {
    identifier,
    serverDescription: s(r.serverDescription),
    availablePackages,
    hasPaywall: b(r.hasPaywall),
    paywallId,
    appName: s(r.appName),
    experiment: toExperiment(r.experiment),
    monthly: find('$monthly'),
    annual: find('$annual'),
    sixMonth: find('$six_month'),
    threeMonth: find('$three_month'),
    twoMonth: find('$two_month'),
    weekly: find('$weekly'),
    lifetime: find('$lifetime'),
  };
}

export function toOfferings(raw: unknown): Offerings {
  const r = obj(raw);
  const all: Record<string, Offering> = {};
  for (const [k, v] of Object.entries(obj(r.all))) all[k] = toOffering(v, k);
  // Native sends the current offering's identifier; the object is the one in `all`.
  const currentId = sn(r.current);
  return {
    current: currentId ? all[currentId] ?? null : null,
    all,
    experiment: toExperiment(r.experiment),
  };
}

export function toPurchaseResult(raw: unknown): PurchaseResult {
  const r = obj(raw);
  return {
    customerInfo: toCustomerInfoOrNull(r.customerInfo),
    userCancelled: b(r.userCancelled),
    isPending: b(r.isPending),
    productIdentifier: sn(r.productIdentifier),
    transactionId: sn(r.transactionId),
  };
}

export function toPaywallAnswer(raw: unknown): PaywallAnswer {
  const r = obj(raw);
  return { screenId: s(r.screenId), question: s(r.question), answer: s(r.answer) };
}
