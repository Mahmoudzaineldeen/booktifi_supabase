# Fix: SmsOneMonthFreeTrialServiceTest::testBucketUserAtLoginDoesNotApplyDiscountIfAlreadyHasIt

## Error

```
LogicException: No discount found for ID 2111
UserDiscountService.php:222
SmsOneMonthFreeTrialService.php:89
SmsOneMonthFreeTrialService.php:68
```

## Cause

With **`plan.use_user_discount_service` => true**, the service uses `UserDiscountService($user)` instead of `$user->info`. The test mocks **`$user_info_mock->hasEverHadDiscount(SMS_FREE_TRIAL_ONE_MONTH_DISCOUNT)`** to return `true`, but that mock is only used when the code path uses `$user->info`. When the flag is on, `hasEverHadDiscount()` is called on the real `UserDiscountService`, which returns false in the test environment, so the code then calls `addDiscount(2111)`. `UserDiscountService::addDiscount()` looks up discount ID 2111 and throws "No discount found for ID 2111" because that discount is not present in the test DB.

## Fix

In **`testBucketUserAtLoginDoesNotApplyDiscountIfAlreadyHasIt`**, set **`plan.use_user_discount_service` => false** in the `withFlagDecisionsForTesting` call so the code uses `$user->info` (the mock). The mock’s `hasEverHadDiscount()` then returns true, the “already has discount” early return runs, and `addDiscount` is never called. The test still validates the intended behavior: “do not apply discount when the user already has it.”

### Change

In the test method, replace:

```php
\MC_Flag::withFlagDecisionsForTesting([
    'plan.global_sms_free_trials_v2' => true,
    'plan.use_user_discount_service' => true,
], function () {
```

with:

```php
// Use plan.use_user_discount_service => false so the code path uses $user->info (mocked).
// With the flag on, UserDiscountService would be used and the hasEverHadDiscount mock would not apply.
\MC_Flag::withFlagDecisionsForTesting([
    'plan.global_sms_free_trials_v2' => true,
    'plan.use_user_discount_service' => false,
], function () {
```

No other changes are required. The assertion that `addDiscount` is never called remains correct.
