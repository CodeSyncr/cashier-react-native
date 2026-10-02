package com.codesyncr.cashier.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/**
 * Old architecture: the same methods as the codegen'd NativeCashierSpec
 * (src/NativeCashier.ts), on a plain bridge module. RNCashierModule marks
 * each override @ReactMethod.
 */
abstract class CashierSpecBase(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    abstract fun configure(apiKey: String, appUserId: String?, baseUrl: String?, promise: Promise)
    abstract fun getAppUserId(promise: Promise)
    abstract fun isAnonymous(promise: Promise)
    abstract fun getCustomerInfo(force: Boolean, promise: Promise)
    abstract fun getOfferings(promise: Promise)
    abstract fun purchasePackage(offeringIdentifier: String, packageIdentifier: String, promise: Promise)
    abstract fun restorePurchases(promise: Promise)
    abstract fun syncPurchases(promise: Promise)
    abstract fun logIn(appUserId: String, promise: Promise)
    abstract fun logOut(promise: Promise)
    abstract fun presentPaywall(
        requestId: String,
        requiredEntitlement: String?,
        offeringId: String?,
        locale: String?,
        promise: Promise,
    )
    abstract fun addListener(eventName: String)
    abstract fun removeListeners(count: Double)
}
