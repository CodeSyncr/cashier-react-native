package com.codesyncr.cashier.reactnative

import com.facebook.react.bridge.ReactApplicationContext

/** New architecture: the TurboModule spec codegen generates from src/NativeCashier.ts. */
abstract class CashierSpecBase(context: ReactApplicationContext) : NativeCashierSpec(context)
