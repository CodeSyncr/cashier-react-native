import type { CashierError } from './errors';

/** How an entitlement's current period came about. */
export type PeriodType = 'trial' | 'intro' | 'normal' | 'promotional' | 'grace' | 'unknown';

/** One entitlement's state. Dates are ISO 8601 strings. */
export interface EntitlementInfo {
  identifier: string;
  isActive: boolean;
  /** False once the subscriber turned off auto-renew; access still lasts to expiry. */
  willRenew: boolean;
  periodType: PeriodType;
  /** The Cashier product that granted it (null for a promotional grant). */
  productIdentifier: string | null;
  /** "purchase" or "promotional". */
  source: string | null;
  /** null when it never expires. */
  expirationDate: string | null;
  /** In the store's grace period after a failed renewal. */
  isInGracePeriod: boolean;
}

/** What a subscriber holds right now — the one object an app gates on. */
export interface CustomerInfo {
  /** The app user id this state belongs to (after any alias). */
  appUserId: string;
  requestDate: string | null;
  /** Every known entitlement, active or not, keyed by identifier. */
  entitlements: Record<string, EntitlementInfo>;
  /** Identifiers of the entitlements granting access now. */
  activeEntitlementIds: string[];
  /** Cashier product ids behind the active entitlements. */
  activeProductIds: string[];
  /** The furthest-out expiry across active entitlements; null when one never expires. */
  latestExpirationDate: string | null;
}

/** A product as configured in the Cashier console. */
export interface CashierProduct {
  identifier: string;
  name: string;
  /** The console price in the currency's smallest unit (the store charges its own price). */
  amount: number;
  currency: string;
  /** Billing period in months; 0 is a one-time purchase. */
  periodMonths: number;
  trialDays: number;
  entitlements: string[];
  appleProductId: string | null;
  googleProductId: string | null;
}

/** The store's product (App Store or Google Play): what to show the buyer. */
export interface Product {
  /** The store's product id. */
  identifier: string;
  /** Localized title. */
  title: string;
  description: string;
  /** Price in the currency's major unit (9.99). */
  price: number;
  /** Localized, formatted price ("$9.99"). */
  priceString: string;
  /** ISO 4217 currency code. */
  currencyCode: string;
  /** ISO 8601 billing period ("P1M", "P1Y"); null for a one-time purchase. */
  subscriptionPeriod: string | null;
  /** ISO 8601 length of a free trial the user is offered ("P7D"); null when none. */
  freeTrialPeriod: string | null;
}

export type PackageType =
  | 'monthly'
  | 'annual'
  | 'six_month'
  | 'three_month'
  | 'two_month'
  | 'weekly'
  | 'lifetime'
  | 'custom';

/** One slot of an offering: a Cashier product and the store product that sells it. */
export interface Package {
  /** "$monthly", "$annual", … or a custom id. */
  identifier: string;
  offeringIdentifier: string;
  packageType: PackageType;
  /** The store product — price and localized title come from here. */
  product: Product;
  cashierProduct: CashierProduct;
}

/** A paywall experiment (A/B test) the user is enrolled in. */
export interface PaywallExperiment {
  id: number;
  /** "a" or "b". */
  variant: string;
}

/** A named set of packages a paywall presents. */
export interface Offering {
  identifier: string;
  serverDescription: string;
  /** Packages whose product the store returned, in console order. */
  availablePackages: Package[];
  /** Whether a paywall is published for this offering (show it with `presentPaywall`). */
  hasPaywall: boolean;
  /** The published paywall's id; null when there is none. */
  paywallId: number | null;
  /** Your Cashier app's name. */
  appName: string;
  /** The experiment this offering was chosen by; set on the current offering while the user is enrolled. */
  experiment: PaywallExperiment | null;
  monthly: Package | null;
  annual: Package | null;
  sixMonth: Package | null;
  threeMonth: Package | null;
  twoMonth: Package | null;
  weekly: Package | null;
  lifetime: Package | null;
}

/** Every offering the console defines. */
export interface Offerings {
  /** The offering your paywall should show now (the experiment's variant, if enrolled). */
  current: Offering | null;
  /** Every offering, keyed by identifier. */
  all: Record<string, Offering>;
  /** The paywall experiment the user is enrolled in, if any. */
  experiment: PaywallExperiment | null;
}

/** The outcome of a purchase attempt. */
export interface PurchaseResult {
  customerInfo: CustomerInfo | null;
  /** The buyer dismissed the store sheet. Not an error. */
  userCancelled: boolean;
  /** Waiting on approval or payment (Ask to Buy, SCA, cash); a customer info update follows. */
  isPending: boolean;
  /** The store product bought. */
  productIdentifier: string | null;
  /** App Store transaction id or Google Play order id. */
  transactionId: string | null;
}

/** An answer tapped on a paywall screen (Feedback, Marketing Consent). */
export interface PaywallAnswer {
  /** The screen's id. */
  screenId: string;
  /** The screen's question, else its name. */
  question: string;
  /** The tapped button's answer, in the language shown. */
  answer: string;
}

/** How a presented paywall ended. */
export type PaywallResult = 'purchased' | 'restored' | 'cancelled' | 'not_presented' | 'error';

export interface ConfigureOptions {
  /** Your app's PUBLIC key (`cshr_pub_…`). Never ship the secret key. */
  apiKey: string;
  /** Your own user id when known; omit to use the last identified user, else an anonymous id. */
  appUserId?: string | null;
  /** Cashier's host, for a self-hosted Nimbus Cloud. */
  baseUrl?: string;
}

export interface PresentPaywallOptions {
  /** Show nothing (resolve "not_presented") if the user already has it; close once a purchase or restore grants it. */
  requiredEntitlement?: string;
  /** The offering to show; default is the current one (the experiment's variant, if enrolled). */
  offeringId?: string;
  /** Same as `offeringId`, from an offering already loaded. */
  offering?: Offering;
  /** The language to draw the paywall in ("es", "pt-BR"); default is the device's. */
  locale?: string;
  /** An answer button was tapped; the answer is also recorded with Cashier. */
  onAnswer?: (answer: PaywallAnswer) => void;
  /** Why the paywall ended with "error". */
  onError?: (error: CashierError) => void;
}

export type CustomerInfoUpdateListener = (info: CustomerInfo) => void;
