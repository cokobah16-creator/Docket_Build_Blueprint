#!/usr/bin/env bash
# Read-only production gate for the provider settings the application cannot verify itself.
# It prints configuration state, never credential values, and exits non-zero while a required
# sign-in path is unavailable.
set -euo pipefail

need() { [ -n "${!1:-}" ] || { echo "missing $1" >&2; exit 1; }; }
need SUPABASE_ACCESS_TOKEN
need SUPABASE_PROJECT_REF
need APP_URL

APP_URL="${APP_URL%/}"
APP_AUTHORITY="${APP_URL#*://}"
case "$APP_URL" in
  https://*|http://localhost:*) ;;
  *) echo "APP_URL must be an https origin (or http://localhost for local work)" >&2; exit 1 ;;
esac
case "$APP_AUTHORITY" in
  ''|*/*|*\?*|*\#*) echo "APP_URL must contain no path, query or fragment" >&2; exit 1 ;;
esac
MGMT="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}"
AUTH_CONFIG_JSON=$(curl -fsS "${MGMT}/config/auth" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json")

echo "INFO    Google callback          https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/callback"
echo "INFO    Manual checks            Resend sender verified; Twilio SMS and WhatsApp senders approved"

AUTH_CONFIG_JSON="$AUTH_CONFIG_JSON" AUTH_APP_URL="$APP_URL" python3 - <<'PY'
import json
import os
import sys

config = json.loads(os.environ["AUTH_CONFIG_JSON"])
app_url = os.environ["AUTH_APP_URL"].rstrip("/")
failures = []


def check(label, ok, detail):
    status = "READY" if ok else "BLOCKED"
    print(f"{status:7} {label:<24} {detail}")
    if not ok:
        failures.append(label)


allow_list = config.get("uri_allow_list") or ""
if isinstance(allow_list, str):
    redirects = {value.strip() for value in allow_list.split(",") if value.strip()}
else:
    redirects = {str(value).strip() for value in allow_list if str(value).strip()}

check("Auth Site URL", config.get("site_url") == app_url, f"expected {app_url}")
check(
    "Callback allow-list",
    f"{app_url}/auth/callback" in redirects and f"{app_url}/**" in redirects,
    "production callback and application paths",
)
check("Email sign-in", config.get("external_email_enabled") is True, "email provider enabled")
check("Production SMTP", bool(config.get("smtp_host")), "custom sender required outside the Supabase team")

template = config.get("mailer_templates_magic_link_content") or ""
template_ok = (
    "{{ .ConfirmationURL }}" in template
    and "Sign in to Docket" in template
    and "{{ .Token }}" not in template
)
check("Docket email template", template_ok, "branded, link-only sign-in email")

check("Google OAuth", config.get("external_google_enabled") is True, "Google provider enabled")
check("Phone OTP", config.get("external_phone_enabled") is True, "phone provider enabled")
check("SMS provider", bool(config.get("sms_provider")), "configured delivery provider")
check("SMS code length", config.get("sms_otp_length") == 6, "six digits expected by the UI")

email_limit = config.get("rate_limit_email_sent")
sms_limit = config.get("rate_limit_sms_sent")
print(f"INFO    Email send ceiling       {email_limit if isinstance(email_limit, int) else 'not reported'} per hour")
print(f"INFO    SMS send ceiling         {sms_limit if isinstance(sms_limit, int) else 'not reported'} per hour")

if failures:
    print("\nAuthentication is not production-ready: " + ", ".join(failures), file=sys.stderr)
    sys.exit(1)

print("\nConfiguration gate passed. Complete the three live delivery checks in DEPLOYMENT_RUNBOOK.md.")
PY
