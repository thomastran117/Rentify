/**
 * Purpose labels namespacing OTP codes in the cache. Two flows must never share
 * a purpose: a code issued for one is then redeemable against the other.
 */
export const LOCAL_LOGIN_UNLOCK_OTP_PURPOSE = "local-login-unlock";
export const LOCAL_PASSWORD_RESET_OTP_PURPOSE = "local-password-reset";
export const USERNAME_REMINDER_RATE_LIMIT_PURPOSE = "username-reminder";
export const EMAIL_VERIFICATION_OTP_PURPOSE = "email-verification";
/**
 * Confirms a new address a signed-in user is moving their account to. Kept
 * distinct from email verification: a signup code redeemable here would let an
 * address be claimed without the step-up the change flow requires.
 */
export const EMAIL_CHANGE_OTP_PURPOSE = "email-change";
