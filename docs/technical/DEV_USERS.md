# Development Users

These accounts are for local development only.

## Accounts

- Username: administrator
- Email: administrator@local.dev
- Password: Admin!23456
- Role: Admin (`is_admin = 1`)

- Username: default_user
- Email: default_user@local.dev
- Password: User!23456
- Role: Player (`is_admin = 0`)

## Notes

- Passwords are intentionally simple enough for local testing.
- Do not use these credentials in production.
- If you need to reset both users quickly, run SQL updates in the `users` table and set a fresh `password_hash` via PHP `password_hash()`.

## Dev Reset Tool

- The login page now includes a local dev password reset tool.
- It calls `POST /api/auth.php?action=dev_reset_password` (CSRF protected).
- The tool is controlled by `ENABLE_DEV_AUTH_TOOLS` in `config/config.php` (enabled by default for non-production).
- Rate limit: max 5 reset attempts per 10 minutes per browser session.
