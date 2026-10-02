// The handful of React Native APIs this package touches, declared locally so
// type-checking does not need the react-native package installed. Consumers
// compile against react-native's own types; these signatures are a subset.
declare module 'react-native' {
  export interface TurboModule {
    getConstants?(): {};
  }

  export const TurboModuleRegistry: {
    get<T extends TurboModule>(name: string): T | null;
    getEnforcing<T extends TurboModule>(name: string): T;
  };

  export const NativeModules: { [name: string]: any };

  export interface EmitterSubscription {
    remove(): void;
  }

  export class NativeEventEmitter {
    constructor(nativeModule?: any);
    addListener(eventType: string, listener: (event: any) => void): EmitterSubscription;
    removeAllListeners(eventType: string): void;
  }

  export const Platform: {
    OS: 'ios' | 'android' | 'macos' | 'windows' | 'web';
    select<T>(spec: { ios?: T; android?: T; default?: T }): T | undefined;
  };
}
