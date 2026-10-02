/**
 * Stable error codes. Native errors from the iOS and Android SDKs are mapped
 * onto these, so app code can branch on `error.code` on both platforms.
 */
export const CashierErrorCode = {
  /** `Cashier.configure` has not been called. */
  NotConfigured: 'not_configured',
  /** The configuration is unusable (secret key in the app, bad user id, logOut while anonymous). */
  Configuration: 'configuration_error',
  /** A method was called with an argument it cannot use. */
  InvalidArgument: 'invalid_argument',
  /** Cashier could not be reached. Transient. */
  Network: 'network_error',
  /** Cashier refused the request for a reason without its own code; see `serverCode`. */
  Server: 'server_error',
  /** The store's receipt / purchase token did not verify. */
  InvalidReceipt: 'invalid_receipt',
  /** The receipt already belongs to another app user. */
  ReceiptInUse: 'receipt_in_use',
  /** The Cashier app has no App Store / Google Play credentials set up. */
  StoreNotConfigured: 'store_not_configured',
  /** The store purchase or product lookup failed; see `storeCode`. */
  Store: 'store_error',
  /** The store (Play Billing / App Store) is unavailable on this device. */
  StoreUnavailable: 'store_unavailable',
  /** Google Play: the user already owns this item. */
  ProductAlreadyOwned: 'product_already_owned',
  /** An offering, package or paywall that does not exist. */
  NotFound: 'not_found',
  /** Another paywall is already on screen. */
  PaywallInProgress: 'paywall_in_progress',
  /** No activity / view controller to present from. */
  UiUnavailable: 'ui_unavailable',
  /** The native module is not linked (Expo Go, missing pod install, not rebuilt). */
  NativeModuleUnavailable: 'native_module_unavailable',
  Unknown: 'unknown',
} as const;

export type CashierErrorCode = (typeof CashierErrorCode)[keyof typeof CashierErrorCode];

export interface CashierErrorDetails {
  /** HTTP status from Cashier, when the server answered. */
  status?: number | null;
  /** Cashier's machine-readable reason ("invalid_receipt", "rate_limited", …). */
  serverCode?: string | null;
  /** The store's code (Android: "billing_<responseCode>", "no_offer"). */
  storeCode?: string | null;
  /** The native reject code ("E_SERVER", …). */
  nativeCode?: string | null;
  cause?: unknown;
}

export class CashierError extends Error {
  readonly code: CashierErrorCode;
  readonly status: number | null;
  readonly serverCode: string | null;
  readonly storeCode: string | null;
  readonly nativeCode: string | null;
  /** What the native module rejected with. */
  readonly underlyingError?: unknown;

  constructor(code: CashierErrorCode, message: string, details: CashierErrorDetails = {}) {
    super(message);
    this.name = 'CashierError';
    this.code = code;
    this.status = details.status ?? null;
    this.serverCode = details.serverCode ?? null;
    this.storeCode = details.storeCode ?? null;
    this.nativeCode = details.nativeCode ?? null;
    if (details.cause !== undefined) this.underlyingError = details.cause;
    // Keeps `instanceof` working when compiled to ES5 targets.
    Object.setPrototypeOf(this, CashierError.prototype);
  }

  /** True when retrying later may succeed. */
  get isTransient(): boolean {
    if (this.code === CashierErrorCode.Network) return true;
    const s = this.status ?? 0;
    return s >= 500 || s === 429;
  }
}

/** Server codes that get a code of their own. */
const SERVER_CODES: Record<string, CashierErrorCode> = {
  invalid_receipt: CashierErrorCode.InvalidReceipt,
  receipt_in_use: CashierErrorCode.ReceiptInUse,
  store_not_configured: CashierErrorCode.StoreNotConfigured,
  not_found: CashierErrorCode.NotFound,
  invalid_app_user_id: CashierErrorCode.Configuration,
};

/** Google Play BillingResponseCodes that mean "the store is not available". */
const UNAVAILABLE_STORE_CODES = new Set(['billing_unavailable', 'billing_-1', 'billing_2', 'billing_3']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Maps anything a native call rejected with (or a thrown value) to a
 * CashierError. Native modules reject with `code` = "E_…" and `userInfo` =
 * `{ status?, serverCode?, storeCode? }`.
 */
export function toCashierError(e: unknown): CashierError {
  if (e instanceof CashierError) return e;
  const err = (e ?? {}) as { code?: unknown; message?: unknown; userInfo?: unknown };
  const nativeCode = str(err.code);
  const info = (err.userInfo && typeof err.userInfo === 'object' ? err.userInfo : {}) as Record<string, unknown>;
  const status = num(info.status);
  const serverCode = str(info.serverCode);
  const storeCode = str(info.storeCode);
  const message = str(err.message) ?? (typeof e === 'string' ? e : 'Unknown Cashier error');
  const details: CashierErrorDetails = { status, serverCode, storeCode, nativeCode, cause: e };

  let code: CashierErrorCode;
  switch (nativeCode) {
    case 'E_NOT_CONFIGURED':
      code = CashierErrorCode.NotConfigured;
      break;
    case 'E_CONFIGURATION':
      code = CashierErrorCode.Configuration;
      break;
    case 'E_INVALID_ARGUMENT':
      code = CashierErrorCode.InvalidArgument;
      break;
    case 'E_NETWORK':
      code = CashierErrorCode.Network;
      break;
    case 'E_SERVER':
      code = (serverCode && SERVER_CODES[serverCode]) || CashierErrorCode.Server;
      break;
    case 'E_STORE':
      if (storeCode && UNAVAILABLE_STORE_CODES.has(storeCode)) code = CashierErrorCode.StoreUnavailable;
      else if (storeCode === 'billing_7') code = CashierErrorCode.ProductAlreadyOwned;
      else code = CashierErrorCode.Store;
      break;
    case 'E_NOT_FOUND':
      code = CashierErrorCode.NotFound;
      break;
    case 'E_PAYWALL_IN_PROGRESS':
      code = CashierErrorCode.PaywallInProgress;
      break;
    case 'E_UI_UNAVAILABLE':
      code = CashierErrorCode.UiUnavailable;
      break;
    default:
      code = CashierErrorCode.Unknown;
  }
  return new CashierError(code, message, details);
}
