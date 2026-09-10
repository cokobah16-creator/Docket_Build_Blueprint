#!/usr/bin/env bash
# Configure the external providers a Docket deployment depends on.
#
#   1. Supabase Auth  - Site URL, redirect allow-list, phone (SMS OTP) provider
#   2. Stripe         - register the checkout webhook endpoint (idempotent)
#   3. Paystack       - print the dashboard steps (Paystack has no API for webhook URLs)
#
# Required environment:
#   SUPABASE_ACCESS_TOKEN   personal access token: https://supabase.com/dashboard/account/tokens
#   SUPABASE_PROJECT_REF    project ref, e.g. xgxuwimcxkpgtfkunwfe
#   APP_URL                 production origin, e.g. https://docket-build-blueprint.vercel.app
#
# Optional:
#   EXTRA_REDIRECT_URLS     comma-separated extra redirect URLs (preview deployments etc.)
#   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGE_SERVICE_SID
#                           when all three are set, phone sign-in is enabled with Twilio
#   STRIPE_SECRET_KEY       when set, the Stripe webhook endpoint is registered
#
# Nothing here is stored in the repo. Run it from a shell where the variables are exported:
#   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=... APP_URL=https://... bash scripts/configure-providers.sh
set -euo pipefail

need() { [ -n "${!1:-}" ] || { echo "missing $1" >&2; exit 1; }; }
need SUPABASE_ACCESS_TOKEN
need SUPABASE_PROJECT_REF
need APP_URL
APP_URL="${APP_URL%/}"

MGMT="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}"
FUNCTIONS="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1"
AUTH_HDR=(-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json")

echo "== 1. Supabase Auth (${SUPABASE_PROJECT_REF})"

# Redirect allow-list: production callback, localhost for development, plus any extras.
REDIRECTS="${APP_URL}/auth/callback,${APP_URL}/**,http://localhost:3000/auth/callback"
if [ -n "${EXTRA_REDIRECT_URLS:-}" ]; then REDIRECTS="${REDIRECTS},${EXTRA_REDIRECT_URLS}"; fi

PHONE_JSON=""
if [ -n "${TWILIO_ACCOUNT_SID:-}" ] && [ -n "${TWILIO_AUTH_TOKEN:-}" ] && [ -n "${TWILIO_MESSAGE_SERVICE_SID:-}" ]; then
  PHONE_JSON=$(python3 - <<PY
import json, os
print(json.dumps({
  "external_phone_enabled": True,
  "sms_provider": "twilio",
  "sms_twilio_account_sid": os.environ["TWILIO_ACCOUNT_SID"],
  "sms_twilio_auth_token": os.environ["TWILIO_AUTH_TOKEN"],
  "sms_twilio_message_service_sid": os.environ["TWILIO_MESSAGE_SERVICE_SID"],
  "sms_autoconfirm": False,
  "sms_otp_length": 6,
  "sms_otp_exp": 600,
  "sms_template": "Your {{ .SiteURL }} sign-in code is {{ .Code }}"
}))
PY
)
fi

BODY=$(APP_URL="$APP_URL" REDIRECTS="$REDIRECTS" PHONE_JSON="$PHONE_JSON" python3 - <<'PY'
import json, os
body = {
  "site_url": os.environ["APP_URL"],
  "uri_allow_list": os.environ["REDIRECTS"],
  "external_email_enabled": True,
  "mailer_autoconfirm": False,
  "security_update_password_require_reauthentication": True,
}
if os.environ.get("PHONE_JSON"):
  body.update(json.loads(os.environ["PHONE_JSON"]))
print(json.dumps(body))
PY
)

curl -fsS -X PATCH "${MGMT}/config/auth" "${AUTH_HDR[@]}" -d "$BODY" >/dev/null
curl -fsS "${MGMT}/config/auth" "${AUTH_HDR[@]}" | python3 -c '
import json, sys
c = json.load(sys.stdin)
print("   site_url            :", c.get("site_url"))
print("   uri_allow_list      :", c.get("uri_allow_list"))
print("   email sign-in       :", c.get("external_email_enabled"))
print("   phone sign-in       :", c.get("external_phone_enabled"), "provider:", c.get("sms_provider"))
'
if [ -z "$PHONE_JSON" ]; then
  echo "   phone provider not changed: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGE_SERVICE_SID to enable SMS OTP."
fi

echo
echo "== 2. Stripe webhook"
if [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  STRIPE_URL="${FUNCTIONS}/stripe-webhook"
  EXISTING=$(curl -fsS -u "${STRIPE_SECRET_KEY}:" "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
    | STRIPE_URL="$STRIPE_URL" python3 -c '
import json, os, sys
for e in json.load(sys.stdin)["data"]:
    if e["url"] == os.environ["STRIPE_URL"] and e["status"] == "enabled":
        print(e["id"]); break
')
  if [ -n "$EXISTING" ]; then
    echo "   already registered: ${EXISTING} -> ${STRIPE_URL}"
    echo "   the signing secret is only shown at creation; find it in Stripe > Developers > Webhooks."
  else
    RESP=$(curl -fsS -u "${STRIPE_SECRET_KEY}:" https://api.stripe.com/v1/webhook_endpoints \
      -d "url=${STRIPE_URL}" \
      -d "enabled_events[]=checkout.session.completed" \
      -d "description=Docket payments (record_payment)")
    echo "$RESP" | python3 -c '
import json, sys
e = json.load(sys.stdin)
print("   created:", e["id"], "->", e["url"])
print("   signing secret (set as STRIPE_WEBHOOK_SECRET on Supabase):", e["secret"])
'
    SECRET=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["secret"])')
    if command -v supabase >/dev/null 2>&1; then
      supabase secrets set --project-ref "${SUPABASE_PROJECT_REF}" "STRIPE_WEBHOOK_SECRET=${SECRET}" "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}"
      echo "   stored STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY as Edge Function secrets."
    else
      echo "   run: supabase secrets set --project-ref ${SUPABASE_PROJECT_REF} STRIPE_WEBHOOK_SECRET=${SECRET} STRIPE_SECRET_KEY=<key>"
    fi
  fi
else
  echo "   skipped: set STRIPE_SECRET_KEY to register ${FUNCTIONS}/stripe-webhook"
fi

echo
echo "== 3. Paystack webhook (dashboard only; Paystack exposes no API for this)"
echo "   Paystack dashboard > Settings > API Keys & Webhooks"
echo "   Test Webhook URL : ${FUNCTIONS}/paystack-webhook"
echo "   Live Webhook URL : ${FUNCTIONS}/paystack-webhook"
echo "   Then: supabase secrets set --project-ref ${SUPABASE_PROJECT_REF} PAYSTACK_SECRET_KEY=sk_test_..."
echo "   The function verifies x-paystack-signature (HMAC-SHA512 of the body with that key) and handles charge.success."
