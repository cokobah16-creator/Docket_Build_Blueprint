#!/usr/bin/env bash
# Configure the external providers a Docket deployment depends on.
#
#   1. Supabase Auth  - Site URL, redirect allow-list, phone (SMS OTP) provider
#   2. Paystack       - print the dashboard steps (Paystack has no API for webhook URLs)
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
#
# Stripe is intentionally absent (decision 0002).
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

# THE SIGN-IN EMAIL CARRIES BOTH HALVES, and it only does so because this template says so.
#
# Supabase's stock magic-link template is the link alone. The link is a PKCE link: the verifier it
# needs was written to the browser that ASKED for it, so the two commonest ways an email is
# actually read — tapping through inside Gmail's in-app browser, or opening it on the laptop when
# the phone asked — fail on a link that is otherwise perfectly good. {{ .Token }} is the same
# credential without that constraint: six digits, typed into any browser on any device, verified by
# /auth/v1/verify with nothing to look up locally. src/components/auth/sign-in-forms.tsx shows a
# field for it beside the link, and app/auth/callback/route.ts points at it by name when a link
# fails. Remove {{ .Token }} here and that field silently becomes a box no code can ever satisfy.
#
# SIX DIGITS. GoTrue allows 6 to 10 (GOTRUE_MAILER_OTP_LENGTH) and defaults to 6, which is what the
# form assumes and what sms_otp_length is already pinned to above. If that default is ever changed
# for this project, change CODE_LENGTH in the component in the same commit.
#
# Plain text inside one <p>, no images, no tracking pixel, no web font: this is read on a 3G phone
# in a Gmail client that will strip most of what a designer would put here anyway, and a sign-in
# email that looks like marketing is a sign-in email that lands in spam.
read -r -d '' MAGIC_LINK_HTML <<'HTML' || true
<h2>Sign in to Docket</h2>
<p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
<p>Or type this code on the sign-in screen: <strong>{{ .Token }}</strong></p>
<p>If you are reading this on a different device from the one you are signing in on, use the code — the link only works in the browser that asked for it.</p>
<p>If you did not ask to sign in, nothing has happened and you can ignore this email.</p>
HTML

BODY=$(APP_URL="$APP_URL" REDIRECTS="$REDIRECTS" PHONE_JSON="$PHONE_JSON" MAGIC_LINK_HTML="$MAGIC_LINK_HTML" python3 - <<'PY'
import json, os
body = {
  "site_url": os.environ["APP_URL"],
  "uri_allow_list": os.environ["REDIRECTS"],
  "external_email_enabled": True,
  "mailer_autoconfirm": False,
  "security_update_password_require_reauthentication": True,
  "mailer_subjects_magic_link": "Your Docket sign-in code",
  "mailer_templates_magic_link_content": os.environ["MAGIC_LINK_HTML"],
}
if os.environ.get("PHONE_JSON"):
  body.update(json.loads(os.environ["PHONE_JSON"]))
print(json.dumps(body))
PY
)

curl -fsS -X PATCH "${MGMT}/config/auth" "${AUTH_HDR[@]}" -d "$BODY" >/dev/null

# HOW LONG A SIGN-IN EMAIL STAYS GOOD FOR, sent on its own and allowed to fail on its own.
#
# One setting governs both halves of that email — GoTrue keeps the link and the {{ .Token }} code
# as one credential — so this is the lifetime of anything in that message. sms_otp_exp above is
# pinned to 600; the email side was never pinned at all, which left a credential that signs
# somebody straight into a firm's client portal living for however long the platform's default
# happens to be, and defaults move. Supabase disallows more than 86400 and its own security
# advisor warns above 3600.
#
# 900 is the deliberate number: longer than the SMS code because an email arrives more slowly and
# is read when the person gets to it, short enough that a message sitting in an inbox overnight is
# not a key to a law firm. Fifteen minutes is generous for the actual flow, which is "tap the
# button, read the email that has just arrived" — and if it does lapse, the screen it lapses on now
# has a resend with a countdown and a code field beside it, which is what makes a short expiry
# affordable. It was not affordable before those existed.
#
# SENT SEPARATELY, AND ON PURPOSE. The field name is not something this repository can verify from
# here: GOTRUE_MAILER_OTP_EXP is the documented variable and sms_otp_exp proves the Management API
# mirrors these names, but "proves by analogy" is not proof, and curl -fsS under `set -e` would
# take the whole run down with it — losing site_url, the redirect allow-list and the email template
# over one unrecognised key. So it goes last, in its own request, and says so if it is refused.
if curl -fsS -X PATCH "${MGMT}/config/auth" "${AUTH_HDR[@]}" -d '{"mailer_otp_exp": 900}' >/dev/null 2>&1; then
  :
else
  echo "   NOTE: mailer_otp_exp was not accepted by the Management API. Everything else above was."
  echo "         Set it by hand: Auth > Providers > Email > Email OTP Expiration = 900 seconds."
fi

curl -fsS "${MGMT}/config/auth" "${AUTH_HDR[@]}" | python3 -c '
import json, sys
c = json.load(sys.stdin)
print("   site_url            :", c.get("site_url"))
print("   uri_allow_list      :", c.get("uri_allow_list"))
print("   email sign-in       :", c.get("external_email_enabled"))
tpl = c.get("mailer_templates_magic_link_content") or ""
print("   sign-in email       : link", "+ code" if "{{ .Token }}" in tpl else "ONLY — the code field in the app cannot work")
exp = c.get("mailer_otp_exp")
too_long = isinstance(exp, int) and exp > 3600
print("   sign-in email lasts :", f"{exp}s" if isinstance(exp, int) else "(not reported by this API)",
      "  <- longer than an hour; Supabase advises against it" if too_long else "")
print("   phone sign-in       :", c.get("external_phone_enabled"), "provider:", c.get("sms_provider"))
'
if [ -z "$PHONE_JSON" ]; then
  echo "   phone provider not changed: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGE_SERVICE_SID to enable SMS OTP."
fi

echo
echo "== 2. Paystack webhook (dashboard only; Paystack exposes no API for this)"
echo "   Paystack dashboard > Settings > API Keys & Webhooks"
echo "   Test Webhook URL : ${FUNCTIONS}/paystack-webhook"
echo "   Live Webhook URL : ${FUNCTIONS}/paystack-webhook"
echo "   Then: supabase secrets set --project-ref ${SUPABASE_PROJECT_REF} PAYSTACK_SECRET_KEY=sk_test_..."
echo "   The function verifies x-paystack-signature (HMAC-SHA512 of the body with that key) and handles charge.success."
