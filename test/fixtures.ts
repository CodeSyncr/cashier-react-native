// What the native modules resolve with (both produce these keys).

export const rawCustomerInfo = {
  appUserId: 'user_42',
  requestDate: '2026-09-28T10:00:00.000Z',
  entitlements: {
    premium: {
      identifier: 'premium',
      isActive: true,
      willRenew: true,
      periodType: 'trial',
      productIdentifier: 'pro_annual',
      source: 'purchase',
      expirationDate: '2026-10-05T10:00:00.000Z',
    },
    legacy: {
      identifier: 'legacy',
      isActive: false,
      willRenew: false,
      periodType: 'grace',
      productIdentifier: null,
      source: 'promotional',
      expirationDate: null,
    },
  },
  activeEntitlementIds: ['premium'],
  activeProductIds: ['pro_annual'],
  latestExpirationDate: '2026-10-05T10:00:00.000Z',
};

export const rawFreeCustomerInfo = {
  appUserId: 'user_42',
  requestDate: null,
  entitlements: {},
  activeEntitlementIds: [],
  activeProductIds: [],
  latestExpirationDate: null,
};

const cashierProduct = {
  identifier: 'pro_annual',
  name: 'Pro (annual)',
  amount: 4999,
  currency: 'usd',
  periodMonths: 12,
  trialDays: 7,
  entitlements: ['premium'],
  appleProductId: 'com.example.pro.annual',
  googleProductId: 'pro_annual',
};

export const rawAnnual = {
  identifier: '$annual',
  offeringIdentifier: 'default',
  product: {
    identifier: 'com.example.pro.annual',
    title: 'Pro Annual',
    description: 'Everything, for a year',
    price: 49.99,
    priceString: '$49.99',
    currencyCode: 'USD',
    subscriptionPeriod: 'P1Y',
    freeTrialPeriod: 'P7D',
  },
  cashierProduct,
};

export const rawOfferings = {
  current: 'default',
  experiment: { id: 7, variant: 'b' },
  all: {
    default: {
      identifier: 'default',
      serverDescription: 'Main paywall',
      availablePackages: [
        rawAnnual,
        {
          identifier: 'founders',
          offeringIdentifier: 'default',
          product: { ...rawAnnual.product, identifier: 'com.example.founders', subscriptionPeriod: null, freeTrialPeriod: null },
          cashierProduct: { ...cashierProduct, identifier: 'founders', periodMonths: 0 },
        },
      ],
      hasPaywall: true,
      paywallId: 12,
      appName: 'Example',
      experiment: { id: 7, variant: 'b' },
    },
    lite: {
      identifier: 'lite',
      serverDescription: '',
      availablePackages: [],
      hasPaywall: false,
      paywallId: null,
      appName: 'Example',
      experiment: null,
    },
  },
};
