// A stand-in for the react-native pieces this package uses. The native module
// is a set of jest.fn()s; NativeEventEmitter routes through `emit` below so
// tests can play native events.

type Listener = (event: unknown) => void;

const registry = new Map<string, Set<Listener>>();

export const nativeModule = {
  configure: jest.fn(),
  getAppUserId: jest.fn(),
  isAnonymous: jest.fn(),
  getCustomerInfo: jest.fn(),
  getOfferings: jest.fn(),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
  syncPurchases: jest.fn(),
  logIn: jest.fn(),
  logOut: jest.fn(),
  presentPaywall: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

export const NativeModules: Record<string, unknown> = { RNCashier: nativeModule };

export const TurboModuleRegistry = {
  get: jest.fn((name: string) => (NativeModules[name] as object | undefined) ?? null),
  getEnforcing: jest.fn((name: string) => NativeModules[name]),
};

export const Platform = { OS: 'ios', select: (s: { ios?: unknown }) => s.ios };

export class NativeEventEmitter {
  readonly module: unknown;
  constructor(module?: unknown) {
    this.module = module;
    constructed.push(this);
  }
  addListener(event: string, fn: Listener) {
    const set = registry.get(event) ?? new Set<Listener>();
    registry.set(event, set);
    set.add(fn);
    return { remove: () => set.delete(fn) };
  }
  removeAllListeners(event: string) {
    registry.delete(event);
  }
}

export const constructed: NativeEventEmitter[] = [];

/** Plays a native event. */
export function emit(event: string, body: unknown): void {
  for (const fn of Array.from(registry.get(event) ?? [])) fn(body);
}

/** How many JS listeners an event has. */
export function listenerCount(event: string): number {
  return registry.get(event)?.size ?? 0;
}

export function resetMock(): void {
  registry.clear();
  constructed.length = 0;
  for (const fn of Object.values(nativeModule)) fn.mockReset();
  NativeModules.RNCashier = nativeModule;
}
