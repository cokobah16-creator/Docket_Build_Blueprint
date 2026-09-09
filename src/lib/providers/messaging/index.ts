// Messaging provider adapters — SMS (Termii for Nigerian numbers on DND,
// Twilio as a fallback) and email (Resend). Server-side only.
//
// Most traffic goes through the notifications outbox and the
// dispatch-notifications Edge Function; these adapters exist for the odd
// synchronous send (e.g. an invite link fired from a server action).

export interface SendSmsParams {
  /** E.164, e.g. +2348012345678. */
  to: string;
  text: string;
}

export interface SmsProvider {
  readonly name: "termii" | "twilio";
  send(params: SendSmsParams): Promise<void>;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: "resend";
  send(params: SendEmailParams): Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

// --- Termii -----------------------------------------------------------------

export function termiiProvider(): SmsProvider {
  return {
    name: "termii",
    async send({ to, text }) {
      const res = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: requireEnv("TERMII_API_KEY"),
          to,
          from: process.env.TERMII_SENDER_ID ?? "Docket",
          sms: text,
          type: "plain",
          channel: "dnd", // delivers even to Do-Not-Disturb Nigerian numbers
        }),
      });
      if (!res.ok) {
        throw new Error(`termii send failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}

// --- Twilio -----------------------------------------------------------------

export function twilioProvider(): SmsProvider {
  return {
    name: "twilio",
    async send({ to, text }) {
      const sid = requireEnv("TWILIO_ACCOUNT_SID");
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(`${sid}:${requireEnv("TWILIO_AUTH_TOKEN")}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: to,
            From: requireEnv("TWILIO_FROM"),
            Body: text,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`twilio send failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}

/** Termii when configured (Nigerian DND delivery), otherwise Twilio. */
export function smsProvider(): SmsProvider {
  return process.env.TERMII_API_KEY ? termiiProvider() : twilioProvider();
}

// --- Resend -----------------------------------------------------------------

export function resendProvider(): EmailProvider {
  return {
    name: "resend",
    async send({ to, subject, text, html }) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "Docket <notifications@docket.app>",
          to: [to],
          subject,
          text,
          ...(html ? { html } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`resend send failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}

export function emailProvider(): EmailProvider {
  return resendProvider();
}
