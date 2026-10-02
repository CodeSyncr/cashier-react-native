package com.codesyncr.cashier.reactnative

import com.android.billingclient.api.ProductDetails
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.nimbus.cashier.CashierProduct
import com.nimbus.cashier.CustomerInfo
import com.nimbus.cashier.Offering
import com.nimbus.cashier.Offerings
import com.nimbus.cashier.Package
import com.nimbus.cashier.PaywallExperiment
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** com.nimbus.cashier values as the maps src/marshal.ts reads (same keys as the iOS bridge). */
internal object Marshal {
    private fun iso(date: Date?): String? = date?.let {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(it)
    }

    private fun strings(list: List<String>) = Arguments.createArray().apply { list.forEach { pushString(it) } }

    private fun WritableMap.putMapOrNull(key: String, value: WritableMap?) {
        if (value == null) putNull(key) else putMap(key, value)
    }

    fun customerInfo(info: CustomerInfo): WritableMap = Arguments.createMap().apply {
        putString("appUserId", info.appUserId)
        putString("requestDate", iso(info.requestDate))
        putMap("entitlements", Arguments.createMap().apply {
            info.entitlements.forEach { (id, e) ->
                putMap(id, Arguments.createMap().apply {
                    putString("identifier", e.identifier)
                    putBoolean("isActive", e.isActive)
                    putBoolean("willRenew", e.willRenew)
                    putString("periodType", e.periodType)
                    putString("productIdentifier", e.productIdentifier)
                    putString("source", e.source)
                    putString("expirationDate", iso(e.expirationDate))
                })
            }
        })
        putArray("activeEntitlementIds", strings(info.activeEntitlementIds))
        putArray("activeProductIds", strings(info.activeProductIds))
        putString("latestExpirationDate", iso(info.latestExpirationDate))
    }

    private fun experiment(e: PaywallExperiment?): WritableMap? = e?.let {
        Arguments.createMap().apply {
            putDouble("id", it.id.toDouble())
            putString("variant", it.variant)
        }
    }

    fun offerings(o: Offerings): WritableMap = Arguments.createMap().apply {
        putString("current", o.current?.identifier)
        putMap("all", Arguments.createMap().apply { o.all.forEach { (id, offering) -> putMap(id, offering(offering)) } })
        putMapOrNull("experiment", experiment(o.experiment))
    }

    fun offering(o: Offering): WritableMap = Arguments.createMap().apply {
        putString("identifier", o.identifier)
        putString("serverDescription", o.serverDescription)
        putArray("availablePackages", Arguments.createArray().apply { o.availablePackages.forEach { pushMap(pkg(it)) } })
        putBoolean("hasPaywall", o.paywall != null)
        val paywallId = o.paywallId
        if (paywallId == null) putNull("paywallId") else putDouble("paywallId", paywallId.toDouble())
        putString("appName", o.appName)
        putMapOrNull("experiment", experiment(o.experiment))
    }

    fun pkg(p: Package): WritableMap = Arguments.createMap().apply {
        putString("identifier", p.identifier)
        putString("offeringIdentifier", p.offeringIdentifier)
        putMap("product", product(p))
        putMap("cashierProduct", cashierProduct(p.cashierProduct))
    }

    private fun cashierProduct(p: CashierProduct): WritableMap = Arguments.createMap().apply {
        putString("identifier", p.identifier)
        putString("name", p.name)
        putDouble("amount", p.amount.toDouble())
        putString("currency", p.currency)
        putInt("periodMonths", p.periodMonths)
        putInt("trialDays", p.trialDays)
        putArray("entitlements", strings(p.entitlements))
        putString("appleProductId", p.appleProductId)
        putString("googleProductId", p.googleProductId)
    }

    /**
     * Play's product. A subscription's price is its base plan's recurring
     * phase; its free trial is the first phase of the offer bought by default
     * ([Package.defaultOfferToken]) when that phase is free.
     */
    private fun product(p: Package): WritableMap {
        val d: ProductDetails = p.productDetails
        var price = 0.0
        var priceString = ""
        var currency = ""
        var period: String? = null
        var trial: String? = null
        val oneTime = d.oneTimePurchaseOfferDetails
        val offers = d.subscriptionOfferDetails.orEmpty()
        if (oneTime != null) {
            price = oneTime.priceAmountMicros / 1_000_000.0
            priceString = oneTime.formattedPrice
            currency = oneTime.priceCurrencyCode
        } else if (offers.isNotEmpty()) {
            val base = offers.firstOrNull { it.offerId == null } ?: offers.first()
            base.pricingPhases.pricingPhaseList.lastOrNull()?.let {
                price = it.priceAmountMicros / 1_000_000.0
                priceString = it.formattedPrice
                currency = it.priceCurrencyCode
                period = it.billingPeriod
            }
            val chosen = offers.firstOrNull { it.offerToken == p.defaultOfferToken }
            chosen?.pricingPhases?.pricingPhaseList?.firstOrNull()?.let {
                if (it.priceAmountMicros == 0L) trial = it.billingPeriod
            }
        }
        return Arguments.createMap().apply {
            putString("identifier", d.productId)
            putString("title", d.name)
            putString("description", d.description)
            putDouble("price", price)
            putString("priceString", priceString)
            putString("currencyCode", currency)
            putString("subscriptionPeriod", period)
            putString("freeTrialPeriod", trial)
        }
    }
}
