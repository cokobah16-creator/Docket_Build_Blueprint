-- Docket — seed: Attorneys Klinique as tenant #1.
-- Run once after the migrations. Idempotent on the firm slug.
--
-- On a database that already has this firm, a re-run changes nothing in the firm row or in any
-- service it already has. Set the legal name, RC/BN, TIN, contact details, the booking button's
-- wording and the 45-minute consultation's name, description and fee in /firm/admin/settings and
-- /firm/admin/services first. Set the TIN before the VAT rate, and apply migration 59 first: the
-- client's invoice prints the TIN on any invoice that carries VAT, through invoice_issuer(). A
-- re-run then only adds the 60- and 90-minute consultations and their intake forms.
--
-- Klinique is a firm on Docket, not a special case: this file only supplies
-- the DATA a firm owner would otherwise enter at /firm/start and in
-- /firm/admin (brand, policies, services), and calls the same
-- seed_firm_defaults() every self-registered firm gets. Nothing here is
-- referenced by application code.

-- Status 'active' + verified_at: the launch tenant is verified by the founders themselves. Its owner accounts are
-- attached at onboarding exactly like any other firm's (docs/ONBOARDING_A_FIRM.md step 4), and its Paystack
-- subaccount goes into firms.paystack_subaccount before the first booking (step 5).
--
-- The legal name and number are as on the firm's CAC certificate (business name BN 9868241), so
-- the "Before you pay" breakdown names who the client is paying exactly as the register does. The
-- TIN is printed on any invoice that carries VAT: on the firm's own invoice screen, and on the
-- client's invoice page and PDF through invoice_issuer() (migration 59). firm_public never exposes
-- it (migration 51).
insert into firms (slug, name, legal_name, rc_number, tin, reference_prefix, timezone, default_currency, vat_rate, status, verified_at, brand, policies)
values (
  'attorneys-klinique',
  'Attorneys Klinique',
  'Attorneys Klinique',
  'BN 9868241',
  '2623771411110',
  'AK',
  'Africa/Lagos',
  'NGN',
  -- Prices below are the fee before VAT, and book_appointment() adds VAT at this rate when it
  -- invoices a booking, so a client pays 7.5% on top of each fee (the owner, 2 November 2026).
  7.50,
  'active', now(),
  jsonb_build_object(
    'tagline', 'Professional, trustworthy, discreet legal services',
    'colours', jsonb_build_object('primary', '#0F2A44', 'accent', '#B08D57', 'surface', '#F7F5F0'),
    'fonts',   jsonb_build_object('heading', 'Fraunces', 'body', 'Inter'),
    -- The Urgent help page and the contact page offer these; WhatsApp is the same line.
    'contact', jsonb_build_object('email',    'attorneysklinique@gmail.com',
                                  'phone',    '+234 814 321 2579',
                                  'whatsapp', '+234 814 321 2579',
                                  'address',  'No. 2 Joshua Madaki Close, Opposite Eterna Fuel Station, Abuja'),
    'cta',     'Book a consultation'
  ),
  jsonb_build_object(
    'cancellation', jsonb_build_object('version', '2026-09', 'free_cancel_hours', 24,
                                       'text', 'Consultations may be rescheduled or cancelled free of charge up to 24 hours before the appointment.'),
    'disclaimer',   jsonb_build_object('version', '2026-09',
                                       'text', 'Submitting an inquiry or booking a consultation does not create a lawyer-client relationship. Formal legal advice and representation begin only on a signed engagement.'),
    -- terms and privacy stay '0-draft' (not shown to clients) until the firm publishes text or a URL
    'terms',        jsonb_build_object('version', '0-draft', 'url', null, 'text', 'To be published by the firm before go-live.'),
    'privacy',      jsonb_build_object('version', '0-draft', 'url', null, 'text', 'To be published by the firm before go-live.')
  )
)
on conflict (slug) do nothing;

-- service catalogue (master prompt §5). Three consultations are active, at the fees the owner set on
-- 2 November 2026: ₦30,000, ₦45,000 and ₦60,000 for 45, 60 and 90 minutes, before VAT. With VAT at
-- 7.5% a client pays ₦32,250, ₦48,375 and ₦64,500. Attorneys Klinique's own records put the
-- Remuneration Order's minimum for a consultation at ₦30,000 before VAT, so a discount on the
-- 45-minute fee may need the NBA Remuneration Committee's approval first.
-- Every other row is a PLACEHOLDER price and stays inactive until the firm sets its fee.
-- The three consultations share a name because every list already adds the length ("· 45 minutes")
-- and the invoice line adds "(45 min)". The 45-minute one keeps the slug 'legal-consultation',
-- which seed_firm_defaults() and the design fixture look up.
insert into services (firm_id, slug, name, description, price_minor, currency, duration_min, lawyer_category, requires_prepayment, virtual_available, is_active, sort)
select f.id, s.slug, s.name, s.description, s.price_minor, 'NGN', s.duration_min, s.category, true, true, s.is_active, s.sort
from firms f,
     (values
       ('legal-consultation',     'Legal consultation',                     'Quick advice on one issue from an Attorneys Klinique lawyer.',                    3000000, 45, 'general',    true,  10),
       ('legal-consultation-60',  'Legal consultation',                     'More time to go through one matter and its documents with an Attorneys Klinique lawyer.', 4500000, 60, 'general', true, 11),
       ('legal-consultation-90',  'Legal consultation',                     'For complex matters, or a matter with several parts, with an Attorneys Klinique lawyer.', 6000000, 90, 'general', true, 12),
       ('corporate-commercial',   'Corporate & Commercial Law',             'Advisory on company structuring, commercial agreements and governance.',          5000000, 45, 'corporate',  false, 20),
       ('contract-review',        'Contract Review & Drafting',             'Review, negotiation and drafting of contracts and agreements.',                   5000000, 45, 'corporate',  false, 30),
       ('property-real-estate',   'Property & Real Estate',                 'Title searches, conveyancing, Governor''s Consent and property disputes.',        5000000, 45, 'property',   false, 40),
       ('litigation',             'Litigation',                             'Representation and advisory in civil and commercial litigation.',                 5000000, 45, 'litigation', false, 50),
       ('family-law',             'Family Law',                             'Marriage, custody, maintenance and related family matters.',                      5000000, 45, 'family',     false, 60),
       ('employment-labour',      'Employment / Labour Law',                'Employment contracts, workplace disputes and compliance.',                        5000000, 45, 'employment', false, 70),
       ('debt-recovery',          'Debt Recovery',                          'Demand, negotiation and enforcement of outstanding debts.',                       5000000, 45, 'litigation', false, 80),
       ('intellectual-property',  'Intellectual Property',                  'Trademark, copyright and IP protection and enforcement.',                         5000000, 45, 'ip',         false, 90),
       ('regulatory-compliance',  'Regulatory / Compliance',                'Licensing, regulatory filings and compliance programmes.',                        5000000, 45, 'regulatory', false, 100),
       ('immigration-advisory',   'Immigration-related Legal Consultancy',  'Advisory on immigration-related legal matters.',                                  5000000, 45, 'immigration',false, 110),
       ('company-incorporation',  'Company Incorporation / Corporate Advisory', 'CAC incorporation, post-incorporation filings and corporate advisory.',       5000000, 45, 'corporate',  false, 120),
       ('legal-opinion',          'Legal Opinions',                         'Written legal opinions on specific questions.',                                   5000000, 45, 'general',    false, 130),
       ('mediation-adr',          'Mediation / Dispute Resolution',         'Mediation and alternative dispute resolution services.',                          5000000, 45, 'litigation', false, 140)
     ) as s(slug, name, description, price_minor, duration_min, category, is_active, sort)
where f.slug = 'attorneys-klinique'
on conflict (firm_id, slug) do nothing;

-- Klinique's own consultation intake (master prompt §24): conditional questions, minimal data. One copy per
-- consultation length, because the booking wizard picks the form by service. A form with no service would not
-- do: seed_firm_defaults() would then add its own form for the 45-minute consultation, and that one would win.
insert into intake_forms (firm_id, service_id, name, schema, is_active)
select f.id, s.id, 'Consultation intake',
  jsonb_build_object('questions', jsonb_build_array(
    jsonb_build_object('key','client_type',   'type','choice', 'label','Are you consulting as an individual or for a business?',
                       'options', jsonb_build_array('Individual','Business'), 'required', true),
    jsonb_build_object('key','company_name',  'type','text',   'label','Company name', 'required', true,
                       'show_if', jsonb_build_object('question','client_type','equals','Business')),
    jsonb_build_object('key','company_role',  'type','text',   'label','Your role in the company',
                       'show_if', jsonb_build_object('question','client_type','equals','Business')),
    jsonb_build_object('key','area',          'type','choice', 'label','What does your matter concern?', 'required', true,
                       'options', jsonb_build_array('Property or land','Business or contracts','Family','Employment','Debt','Immigration','Intellectual property','Regulatory','Other')),
    jsonb_build_object('key','property_location', 'type','text', 'label','Where is the property located (state and area)?',
                       'show_if', jsonb_build_object('question','area','equals','Property or land')),
    jsonb_build_object('key','property_documents', 'type','choice', 'label','Which documents do you hold?',
                       'options', jsonb_build_array('Certificate of Occupancy','Deed of Assignment','Survey plan','Governor''s Consent','None yet'),
                       'multiple', true,
                       'show_if', jsonb_build_object('question','area','equals','Property or land')),
    jsonb_build_object('key','issue_summary', 'type','longtext', 'label','Briefly describe your legal issue', 'required', true, 'max_length', 2000),
    jsonb_build_object('key','urgency',       'type','choice', 'label','How urgent is this?',
                       'options', jsonb_build_array('Within days','Within weeks','No fixed deadline')),
    jsonb_build_object('key','other_lawyer',  'type','choice', 'label','Is another lawyer currently handling this?',
                       'options', jsonb_build_array('No','Yes')),
    jsonb_build_object('key','documents',     'type','file',   'label','Upload any relevant documents (optional)', 'max_files', 5),
    jsonb_build_object('key','how_heard',     'type','choice', 'label','How did you hear about us?',
                       'options', jsonb_build_array('Referral','Search','Social media','Community or association','Other'))
  )),
  true
from firms f join services s on s.firm_id = f.id
  and s.slug in ('legal-consultation', 'legal-consultation-60', 'legal-consultation-90')
where f.slug = 'attorneys-klinique'
  and not exists (select 1 from intake_forms i where i.firm_id = f.id and i.service_id = s.id);

-- Finally the scaffold every firm receives — matter statuses, and a consultation service + intake form
-- only where the firm has none (Klinique's own were inserted above, so only the statuses land here).
select seed_firm_defaults(id) from firms where slug = 'attorneys-klinique';
