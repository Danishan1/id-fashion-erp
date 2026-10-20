/**
 * The temporary password given to a login created from Employee Master
 * (P2, business decision 6). It is only ever a first-login password: the
 * login is created with mustChangePassword = true, so the user must replace
 * it before they can do anything, and they can never set it again.
 * Stored hashed like any password; never logged.
 */
export const TEMPORARY_EMPLOYEE_PASSWORD = "12345678";
