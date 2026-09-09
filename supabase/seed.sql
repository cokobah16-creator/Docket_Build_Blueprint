-- Docket seed — tenant #1: Attorneys Klinique.
-- Everything here is data, not code: brand, policies, matter statuses,
-- services and the consultation intake form. Edit brand, policies, vat_rate
-- and prices before launch (blueprint §14 — decisions still open).
-- Idempotent: safe to re-run.

begin;

insert into public.firms (slug, name, brand, policies, vat_rate, currency, timezone, reference_prefix)
values (
  'klinique',
  'Attorneys Klinique',
  '{
    "colours": {
      "primary": "#1F2A44",
      "secondary": "#B08D57",
      "accent": "#2E7D6B",
      "background": "#FAF8F5",
      "surface": "#FFFFFF",
      "text": "#1A1A1A",
      "muted": "#6B7280"
    },
    "fonts": {"heading": "Fraunces", "body": "Inter"},
    "logo_path": null,
    "tagline": "Counsel you can reach.",
    "contact": {
      "email": "hello@attorneysklinique.com",
      "phone": "+2340000000000",
      "address": "Lagos, Nigeria"
    }
  }'::jsonb,
  '{
    "terms_version": "2026-09-01",
    "privacy_version": "2026-09-01",
    "cancellation": {
      "version": "2026-09-01",
      "text": "You may cancel or reschedule up to 24 hours before your consultation for a full refund or a free rebooking. Cancellations inside 24 hours are handled at the firm''s discretion."
    },
    "disclaimer": "Booking a consultation does not by itself create a lawyer–client relationship; that begins when the firm confirms engagement."
  }'::jsonb,
  0,          -- VAT: 0 until Precious confirms treatment (blueprint §14)
  'NGN',
  'Africa/Lagos',
  'AK'
)
on conflict (slug) do nothing;

-- Everything below keys off the firm id.
do $seed$
declare
  v_firm uuid;
  v_consult uuid;
begin
  select id into v_firm from public.firms where slug = 'klinique';

  -- -------------------------------------------------------------------------
  -- 15 matter statuses (litigation-oriented lifecycle)
  -- -------------------------------------------------------------------------
  insert into public.matter_statuses (firm_id, key, label, description, position, is_terminal)
  values
    (v_firm, 'intake',          'Intake',                 'Enquiry received, engagement being agreed', 1,  false),
    (v_firm, 'engaged',         'Engaged',                'Engagement letter signed, matter opened',    2,  false),
    (v_firm, 'investigation',   'Investigation',          'Gathering facts, documents and evidence',    3,  false),
    (v_firm, 'pre_action',      'Pre-action',             'Demand letters and pre-action protocols',    4,  false),
    (v_firm, 'filed',           'Filed',                  'Originating processes filed at court',       5,  false),
    (v_firm, 'service',         'Service of process',     'Serving processes on the other side',        6,  false),
    (v_firm, 'pleadings',       'Pleadings',              'Exchange of pleadings',                      7,  false),
    (v_firm, 'hearing',         'Hearing',                'Interlocutory applications and hearings',    8,  false),
    (v_firm, 'trial',           'Trial',                  'Trial in progress',                          9,  false),
    (v_firm, 'judgment',        'Judgment',               'Awaiting or entering judgment',              10, false),
    (v_firm, 'appeal',          'Appeal',                 'On appeal',                                  11, false),
    (v_firm, 'enforcement',     'Enforcement',            'Enforcing judgment',                         12, false),
    (v_firm, 'settlement',      'Settlement',             'Negotiating or documenting settlement',      13, false),
    (v_firm, 'on_hold',         'On hold',                'Paused at the client''s or court''s instance', 14, false),
    (v_firm, 'closed',          'Closed',                 'Matter concluded and archived',              15, true)
  on conflict (firm_id, key) do nothing;

  -- -------------------------------------------------------------------------
  -- 14 services. Only Legal Consultation is live; the rest are seeded
  -- inactive at a placeholder ₦50,000 until prices are confirmed.
  -- -------------------------------------------------------------------------
  insert into public.services
    (firm_id, slug, name, description, duration_minutes, price, currency, modes,
     allows_lawyer_choice, is_active, position)
  values
    (v_firm, 'legal-consultation', 'Legal Consultation',
     'A private one-on-one session with a lawyer to understand your situation and your options.',
     30, 50000, 'NGN', '{virtual,in_person,phone}', true, true, 1),
    (v_firm, 'contract-drafting', 'Contract Drafting & Review',
     'Drafting or reviewing agreements so they protect you before you sign.',
     45, 50000, 'NGN', '{virtual,in_person}', true, false, 2),
    (v_firm, 'company-incorporation', 'Company Incorporation',
     'Registering your company with the CAC, from name search to certificate.',
     30, 50000, 'NGN', '{virtual,in_person}', false, false, 3),
    (v_firm, 'trademark-registration', 'Trademark Registration',
     'Protecting your brand name and logo with the Trademarks Registry.',
     30, 50000, 'NGN', '{virtual}', false, false, 4),
    (v_firm, 'property-conveyancing', 'Property Due Diligence & Conveyancing',
     'Title verification and safe transfer of landed property.',
     45, 50000, 'NGN', '{virtual,in_person}', true, false, 5),
    (v_firm, 'tenancy-agreement', 'Tenancy Agreement',
     'Drafting or reviewing tenancy and lease agreements.',
     30, 50000, 'NGN', '{virtual,in_person}', true, false, 6),
    (v_firm, 'debt-recovery', 'Debt Recovery',
     'Recovering what you are owed, from demand letter to enforcement.',
     45, 50000, 'NGN', '{virtual,in_person}', true, false, 7),
    (v_firm, 'civil-litigation', 'Civil Litigation',
     'Representation in civil disputes before Nigerian courts.',
     60, 50000, 'NGN', '{virtual,in_person}', true, false, 8),
    (v_firm, 'criminal-defence', 'Criminal Defence',
     'Defence representation in criminal proceedings.',
     60, 50000, 'NGN', '{virtual,in_person}', true, false, 9),
    (v_firm, 'family-law', 'Family Law (Divorce & Custody)',
     'Divorce, custody, maintenance and related family matters, handled with care.',
     60, 50000, 'NGN', '{virtual,in_person}', true, false, 10),
    (v_firm, 'probate-estate', 'Probate & Estate Administration',
     'Wills, letters of administration and estate distribution.',
     45, 50000, 'NGN', '{virtual,in_person}', true, false, 11),
    (v_firm, 'immigration-advisory', 'Immigration Advisory',
     'Advice on visas, residency and citizenship processes.',
     45, 50000, 'NGN', '{virtual}', true, false, 12),
    (v_firm, 'employment-labour', 'Employment & Labour Advisory',
     'Employment contracts, workplace disputes and terminations.',
     45, 50000, 'NGN', '{virtual,in_person}', true, false, 13),
    (v_firm, 'regulatory-compliance', 'Regulatory Compliance',
     'Keeping your business on the right side of its regulators.',
     45, 50000, 'NGN', '{virtual}', false, false, 14)
  on conflict (firm_id, slug) do nothing;

  select id into v_consult from public.services
  where firm_id = v_firm and slug = 'legal-consultation';

  -- -------------------------------------------------------------------------
  -- Consultation intake form (field types: text, longtext, choice, multiple,
  -- file; show_if for conditional fields)
  -- -------------------------------------------------------------------------
  if not exists (
    select 1 from public.intake_forms
    where firm_id = v_firm and service_id = v_consult and is_active
  ) then
    insert into public.intake_forms (firm_id, service_id, name, version, schema, is_active)
    values (
      v_firm, v_consult, 'Consultation intake', 1,
      '[
        {"key": "topic", "type": "choice", "label": "What is your consultation about?",
         "required": true,
         "options": ["Business or contracts", "Property or land", "Family",
                     "Employment", "Criminal", "Debt or money owed", "Something else"]},
        {"key": "topic_other", "type": "text", "label": "Tell us the area of law",
         "required": true, "show_if": {"key": "topic", "equals": "Something else"}},
        {"key": "summary", "type": "longtext",
         "label": "Briefly describe your situation", "required": true,
         "help": "A few sentences are enough. Your lawyer reads this before the call."},
        {"key": "urgency", "type": "choice", "label": "How urgent is this?",
         "required": true,
         "options": ["I have a deadline within 7 days", "Within the month", "No fixed deadline"]},
        {"key": "in_court", "type": "choice",
         "label": "Is there already a case in court about this?", "required": true,
         "options": ["Yes", "No", "Not sure"]},
        {"key": "court_details", "type": "longtext",
         "label": "Which court, and what stage is it at?", "required": false,
         "show_if": {"key": "in_court", "equals": "Yes"}},
        {"key": "goals", "type": "multiple", "label": "What would you like from this consultation?",
         "required": false,
         "options": ["Understand my rights", "Review a document", "Know my next steps",
                     "Cost estimate for full representation"]},
        {"key": "documents", "type": "file",
         "label": "Upload any relevant documents (optional)", "required": false,
         "accept": ["application/pdf", "image/jpeg", "image/png"], "max_files": 3}
      ]'::jsonb,
      true
    );
  end if;

  -- -------------------------------------------------------------------------
  -- Public site copy lives in content rows — nothing Klinique-specific in code.
  -- -------------------------------------------------------------------------
  insert into public.content (firm_id, key, locale, body, is_published)
  values
    (v_firm, 'home.hero', 'en', '{
       "title": "Clear legal help, one consultation away.",
       "subtitle": "Book a private session with an Attorneys Klinique lawyer — from your phone, at a time that works for you.",
       "cta": "Book a Consultation"
     }'::jsonb, true),
    (v_firm, 'about.body', 'en', '{
       "title": "About Attorneys Klinique",
       "paragraphs": [
         "Attorneys Klinique is a Nigerian law practice built around one idea: clients should always know where their matter stands.",
         "From your first consultation to the last court date, you get updates in plain language, on your phone, from the lawyers handling your case."
       ]
     }'::jsonb, true),
    (v_firm, 'contact.body', 'en', '{
       "title": "Talk to us",
       "note": "Send a message or book a consultation — we respond within one business day."
     }'::jsonb, true)
  on conflict (firm_id, key, locale) do nothing;
end
$seed$;

commit;
