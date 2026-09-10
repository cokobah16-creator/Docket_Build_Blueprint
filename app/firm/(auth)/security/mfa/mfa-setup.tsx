"use client";

// TOTP enrolment and challenge. Staff cannot reach any /firm screen (and the
// database refuses their writes) until the session is aal2 — this is the
// flow that gets them there. Authenticator app only; no SMS fallback for
// privileged accounts.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

type Stage = "loading" | "enrol" | "challenge" | "error";

export function MfaSetup() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function bootstrap() {
      const { data: aal } = await supabase!.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      if (aal?.currentLevel === "aal2") {
        router.replace("/firm");
        return;
      }

      const { data: factors, error: listError } = await supabase!.auth.mfa.listFactors();
      if (cancelled) return;
      if (listError) {
        setError(listError.message);
        setStage("error");
        return;
      }

      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setStage("challenge");
        return;
      }

      const { data: enrolment, error: enrolError } = await supabase!.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Docket console",
      });
      if (cancelled) return;
      if (enrolError || !enrolment) {
        setError(enrolError?.message ?? "Could not start enrolment");
        setStage("error");
        return;
      }
      setFactorId(enrolment.id);
      setQrCode(enrolment.totp?.qr_code ?? null);
      setSecret(enrolment.totp?.secret ?? null);
      setStage("enrol");
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set.
      </Alert>
    );
  }

  async function verify() {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { data: challenge, error: challengeError } =
      await supabase!.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setBusy(false);
      setError(challengeError?.message ?? "Challenge failed");
      return;
    }
    const { error: verifyError } = await supabase!.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    router.replace("/firm");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title={
          stage === "challenge"
            ? "Enter your authenticator code"
            : "Set up two-factor authentication"
        }
      />
      <CardBody className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}

        {stage === "loading" && <p className="text-sm text-gray-600">Preparing…</p>}

        {stage === "enrol" && (
          <>
            <p className="text-sm text-gray-700">
              Scan this QR code with an authenticator app (Google
              Authenticator, 1Password, Authy…), then enter the 6-digit code.
            </p>
            {qrCode && (
              <div className="flex justify-center rounded-lg border border-gray-200 bg-white p-4">
                {/* Supabase returns the QR as an inline SVG data URI */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCode} alt="TOTP enrolment QR code" width={176} height={176} />
              </div>
            )}
            {secret && (
              <p className="break-all text-xs text-gray-500">
                Can&apos;t scan? Enter this secret manually: <code>{secret}</code>
              </p>
            )}
          </>
        )}

        {(stage === "enrol" || stage === "challenge") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
            className="space-y-4"
          >
            <Input
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "Verifying…" : "Verify"}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
