package com.codesyncr.cashier.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.nimbus.cashier.Cashier
import com.nimbus.cashier.CashierException
import com.nimbus.cashier.CustomerInfo
import com.nimbus.cashier.Offerings
import com.nimbus.cashier.Package
import com.nimbus.cashier.PaywallAnswer
import com.nimbus.cashier.PaywallListener
import com.nimbus.cashier.presentPaywall
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** An error with one of the bridge's own reject codes. */
internal class BridgeException(val code: String, message: String) : Exception(message)

/**
 * The React Native bridge over com.nimbus.cashier. Extends [CashierSpecBase]:
 * the codegen'd TurboModule spec on the new architecture (src/newarch), a
 * plain ReactContextBaseJavaModule on the old one (src/oldarch).
 *
 * Promise rejections use the codes src/errors.ts maps: E_NOT_CONFIGURED,
 * E_CONFIGURATION, E_INVALID_ARGUMENT, E_NETWORK, E_SERVER (userInfo: status,
 * serverCode), E_STORE (userInfo: storeCode), E_NOT_FOUND,
 * E_PAYWALL_IN_PROGRESS, E_UI_UNAVAILABLE, E_UNKNOWN.
 */
class RNCashierModule(private val reactContext: ReactApplicationContext) : CashierSpecBase(reactContext) {
    companion object {
        const val NAME = "RNCashier"
        const val CUSTOMER_INFO_EVENT = "Cashier.customerInfoUpdated"
        const val PAYWALL_ANSWER_EVENT = "Cashier.paywallAnswer"
    }

    // Main: Play Billing's launchBillingFlow and startActivity want the UI thread.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var observeJob: Job? = null

    /** Packages from the last offerings fetch, keyed "offering/package". */
    private val packages = ConcurrentHashMap<String, Package>()
    private val paywallInProgress = AtomicBoolean(false)

    override fun getName(): String = NAME

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }

    // ── Configuration ────────────────────────────────────────

    @ReactMethod
    override fun configure(apiKey: String, appUserId: String?, baseUrl: String?, promise: Promise) {
        val key = apiKey.trim()
        if (key.isEmpty()) return promise.reject("E_CONFIGURATION", "Cashier.configure needs your public apiKey")
        if (key.startsWith("cshr_live_")) {
            return promise.reject("E_CONFIGURATION", "That is your SECRET key. Use the public key (cshr_pub_…) in an app.")
        }
        val user = appUserId?.trim()?.takeIf { it.isNotEmpty() }
        try {
            val cashier = if (baseUrl.isNullOrBlank()) {
                Cashier.configure(reactContext.applicationContext, key, user)
            } else {
                Cashier.configure(reactContext.applicationContext, key, user, baseUrl.trim().trimEnd('/'))
            }
            packages.clear()
            observe(cashier)
            promise.resolve(null)
        } catch (e: Exception) {
            reject(promise, e)
        }
    }

    private fun observe(cashier: Cashier) {
        observeJob?.cancel()
        observeJob = scope.launch {
            cashier.customerInfoFlow.collect { info ->
                if (info != null) emit(CUSTOMER_INFO_EVENT, Marshal.customerInfo(info))
            }
        }
    }

    @ReactMethod
    override fun getAppUserId(promise: Promise) = launchPromise(promise) { it.appUserId }

    @ReactMethod
    override fun isAnonymous(promise: Promise) = launchPromise(promise) { it.isAnonymous }

    // ── Customer info ────────────────────────────────────────

    @ReactMethod
    override fun getCustomerInfo(force: Boolean, promise: Promise) = launchPromise(promise) {
        Marshal.customerInfo(it.customerInfo(forceRefresh = force))
    }

    // ── Offerings & purchases ────────────────────────────────

    @ReactMethod
    override fun getOfferings(promise: Promise) = launchPromise(promise) { Marshal.offerings(loadOfferings(it)) }

    private suspend fun loadOfferings(cashier: Cashier): Offerings {
        val offerings = cashier.offerings()
        val map = HashMap<String, Package>()
        offerings.all.values.forEach { o -> o.availablePackages.forEach { p -> map["${o.identifier}/${p.identifier}"] = p } }
        packages.clear()
        packages.putAll(map)
        return offerings
    }

    @ReactMethod
    override fun purchasePackage(offeringIdentifier: String, packageIdentifier: String, promise: Promise) = launchPromise(promise) { cashier ->
        val key = "$offeringIdentifier/$packageIdentifier"
        val pkg = packages[key] ?: run {
            loadOfferings(cashier)
            packages[key]
        } ?: throw BridgeException("E_NOT_FOUND", "No package $packageIdentifier in offering $offeringIdentifier")
        val activity = reactContext.currentActivity
            ?: throw BridgeException("E_UI_UNAVAILABLE", "No activity to launch the Google Play purchase from")
        val result = cashier.purchase(activity, pkg)
        Arguments.createMap().apply {
            putNullableMap("customerInfo", result.customerInfo?.let { Marshal.customerInfo(it) })
            putBoolean("userCancelled", result.userCancelled)
            putBoolean("isPending", result.isPending)
            putString("productIdentifier", result.purchase?.products?.firstOrNull() ?: pkg.productDetails.productId)
            putString("transactionId", result.purchase?.orderId)
        }
    }

    @ReactMethod
    override fun restorePurchases(promise: Promise) = launchPromise(promise) { Marshal.customerInfo(it.restorePurchases()) }

    /** Play has no sign-in prompt to avoid: syncing is restoring. */
    @ReactMethod
    override fun syncPurchases(promise: Promise) = launchPromise(promise) { Marshal.customerInfo(it.restorePurchases()) }

    // ── Identity ─────────────────────────────────────────────

    @ReactMethod
    override fun logIn(appUserId: String, promise: Promise) = launchPromise(promise) { Marshal.customerInfo(it.logIn(appUserId)) }

    @ReactMethod
    override fun logOut(promise: Promise) = launchPromise(promise) { Marshal.customerInfo(it.logOut()) }

    // ── Paywall ──────────────────────────────────────────────

    /**
     * Presents the paywall with Cashier.presentPaywall and resolves
     * `{ result, customerInfo }` when it closes; answers are emitted as
     * PAYWALL_ANSWER_EVENT tagged with [requestId].
     */
    @ReactMethod
    override fun presentPaywall(
        requestId: String,
        requiredEntitlement: String?,
        offeringId: String?,
        locale: String?,
        promise: Promise,
    ) {
        if (!Cashier.isConfigured) return notConfigured(promise)
        if (!paywallInProgress.compareAndSet(false, true)) {
            return promise.reject("E_PAYWALL_IN_PROGRESS", "A paywall is already presented")
        }
        val cashier = Cashier.shared
        scope.launch {
            try {
                if (requiredEntitlement != null) {
                    val info = runCatching { cashier.customerInfo() }.getOrNull()
                    if (info != null && info.isEntitledTo(requiredEntitlement)) {
                        paywallInProgress.set(false)
                        promise.resolve(paywallResult("not_presented", info))
                        return@launch
                    }
                }
                // Loaded here so a failure reaches JavaScript as "error".
                val offerings = loadOfferings(cashier)
                val offering = if (offeringId != null) {
                    offerings[offeringId] ?: throw BridgeException("E_NOT_FOUND", "No offering $offeringId")
                } else {
                    offerings.current ?: throw BridgeException("E_NOT_FOUND", "No current offering")
                }
                val activity = reactContext.currentActivity
                    ?: throw BridgeException("E_UI_UNAVAILABLE", "No activity to present the paywall from")
                cashier.presentPaywall(
                    activity,
                    requiredEntitlement = requiredEntitlement,
                    offering = offering,
                    locale = locale?.takeIf { it.isNotBlank() },
                    listener = PaywallBridgeListener(requestId, requiredEntitlement, promise),
                )
            } catch (e: CancellationException) {
                paywallInProgress.set(false)
                throw e
            } catch (e: Exception) {
                paywallInProgress.set(false)
                promise.resolve(paywallError(e))
            }
        }
    }

    private inner class PaywallBridgeListener(
        private val requestId: String,
        private val requiredEntitlement: String?,
        private val promise: Promise,
    ) : PaywallListener {
        private val settled = AtomicBoolean(false)
        private var outcome = "cancelled"
        private var info: CustomerInfo? = null
        private var error: Exception? = null

        override fun onPurchaseCompleted(customerInfo: CustomerInfo) {
            info = customerInfo
            outcome = "purchased"
        }

        override fun onRestoreCompleted(customerInfo: CustomerInfo) {
            info = customerInfo
            val granted = requiredEntitlement == null || customerInfo.isEntitledTo(requiredEntitlement)
            if (granted && outcome != "purchased") outcome = "restored"
        }

        override fun onAnswer(answer: PaywallAnswer) {
            emit(PAYWALL_ANSWER_EVENT, Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("screenId", answer.screenId)
                putString("question", answer.question)
                putString("answer", answer.answer)
            })
        }

        override fun onError(error: Exception) {
            this.error = error
        }

        override fun onDismiss() {
            if (!settled.compareAndSet(false, true)) return
            paywallInProgress.set(false)
            val e = error
            promise.resolve(if (e != null && outcome == "cancelled") paywallError(e) else paywallResult(outcome, info))
        }
    }

    private fun paywallResult(result: String, info: CustomerInfo?): WritableMap = Arguments.createMap().apply {
        putString("result", result)
        putNullableMap("customerInfo", info?.let { Marshal.customerInfo(it) })
    }

    private fun paywallError(e: Throwable): WritableMap {
        val (code, message, userInfo) = describe(e)
        return Arguments.createMap().apply {
            putString("result", "error")
            putMap("error", Arguments.createMap().apply {
                putString("code", code)
                putString("message", message)
                putMap("userInfo", userInfo)
            })
        }
    }

    // ── Events ───────────────────────────────────────────────

    private fun emit(event: String, body: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, body)
    }

    /** NativeEventEmitter bookkeeping; events are emitted regardless. */
    @ReactMethod
    override fun addListener(eventName: String) {}

    @ReactMethod
    override fun removeListeners(count: Double) {}

    // ── Plumbing ─────────────────────────────────────────────

    /** Runs [block] with the configured Cashier, resolving its value or rejecting with the mapped error. */
    private fun launchPromise(promise: Promise, block: suspend (Cashier) -> Any?) {
        if (!Cashier.isConfigured) return notConfigured(promise)
        val cashier = Cashier.shared
        scope.launch {
            try {
                promise.resolve(block(cashier))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                reject(promise, e)
            }
        }
    }

    private fun notConfigured(promise: Promise) =
        promise.reject("E_NOT_CONFIGURED", "Call Cashier.configure({ apiKey }) first")

    private fun reject(promise: Promise, e: Throwable) {
        val (code, message, userInfo) = describe(e)
        promise.reject(code, message, e, userInfo)
    }

    /** Maps an SDK error to (reject code, message, userInfo). */
    private fun describe(e: Throwable): Triple<String, String, WritableMap> {
        val userInfo = Arguments.createMap()
        val code = when (e) {
            is BridgeException -> e.code
            is CashierException -> when {
                e.code == "network" -> "E_NETWORK"
                e.code == "invalid_app_user_id" || e.code == "already_anonymous" -> "E_CONFIGURATION"
                e.status > 0 -> {
                    userInfo.putInt("status", e.status)
                    userInfo.putString("serverCode", e.code)
                    "E_SERVER"
                }
                e.code.startsWith("billing_") || e.code == "no_offer" -> {
                    userInfo.putString("storeCode", e.code)
                    "E_STORE"
                }
                e.code == "not_found" -> "E_NOT_FOUND"
                else -> "E_UNKNOWN"
            }
            // Cashier.configure's require() (a secret key).
            is IllegalArgumentException -> "E_CONFIGURATION"
            // Cashier.shared before configure.
            is IllegalStateException -> if (!Cashier.isConfigured) "E_NOT_CONFIGURED" else "E_UNKNOWN"
            else -> "E_UNKNOWN"
        }
        return Triple(code, e.message ?: code, userInfo)
    }

    private fun WritableMap.putNullableMap(key: String, value: WritableMap?) {
        if (value == null) putNull(key) else putMap(key, value)
    }
}
