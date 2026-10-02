package com.codesyncr.cashier.reactnative

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers RNCashier; autolinking adds this package to the app. */
class RNCashierPackage : TurboReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == RNCashierModule.NAME) RNCashierModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            RNCashierModule.NAME to ReactModuleInfo(
                RNCashierModule.NAME,
                RNCashierModule::class.java.name,
                false, // canOverrideExistingModule
                false, // needsEagerInit
                false, // hasConstants
                false, // isCxxModule
                BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, // isTurboModule
            ),
        )
    }
}
