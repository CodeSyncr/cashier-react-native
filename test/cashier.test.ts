import { Cashier, CashierError, CashierErrorCode, CashierEvents, hasEntitlement } from '../src';
import { __resetForTests } from '../src/Cashier';
import { constructed, emit, listenerCount, nativeModule as m, resetMock } from './react-native-mock';
import { rawCustomerInfo, rawFreeCustomerInfo, rawOfferings } from './fixtures';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function nativeError(code: string, message: string, userInfo?: Record<string, unknown>) {
  return Object.assign(new Error(message), { code, userInfo });
}

beforeEach(() => {
  resetMock();
  __resetForTests();
});

describe('configure', () => {
  it('passes the key, user id and base URL through', async () => {
    m.configure.mockResolvedValue(undefined);
    await Cashier.configure({ apiKey: ' cshr_pub_abc ', appUserId: ' user_42 ', baseUrl: 'https://cashier.example.com' });
    expect(m.configure).toHaveBeenCalledWith('cshr_pub_abc', 'user_42', 'https://cashier.example.com');
  });

  it('sends null for a missing or blank user id and base URL', async () => {
    m.configure.mockResolvedValue(undefined);
    await Cashier.configure({ apiKey: 'cshr_pub_abc' });
    await Cashier.configure({ apiKey: 'cshr_pub_abc', appUserId: '   ' });
    expect(m.configure).toHaveBeenNthCalledWith(1, 'cshr_pub_abc', null, null);
    expect(m.configure).toHaveBeenNthCalledWith(2, 'cshr_pub_abc', null, null);
  });

  it('refuses the secret key and an empty key without calling native', async () => {
    await expect(Cashier.configure({ apiKey: 'cshr_live_secret' })).rejects.toMatchObject({
      code: CashierErrorCode.Configuration,
    });
    await expect(Cashier.configure({ apiKey: '' })).rejects.toBeInstanceOf(CashierError);
    expect(m.configure).not.toHaveBeenCalled();
  });
});

describe('customer info', () => {
  it('shapes the native object', async () => {
    m.getCustomerInfo.mockResolvedValue(rawCustomerInfo);
    const info = await Cashier.getCustomerInfo();
    expect(m.getCustomerInfo).toHaveBeenCalledWith(false);
    expect(info.appUserId).toBe('user_42');
    expect(info.activeEntitlementIds).toEqual(['premium']);
    expect(info.entitlements.premium).toEqual({
      identifier: 'premium',
      isActive: true,
      willRenew: true,
      periodType: 'trial',
      productIdentifier: 'pro_annual',
      source: 'purchase',
      expirationDate: '2026-10-05T10:00:00.000Z',
      isInGracePeriod: false,
    });
    expect(info.entitlements.legacy.isInGracePeriod).toBe(true);
    expect(info.entitlements.legacy.expirationDate).toBeNull();
  });

  it('forces a refetch', async () => {
    m.getCustomerInfo.mockResolvedValue(rawCustomerInfo);
    await Cashier.getCustomerInfo({ force: true });
    expect(m.getCustomerInfo).toHaveBeenCalledWith(true);
  });

  it('fills defaults for missing fields and unknown period types', async () => {
    m.getCustomerInfo.mockResolvedValue({ appUserId: 'u', entitlements: { x: { isActive: true, periodType: 'weird' } } });
    const info = await Cashier.getCustomerInfo();
    expect(info.activeProductIds).toEqual([]);
    expect(info.latestExpirationDate).toBeNull();
    expect(info.entitlements.x).toMatchObject({ identifier: 'x', isActive: true, periodType: 'unknown', willRenew: false });
  });

  it('isEntitled checks the active entitlement', async () => {
    m.getCustomerInfo.mockResolvedValue(rawCustomerInfo);
    await expect(Cashier.isEntitled('premium')).resolves.toBe(true);
    await expect(Cashier.isEntitled('legacy')).resolves.toBe(false);
    await expect(Cashier.isEntitled('nope')).resolves.toBe(false);
    await expect(Cashier.isEntitled('')).rejects.toMatchObject({ code: CashierErrorCode.InvalidArgument });
    expect(hasEntitlement(null, 'premium')).toBe(false);
  });

  it('identity calls resolve customer info', async () => {
    m.getAppUserId.mockResolvedValue('user_42');
    m.isAnonymous.mockResolvedValue(false);
    m.logIn.mockResolvedValue(rawCustomerInfo);
    m.logOut.mockResolvedValue({ ...rawFreeCustomerInfo, appUserId: '$cashier_anon_1' });
    await expect(Cashier.getAppUserId()).resolves.toBe('user_42');
    await expect(Cashier.isAnonymous()).resolves.toBe(false);
    await expect(Cashier.logIn('  user_42 ')).resolves.toMatchObject({ appUserId: 'user_42' });
    expect(m.logIn).toHaveBeenCalledWith('user_42');
    await expect(Cashier.logOut()).resolves.toMatchObject({ appUserId: '$cashier_anon_1' });
  });

  it('logIn refuses an empty id', async () => {
    await expect(Cashier.logIn('  ')).rejects.toMatchObject({ code: CashierErrorCode.InvalidArgument });
    expect(m.logIn).not.toHaveBeenCalled();
  });

  it('restore and sync resolve customer info', async () => {
    m.restorePurchases.mockResolvedValue(rawCustomerInfo);
    m.syncPurchases.mockResolvedValue(rawFreeCustomerInfo);
    await expect(Cashier.restorePurchases()).resolves.toMatchObject({ activeEntitlementIds: ['premium'] });
    await expect(Cashier.syncPurchases()).resolves.toMatchObject({ activeEntitlementIds: [] });
  });
});

describe('offerings', () => {
  it('links current to the offering in all, with experiment and paywall id', async () => {
    m.getOfferings.mockResolvedValue(rawOfferings);
    const o = await Cashier.getOfferings();
    expect(o.current).toBe(o.all.default);
    expect(o.experiment).toEqual({ id: 7, variant: 'b' });
    expect(o.current?.experiment).toEqual({ id: 7, variant: 'b' });
    expect(o.current?.paywallId).toBe(12);
    expect(o.current?.hasPaywall).toBe(true);
    expect(o.all.lite).toMatchObject({ hasPaywall: false, paywallId: null, experiment: null });
  });

  it('types packages and exposes the shortcuts', async () => {
    m.getOfferings.mockResolvedValue(rawOfferings);
    const current = (await Cashier.getOfferings()).current!;
    expect(current.annual?.packageType).toBe('annual');
    expect(current.annual?.product).toMatchObject({ priceString: '$49.99', price: 49.99, subscriptionPeriod: 'P1Y', freeTrialPeriod: 'P7D' });
    expect(current.annual?.cashierProduct).toMatchObject({ periodMonths: 12, entitlements: ['premium'] });
    expect(current.monthly).toBeNull();
    expect(current.availablePackages[1]).toMatchObject({ identifier: 'founders', packageType: 'custom' });
    expect(current.availablePackages[1].product.subscriptionPeriod).toBeNull();
  });

  it('handles no current offering', async () => {
    m.getOfferings.mockResolvedValue({ current: null, all: {}, experiment: null });
    await expect(Cashier.getOfferings()).resolves.toEqual({ current: null, all: {}, experiment: null });
  });
});

describe('purchasePackage', () => {
  it('sends the offering and package ids and shapes the result', async () => {
    m.getOfferings.mockResolvedValue(rawOfferings);
    m.purchasePackage.mockResolvedValue({
      customerInfo: rawCustomerInfo,
      userCancelled: false,
      isPending: false,
      productIdentifier: 'com.example.pro.annual',
      transactionId: '2000000123',
    });
    const pkg = (await Cashier.getOfferings()).current!.annual!;
    const result = await Cashier.purchasePackage(pkg);
    expect(m.purchasePackage).toHaveBeenCalledWith('default', '$annual');
    expect(result).toMatchObject({ userCancelled: false, isPending: false, transactionId: '2000000123' });
    expect(result.customerInfo?.activeEntitlementIds).toEqual(['premium']);
  });

  it('resolves a cancelled sheet, not an error', async () => {
    m.purchasePackage.mockResolvedValue({ customerInfo: null, userCancelled: true, isPending: false });
    const result = await Cashier.purchasePackage({ identifier: '$annual', offeringIdentifier: 'default' });
    expect(result).toEqual({ customerInfo: null, userCancelled: true, isPending: false, productIdentifier: null, transactionId: null });
  });

  it('refuses something that is not a package', async () => {
    await expect(Cashier.purchasePackage({} as never)).rejects.toMatchObject({ code: CashierErrorCode.InvalidArgument });
    expect(m.purchasePackage).not.toHaveBeenCalled();
  });

  it('rejects with a mapped CashierError', async () => {
    m.purchasePackage.mockRejectedValue(nativeError('E_SERVER', 'Cashier 409 receipt_in_use: taken', { status: 409, serverCode: 'receipt_in_use' }));
    const err = await Cashier.purchasePackage({ identifier: '$annual', offeringIdentifier: 'default' }).catch((e) => e);
    expect(err).toBeInstanceOf(CashierError);
    expect(err).toMatchObject({ code: 'receipt_in_use', status: 409, serverCode: 'receipt_in_use', nativeCode: 'E_SERVER' });
    expect(err.isTransient).toBe(false);
  });
});

describe('customer info listeners', () => {
  it('subscribes once natively, delivers updates, and unsubscribes with the last listener', async () => {
    const a = jest.fn();
    const b = jest.fn();
    const removeA = Cashier.addCustomerInfoUpdateListener(a);
    const removeB = Cashier.addCustomerInfoUpdateListener(b);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].module).toBe(m);
    expect(listenerCount(CashierEvents.CustomerInfoUpdated)).toBe(1);

    emit(CashierEvents.CustomerInfoUpdated, rawCustomerInfo);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ appUserId: 'user_42', activeEntitlementIds: ['premium'] }));
    expect(b).toHaveBeenCalledTimes(1);

    removeA();
    removeA(); // idempotent
    emit(CashierEvents.CustomerInfoUpdated, rawFreeCustomerInfo);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    removeB();
    expect(listenerCount(CashierEvents.CustomerInfoUpdated)).toBe(0);
  });

  it('replays the last known customer info to a new listener', async () => {
    m.getCustomerInfo.mockResolvedValue(rawCustomerInfo);
    await Cashier.getCustomerInfo();
    const fn = jest.fn();
    Cashier.addCustomerInfoUpdateListener(fn);
    expect(fn).not.toHaveBeenCalled(); // asynchronously, like an event
    await flush();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ appUserId: 'user_42' }));
  });

  it('does not replay to a listener removed before delivery', async () => {
    m.getCustomerInfo.mockResolvedValue(rawCustomerInfo);
    await Cashier.getCustomerInfo();
    const fn = jest.fn();
    Cashier.addCustomerInfoUpdateListener(fn)();
    await flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps delivering when one listener throws', () => {
    jest.useFakeTimers();
    try {
      const good = jest.fn();
      Cashier.addCustomerInfoUpdateListener(() => {
        throw new Error('boom');
      });
      Cashier.addCustomerInfoUpdateListener(good);
      emit(CashierEvents.CustomerInfoUpdated, rawCustomerInfo);
      expect(good).toHaveBeenCalledTimes(1);
      expect(() => jest.runAllTimers()).toThrow('boom');
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses a non-function', () => {
    expect(() => Cashier.addCustomerInfoUpdateListener(null as never)).toThrow(CashierError);
  });
});

describe('presentPaywall', () => {
  it.each(['purchased', 'restored', 'cancelled', 'not_presented'] as const)('resolves %s', async (result) => {
    m.presentPaywall.mockResolvedValue({ result });
    await expect(Cashier.presentPaywall()).resolves.toBe(result);
  });

  it('passes the options through, with a request id', async () => {
    m.presentPaywall.mockResolvedValue({ result: 'cancelled' });
    await Cashier.presentPaywall({ requiredEntitlement: 'premium', offeringId: 'lite', locale: 'pt-BR' });
    expect(m.presentPaywall).toHaveBeenCalledWith(expect.stringMatching(/^pw_/), 'premium', 'lite', 'pt-BR');
    await Cashier.presentPaywall();
    expect(m.presentPaywall).toHaveBeenLastCalledWith(expect.stringMatching(/^pw_/), null, null, null);
    expect(m.presentPaywall.mock.calls[0][0]).not.toBe(m.presentPaywall.mock.calls[1][0]);
  });

  it('takes an offering object', async () => {
    m.getOfferings.mockResolvedValue(rawOfferings);
    m.presentPaywall.mockResolvedValue({ result: 'cancelled' });
    const offering = (await Cashier.getOfferings()).all.lite;
    await Cashier.presentPaywall({ offering, offeringId: 'ignored' });
    expect(m.presentPaywall).toHaveBeenCalledWith(expect.any(String), null, 'lite', null);
  });

  it('maps an unknown result to cancelled', async () => {
    m.presentPaywall.mockResolvedValue({ result: 'something_new' });
    await expect(Cashier.presentPaywall()).resolves.toBe('cancelled');
  });

  it('delivers answers for its own request only, then stops listening', async () => {
    const onAnswer = jest.fn();
    let finish!: (v: unknown) => void;
    m.presentPaywall.mockImplementation(() => new Promise((r) => (finish = r)));
    const done = Cashier.presentPaywall({ onAnswer });
    await flush();
    const requestId = m.presentPaywall.mock.calls[0][0];
    expect(listenerCount(CashierEvents.PaywallAnswer)).toBe(1);

    emit(CashierEvents.PaywallAnswer, { requestId, screenId: 's_feedback', question: 'Why are you leaving?', answer: 'Too expensive' });
    emit(CashierEvents.PaywallAnswer, { requestId: 'someone_else', screenId: 'x', question: 'q', answer: 'a' });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ screenId: 's_feedback', question: 'Why are you leaving?', answer: 'Too expensive' });

    finish({ result: 'cancelled' });
    await expect(done).resolves.toBe('cancelled');
    expect(listenerCount(CashierEvents.PaywallAnswer)).toBe(0);
  });

  it('does not listen for answers without onAnswer', async () => {
    m.presentPaywall.mockResolvedValue({ result: 'cancelled' });
    await Cashier.presentPaywall();
    expect(constructed).toHaveLength(0);
  });

  it('resolves error with a mapped CashierError for a native error result', async () => {
    const onError = jest.fn();
    m.presentPaywall.mockResolvedValue({ result: 'error', error: { code: 'E_NETWORK', message: 'offline' } });
    await expect(Cashier.presentPaywall({ onError })).resolves.toBe('error');
    expect(onError.mock.calls[0][0]).toMatchObject({ code: CashierErrorCode.Network, message: 'offline' });
    expect(onError.mock.calls[0][0].isTransient).toBe(true);
  });

  it('resolves error (never rejects) when native rejects, and removes the answer listener', async () => {
    const onError = jest.fn();
    m.presentPaywall.mockRejectedValue(nativeError('E_PAYWALL_IN_PROGRESS', 'A paywall is already presented'));
    await expect(Cashier.presentPaywall({ onError, onAnswer: jest.fn() })).resolves.toBe('error');
    expect(onError.mock.calls[0][0].code).toBe(CashierErrorCode.PaywallInProgress);
    expect(listenerCount(CashierEvents.PaywallAnswer)).toBe(0);
  });

  it('survives an onError that throws', async () => {
    m.presentPaywall.mockRejectedValue(nativeError('E_UI_UNAVAILABLE', 'no activity'));
    await expect(
      Cashier.presentPaywall({
        onError: () => {
          throw new Error('handler');
        },
      }),
    ).resolves.toBe('error');
  });

  it('remembers customer info the paywall resolved with', async () => {
    m.presentPaywall.mockResolvedValue({ result: 'purchased', customerInfo: rawCustomerInfo });
    await Cashier.presentPaywall();
    const fn = jest.fn();
    Cashier.addCustomerInfoUpdateListener(fn);
    await flush();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ activeEntitlementIds: ['premium'] }));
  });

  it('presentPaywallIfNeeded requires the entitlement and forwards it', async () => {
    m.presentPaywall.mockResolvedValue({ result: 'not_presented' });
    await expect(Cashier.presentPaywallIfNeeded({ requiredEntitlement: 'premium', locale: 'es' })).resolves.toBe('not_presented');
    expect(m.presentPaywall).toHaveBeenCalledWith(expect.any(String), 'premium', null, 'es');
    await expect(Cashier.presentPaywallIfNeeded({} as never)).rejects.toMatchObject({ code: CashierErrorCode.InvalidArgument });
  });
});

describe('missing native module', () => {
  it('rejects every call with native_module_unavailable', async () => {
    await jest.isolateModulesAsync(async () => {
      const rn = await import('./react-native-mock');
      delete rn.NativeModules.RNCashier;
      const { Cashier: C, CashierErrorCode: Codes } = await import('../src');
      await expect(C.getCustomerInfo()).rejects.toMatchObject({ code: Codes.NativeModuleUnavailable });
      await expect(C.configure({ apiKey: 'cshr_pub_x' })).rejects.toMatchObject({ code: Codes.NativeModuleUnavailable });
      await expect(C.presentPaywall()).resolves.toBe('error');
    });
  });
});
