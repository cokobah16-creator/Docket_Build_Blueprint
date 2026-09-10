import { termiiSms } from './termii';
import { twilioSms } from './twilio';
import { resendEmail } from './resend';
import type { SmsProvider, EmailProvider } from './types';

// Nigerian lines → Termii; everything else → Twilio.
export function smsProviderFor(phoneE164: string): SmsProvider {
  return phoneE164.startsWith('+234') ? termiiSms() : twilioSms();
}
export function emailProvider(): EmailProvider { return resendEmail(); }
export type { SmsProvider, EmailProvider } from './types';
