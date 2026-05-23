# Rotate secrets

## Planned rotation (quarterly)

Quarterly is a good cadence. More often is paranoid; less often is sloppy.

For each secret below: rotate in the source, update in deployments,
update local `.env`s.

## Emergency rotation (suspected leak)

Rotate everything in this list in under 30 minutes. Order matters - do the
service role keys first since they bypass RLS.

### 1. `SUPABASE_SERVICE_ROLE_KEY`

- Supabase dashboard -> Project Settings -> API -> Reset service role key.
- Update in Vercel, Railway/Fly, GitHub Actions secrets.
- Restart API processes.

### 2. `JWT_SECRET`

- Generate: `openssl rand -base64 64`
- Update everywhere. Note: all current API JWTs become invalid - users
  must re-login.

### 3. Paystack / Flutterwave secret keys

- Paystack dashboard -> Settings -> API Keys & Webhooks -> Regenerate.
- Update in API secrets store.
- Webhook handler will continue to accept the old signature for the
  rollover window (~5 min) - then only the new key.

### 4. WhatsApp / SMS / Email provider tokens

- Meta Cloud API: revoke and reissue the access token.
- Africa's Talking / Twilio: rotate API key.
- Resend: regenerate API key.

### 5. Cloudflare R2 keys

- Cloudflare dashboard -> R2 -> Manage API tokens -> Roll.
- Update in API and in the backup script's environment.

### 6. GitHub Actions secrets (if a workflow file leaked them)

- Repository settings -> Secrets and variables -> Actions.
- Re-encrypt all secrets. (Old workflow runs may have logged values - check.)

## After rotation

- [ ] Sentry: confirm no auth-related error spike.
- [ ] Manually log in as one user per role to confirm the system is alive.
- [ ] Document the rotation in the audit log:
      action=`secret.rotate`, metadata=`{ "secret": "service_role_key" }`.
