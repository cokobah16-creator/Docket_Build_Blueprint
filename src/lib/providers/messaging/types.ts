// Docket — messaging adapters. Templates are rendered by the dispatcher; adapters only deliver.
export interface SmsProvider  { readonly name: string; send(args: { to: string; body: string }): Promise<{ providerRef?: string }>; }
export interface EmailProvider { readonly name: string; send(args: { to: string; subject: string; html: string; text?: string; fromName?: string }): Promise<{ providerRef?: string }>; }
