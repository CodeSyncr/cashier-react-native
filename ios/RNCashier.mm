// Exports RNCashierImpl (Swift) to JavaScript: as a bridge module with
// RCTEventEmitter on the old architecture, and as the TurboModule codegen
// generates from src/NativeCashier.ts on the new one.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <RNCashierSpec/RNCashierSpec.h>
#endif

// The pod's Swift header (module name CashierReactNative, see the podspec).
#if __has_include(<CashierReactNative/CashierReactNative-Swift.h>)
#import <CashierReactNative/CashierReactNative-Swift.h>
#else
#import "CashierReactNative-Swift.h"
#endif

@interface RNCashier : RCTEventEmitter
#ifdef RCT_NEW_ARCH_ENABLED
<NativeCashierSpec>
#else
<RCTBridgeModule>
#endif
@end

typedef void (^RNCashierReject)(NSString *code, NSString *message, NSDictionary<NSString *, id> *_Nullable userInfo);

/// Adapts a Swift reject(code, message, userInfo) to RN's reject, so
/// JavaScript sees `error.code` and `error.userInfo` ({ status, serverCode, storeCode }).
static RNCashierReject RNCashierRejecter(RCTPromiseRejectBlock reject)
{
  return ^(NSString *code, NSString *message, NSDictionary<NSString *, id> *_Nullable userInfo) {
    NSError *error = [NSError errorWithDomain:@"com.codesyncr.cashier"
                                         code:0
                                     userInfo:userInfo ?: @{}];
    reject(code, message, error);
  };
}

@implementation RNCashier {
  RNCashierImpl *_impl;
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE(RNCashier)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _impl = [RNCashierImpl new];
    __weak RNCashier *weakSelf = self;
    _impl.emit = ^(NSString *name, NSDictionary<NSString *, id> *body) {
      RNCashier *strongSelf = weakSelf;
      if (strongSelf && strongSelf->_hasListeners) {
        [strongSelf sendEventWithName:name body:body];
      }
    };
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ RNCashierImpl.customerInfoEvent, RNCashierImpl.paywallAnswerEvent ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

RCT_EXPORT_METHOD(configure:(NSString *)apiKey
                  appUserId:(NSString *_Nullable)appUserId
                  baseUrl:(NSString *_Nullable)baseUrl
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl configure:apiKey appUserId:appUserId baseUrl:baseUrl resolve:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(getAppUserId:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl getAppUserId:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(isAnonymous:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl isAnonymous:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(getCustomerInfo:(BOOL)force
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl getCustomerInfo:force resolve:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(getOfferings:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl getOfferings:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(purchasePackage:(NSString *)offeringIdentifier
                  packageIdentifier:(NSString *)packageIdentifier
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl purchasePackage:offeringIdentifier
       packageIdentifier:packageIdentifier
                 resolve:resolve
                  reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(restorePurchases:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl restorePurchases:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(syncPurchases:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl syncPurchases:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(logIn:(NSString *)appUserId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl logIn:appUserId resolve:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(logOut:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl logOut:resolve reject:RNCashierRejecter(reject)];
}

RCT_EXPORT_METHOD(presentPaywall:(NSString *)requestId
                  requiredEntitlement:(NSString *_Nullable)requiredEntitlement
                  offeringId:(NSString *_Nullable)offeringId
                  locale:(NSString *_Nullable)locale
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  [_impl presentPaywall:requestId
    requiredEntitlement:requiredEntitlement
             offeringId:offeringId
                 locale:locale
                resolve:resolve
                 reject:RNCashierRejecter(reject)];
}

// addListener: / removeListeners: come from RCTEventEmitter.

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeCashierSpecJSI>(params);
}
#endif

@end
