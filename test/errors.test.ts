import { CashierError, CashierErrorCode, toCashierError } from '../src';

const native = (code: string, userInfo?: Record<string, unknown>, message = 'native says no') =>
  Object.assign(new Error(message), { code, userInfo });

describe('toCashierError', () => {
  it.each([
    ['E_NOT_CONFIGURED', undefined, CashierErrorCode.NotConfigured],
    ['E_CONFIGURATION', undefined, CashierErrorCode.Configuration],
    ['E_INVALID_ARGUMENT', undefined, CashierErrorCode.InvalidArgument],
    ['E_NETWORK', undefined, CashierErrorCode.Network],
    ['E_NOT_FOUND', undefined, CashierErrorCode.NotFound],
    ['E_PAYWALL_IN_PROGRESS', undefined, CashierErrorCode.PaywallInProgress],
    ['E_UI_UNAVAILABLE', undefined, CashierErrorCode.UiUnavailable],
    // Server errors: Cashier's own reason picks the code.
    ['E_SERVER', { status: 422, serverCode: 'invalid_receipt' }, CashierErrorCode.InvalidReceipt],
    ['E_SERVER', { status: 409, serverCode: 'receipt_in_use' }, CashierErrorCode.ReceiptInUse],
    ['E_SERVER', { status: 400, serverCode: 'store_not_configured' }, CashierErrorCode.StoreNotConfigured],
    ['E_SERVER', { status: 404, serverCode: 'not_found' }, CashierErrorCode.NotFound],
    ['E_SERVER', { status: 400, serverCode: 'invalid_app_user_id' }, CashierErrorCode.Configuration],
    ['E_SERVER', { status: 500, serverCode: 'internal' }, CashierErrorCode.Server],
    ['E_SERVER', undefined, CashierErrorCode.Server],
    // Store errors (Android sends Play's BillingResponseCode as billing_<n>).
    ['E_STORE', { storeCode: 'billing_unavailable' }, CashierErrorCode.StoreUnavailable],
    ['E_STORE', { storeCode: 'billing_3' }, CashierErrorCode.StoreUnavailable],
    ['E_STORE', { storeCode: 'billing_2' }, CashierErrorCode.StoreUnavailable],
    ['E_STORE', { storeCode: 'billing_-1' }, CashierErrorCode.StoreUnavailable],
    ['E_STORE', { storeCode: 'billing_7' }, CashierErrorCode.ProductAlreadyOwned],
    ['E_STORE', { storeCode: 'no_offer' }, CashierErrorCode.Store],
    ['E_STORE', undefined, CashierErrorCode.Store],
    ['E_SOMETHING_NEW', undefined, CashierErrorCode.Unknown],
  ])('%s %j → %s', (code, userInfo, expected) => {
    const e = toCashierError(native(code, userInfo));
    expect(e).toBeInstanceOf(CashierError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(expected);
    expect(e.nativeCode).toBe(code);
    expect(e.message).toBe('native says no');
  });

  it('keeps status, server and store codes', () => {
    const e = toCashierError(native('E_SERVER', { status: '503', serverCode: 'unavailable' }));
    expect(e).toMatchObject({ status: 503, serverCode: 'unavailable', storeCode: null });
    expect(e.underlyingError).toBeInstanceOf(Error);
  });

  it('marks network, 5xx and 429 as transient', () => {
    expect(toCashierError(native('E_NETWORK')).isTransient).toBe(true);
    expect(toCashierError(native('E_SERVER', { status: 502 })).isTransient).toBe(true);
    expect(toCashierError(native('E_SERVER', { status: 429, serverCode: 'rate_limited' })).isTransient).toBe(true);
    expect(toCashierError(native('E_SERVER', { status: 400 })).isTransient).toBe(false);
    expect(toCashierError(native('E_STORE')).isTransient).toBe(false);
  });

  it('passes a CashierError through untouched', () => {
    const e = new CashierError(CashierErrorCode.NotFound, 'x');
    expect(toCashierError(e)).toBe(e);
  });

  it('handles strings, nulls and plain errors', () => {
    expect(toCashierError('boom')).toMatchObject({ code: 'unknown', message: 'boom' });
    expect(toCashierError(null)).toMatchObject({ code: 'unknown', message: 'Unknown Cashier error' });
    expect(toCashierError(new TypeError('bad'))).toMatchObject({ code: 'unknown', message: 'bad', nativeCode: null });
  });
});
