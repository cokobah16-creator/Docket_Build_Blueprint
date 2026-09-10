# MASTER PROMPT — ATTORNEYS KLINIQUE PARTNER LEGAL PLATFORM

## 1. PROJECT OVERVIEW

Build a secure, modern, professional legal-services web application and mobile-responsive portal for:

**Company:** Attorneys Klinique Law Consultancy (Partnership)
**Industry:** Legal Consultancy / Legal Services
**Primary Market:** Nigeria
**Structure:** A partnership of 7 partners who all pool clients into one firm, need shared visibility into everything happening across the firm, and need to work both from a physical office and virtually.

Primary goal: allow prospective and existing clients to discover legal services, book and pay for consultations, hold secure face-to-face virtual consultations with any partner, upload and manage documents, communicate securely, and track their matters. At the same time, give all 7 partners one connected internal workspace where they can see client intake, matter progress, appointments, documents, payments, and profit sharing data across the whole firm, not just their own clients.

The platform should feel like a premium professional legal service, not a generic appointment booking website, and it should feel like one interconnected firm rather than 7 separate practices sharing a website.

The product should combine the best concepts of:

* A legal practice management system
* A partner facing firm operations dashboard
* A client portal
* A consultation booking platform
* A secure document portal (Google Drive embedded)
* A virtual consultation platform (Google Meet embedded)
* A billing and payment system
* A CRM
* A professional law firm website

---

## 2. BRANDING

**Brand name:** Attorneys Klinique

**Brand positioning:** professional, trustworthy, discreet, modern, accessible, client-focused.

The UI should communicate trust, confidentiality, professionalism, legal expertise, premium service, simplicity, and security. Use a sophisticated legal and corporate visual style. Avoid a flashy startup appearance. Clean, spacious, elegant, and highly usable on mobile.

Create a reusable design system for buttons, forms, cards, modals, tables, navigation, alerts, notifications, badges, status indicators, appointment components, document components, and the video consultation interface.

---

## 3. USER TYPES

Role based authentication and authorization, structured around the partnership.

### A. PUBLIC VISITOR
Can view the website, learn about the firm, view services, view partner profiles, read FAQs and articles, contact the firm, request a consultation, and create an account.

### B. CLIENT
Can register, log in, manage profile, book consultations, select a legal service, select a preferred date and time, pay consultation fees, receive confirmations, join virtual consultations through the embedded Google Meet link, communicate securely, upload and download documents, view matter status, view appointments, view invoices and pay outstanding ones, download receipts, receive notifications, and manage account settings.

Clients belong to the firm, not to an individual partner. A client's file always shows Attorneys Klinique as the firm they engaged, even though one or more partners are attached to the matter behind the scenes.

### C. PARTNER
There are 7 partner accounts in the system. Each partner has an individual name, profile, and login, but every partner has equal visibility into firm wide operations unless the firm later decides to restrict something.

Partner name slots to configure now (fill in real names as available, leave placeholders where not yet known):

1. Ola
2. Benjamin
3. Mikrabel
4. Meke
5. Mcking
6. Ada
7. Partner 7 (placeholder, name to be added later)

Each partner can:

* Log in securely, with 2FA available
* View their own assigned clients and matters
* View all clients and matters across the firm through the shared firm view (see section 4)
* Manage their own availability for bookings
* Conduct virtual consultations through embedded Google Meet
* Enter consultation notes, both client visible and internal
* Upload and organize documents through embedded Google Drive
* Send secure messages to clients and to other partners
* Update matter status and add tasks and deadlines
* Generate invoices and see payment status
* See which matters they originated versus which they are handling, for profit sharing purposes
* Receive notifications relevant to their matters and to firm wide events

### D. ADMINISTRATOR
One or more partners, or a designated office manager, can hold admin rights on top of the partner role. Full access to users, clients, partners, appointments, matters, documents, payments, invoices, services, availability, notifications, content, reports, system settings, audit logs, and permissions.

---

## 4. THE FIRM WIDE SHARED VIEW (CORE DIFFERENTIATOR)

This is the feature that makes the platform feel interconnected rather than like 7 separate mini practices. Build a **Firm Overview** space visible to every partner and admin.

It should show, in real time:

* Every active client and matter across the firm, regardless of which partner originated or is handling it
* Who originated each client and who is currently handling each matter
* A live firm calendar showing every partner's appointments side by side, so partners can see who is busy and who is free
* A shared activity feed showing recent events across the firm: new client intake, documents uploaded, payments received, matters closed, notes added
* Firm wide totals: active matters, consultations this week, revenue this month, outstanding invoices, unread client messages
* A searchable client and matter directory open to all partners, respecting the rule that client information belongs to the firm

Each partner's individual dashboard (their personal home screen) shows their own workload first, with a clearly visible link or panel into the Firm Overview so nothing feels hidden between partners.

---

## 5. PUBLIC WEBSITE

Professional public facing website.

**Homepage** should include the Attorneys Klinique logo, navigation, hero section, a clear "Book a Consultation" call to action, a "Speak With a Partner" call to action, an overview of services, why choose Attorneys Klinique, a virtual consultation section, how it works, areas of practice, partner profiles for all 7 partners, testimonials, FAQs, contact information, and footer.

---

## 6. LEGAL SERVICES

Admin configurable service catalog, not hard coded. Example services: Legal Consultation, Corporate and Commercial Law, Contract Review and Drafting, Property and Real Estate, Litigation, Family Law, Employment and Labour Law, Debt Recovery, Intellectual Property, Regulatory and Compliance, Immigration related consultancy, Company Incorporation and Corporate Advisory, Legal Opinions, Mediation and Dispute Resolution.

Each service should have a name, description, price, duration, which partner category can handle it, availability, whether payment is required before booking, and whether virtual consultation is available.

---

## 7. CLIENT REGISTRATION

Collect only what is necessary: full name, email, phone number, address, state, country, client type (individual or business), company name where applicable, and preferred communication method. Include terms of service, privacy notice, consent controls, account verification, password creation, and secure authentication.

---

## 8. CLIENT DASHBOARD

After login, the client sees: a welcome panel, quick actions (book consultation, join upcoming consultation, upload document, message the firm, make payment), upcoming appointment details with a join button linking to the embedded Google Meet session, my matters, recent documents, payment and invoice summary, and notifications.

---

## 9. CONSULTATION BOOKING SYSTEM

Client selects a legal service, consultation type, a specific partner or "any available partner," a date, an available time slot, duration, and payment method. Before confirming, show the assigned partner, date, time, timezone, duration, price, and cancellation policy.

After booking, generate a unique appointment ID. Appointment status values: Pending, Awaiting Payment, Confirmed, Rescheduled, Completed, Cancelled, No show.

The booking engine must check the availability of all 7 partners and prevent double booking, and it should let a client request "any available partner" if they do not have a preference.

---

## 10. PAYMENT SYSTEM

Primary payment provider: Paystack, architected so another provider such as Flutterwave can be added later. Support card payments, bank transfer where supported, and other available Paystack methods.

Workflow: booking, then payment, then server side payment verification, then appointment confirmation. Never mark an appointment as paid based only on frontend confirmation.

Store transaction ID, amount, currency, payment status, client, appointment, invoice, and timestamp. Default currency is NGN. Architect for future multi currency support.

Every payment record must also capture which partner originated the client and which partner is handling the matter, so the data feeds directly into the firm's profit sharing calculations without manual reconciliation.

---

## 11. VIRTUAL FACE TO FACE CONSULTATION (GOOGLE MEET EMBEDDED)

Use the Google Meet API / Google Calendar API integration to generate and embed a unique Google Meet link for every confirmed appointment, rather than building custom video infrastructure.

Flow:

Booking confirmed, appointment reminder sent, client opens appointment, client selects "Join Consultation," the embedded Google Meet session loads inside the portal (or opens Meet directly if embedding is restricted by Google's policies), client and partner join the same session tied to that specific appointment.

Requirements:

* Each Meet link must be uniquely generated per appointment through the calendar integration, not a single static recurring link
* Meet links must only be visible to the client and partner attached to that specific appointment
* Store the Meet link and associated calendar event ID against the appointment record
* Reminders sent to both client and partner should include the Meet link
* Do not record consultations by default. If recording through Meet is ever enabled, it must require explicit informed consent, visible recording status, secure storage, restricted access, and a defined retention policy

---

## 12. VIRTUAL WAITING EXPERIENCE

Before the appointment time, show the client an appointment details screen with the partner's name, appointment time, expected duration, matter or service, and a "Join Consultation" button that activates once the Meet session is scheduled to begin. Display "Your consultation with Attorneys Klinique is about to begin" and, if the partner has not yet joined, "Waiting for your lawyer to join."

---

## 13. CONSULTATION NOTES

After a consultation, the partner can create notes tied to the appointment and matter: summary, advice provided, follow up actions, and internal notes. Client visible notes and internal notes must be clearly separated, and internal notes must never be exposed to the client or to other clients.

---

## 14. MATTER / CASE MANAGEMENT

Each matter should have a matter ID, title, client, originating partner, handling partner or team, practice area, description, status, opening date, important dates, next action, linked documents, messages, appointments, invoices, tasks, and an activity timeline.

Example statuses: New Inquiry, Consultation Scheduled, Consultation Completed, Awaiting Documents, Under Review, In Progress, Awaiting Client, Awaiting Third Party, Completed, Closed. Admins can customize statuses.

Because clients are pooled across the firm, the matter record must always show both the originating partner and the handling partner as separate fields, since this is what feeds the firm's profit sharing structure.

---

## 15. MATTER TIMELINE

Each matter has a chronological timeline of events, for example a consultation completed, a document uploaded by the client, a document reviewed by the partner, a draft opinion uploaded, a follow up consultation scheduled. This gives the client a clear sense of progress and gives partners a shared history without needing to ask each other what happened.

---

## 16. SECURE DOCUMENT MANAGEMENT (GOOGLE DRIVE EMBEDDED)

Instead of building custom file storage, integrate Google Drive as the document backbone.

* Each matter gets its own dedicated folder structure inside a shared, permission controlled Google Drive space belonging to the firm, not to any individual partner's personal Drive
* Use the Google Drive API and Google Picker API to let clients upload documents directly into their matter's folder from inside the portal
* Use Drive's native preview inside an embedded viewer so documents can be opened without leaving the portal
* Control access through Drive sharing permissions tied to the matter: the client, the originating partner, the handling partner, and admins should have access; other clients must never have access to another client's folder
* Categorize folders by matter type: contracts, identification documents, court documents, evidence, property documents, company documents, letters, agreements
* Apply file size and file type restrictions at upload
* Because this is Google Drive, versioning, renaming, and folder organization come largely built in, but the portal should still track and display uploader identity and timestamp against each file for audit purposes

---

## 17. SECURE CLIENT AND PARTNER MESSAGING

Internal messaging system. A client can message their assigned partner or the firm generally. Partners can also message each other, since they are working from a shared client pool.

Features: one to one conversations, matter linked conversations, document attachment (linking directly to the relevant Drive file), timestamps, read and unread status, and notifications. Messages must never be publicly accessible. Admins have controlled access based on role and matter permissions.

---

## 18. NOTIFICATIONS

Channels: in app, email, SMS, and WhatsApp where legally and technically appropriate.

Events: appointment confirmation, appointment reminder, payment confirmation, invoice issued, document uploaded, document requested, new message, matter update, consultation starting soon, appointment cancellation or rescheduling, and firm wide events for partners such as a new client intake or a matter reassignment.

Allow clients and partners to manage their own notification preferences.

---

## 19. APPOINTMENT REMINDERS

Send reminders 24 hours before, 1 hour before, 10 minutes before, and at the time of the appointment, with the Google Meet join link included from the 1 hour reminder onward. Avoid excessive notifications.

---

## 20. PARTNER DASHBOARD

Each partner's personal workspace shows today's schedule, their own active and pending matters with deadlines, their tasks, unread messages, recently uploaded or awaiting review documents, and their outstanding invoices and payments. It also shows a clearly visible entry point into the Firm Overview described in section 4.

---

## 21. PARTNER AVAILABILITY

Each of the 7 partners defines their own working days, working hours, breaks, consultation duration, unavailable days, holidays, and maximum consultations per day. The booking engine must prevent double booking across all 7 partners simultaneously. Use each partner's configured timezone, store timestamps in UTC, and display them according to the viewer's timezone.

---

## 22. ADMIN DASHBOARD

Show total clients, active matters, upcoming consultations, completed consultations, revenue, outstanding invoices, new inquiries, pending documents, and unread messages, broken down both firm wide and per partner. Include charts for consultations over time, revenue over time, clients by service, matter status, payment status, and a per partner origination versus execution breakdown to support profit sharing conversations.

---

## 23. INVOICING

Invoices should include an invoice number, client, matter, service, description, amount, applicable taxes, due date, status, and payment history. Statuses: Draft, Issued, Partially Paid, Paid, Overdue, Cancelled. Generate downloadable PDF invoices and receipts. Every invoice line should be traceable back to the originating and handling partner for that matter.

---

## 24. CLIENT INTAKE

Configurable intake questionnaire per service, supporting text responses, file uploads through the embedded Drive uploader, multiple choice, and conditional questions (for example, business related questions appear only if the client selects "Business"). Collect only necessary information.

---

## 25. CONFLICT CHECK WORKFLOW

When a new matter is created, search existing clients, companies, opposing parties, and related entities across the whole firm's records, since clients are pooled. Flag potential matches for partner or admin review rather than auto declaring a conflict. Display "Potential conflict identified, review required." Only authorized staff see internal conflict information.

---

## 26. SEARCH

Global search across clients, matters, documents (via Drive metadata), appointments, invoices, and messages, respecting permissions at all times. A partner should be able to search the whole firm's client base given the pooled model, but a client must never see another client's data.

---

## 27. AUDIT LOG

Immutable audit records for login and logout, account creation, password and security changes, document upload and download and deletion (mirrored from Drive activity where possible), matter changes, appointment changes, payment events, invoice changes, permission changes, and administrative actions. Record user, action, timestamp, resource, and relevant metadata.

---

## 28. SECURITY

HTTPS, secure authentication, strong password hashing, session management, role based access control, principle of least privilege, server side authorization, input validation, rate limiting, CSRF and XSS protection, SQL injection prevention, secure headers, encryption in transit and at rest where supported, secure secrets management, audit logs, and a backup strategy. Never store payment card details, rely on Paystack tokenization instead. Never expose API keys, Drive credentials, or Meet integration secrets in frontend code. Never rely solely on frontend authorization.

---

## 29. TWO FACTOR AUTHENTICATION

Support 2FA for all 7 partners and any admin accounts, using an authenticator app, email OTP, or SMS OTP, with authenticator based security preferred for privileged accounts.

---

## 30. PRIVACY AND NIGERIAN COMPLIANCE

Design with the Nigeria Data Protection Act 2023 in mind: privacy notice, consent management, data minimization, purpose limitation, access controls, data retention controls, data deletion workflows, data breach response capability, and auditability. Note clearly that these features alone do not guarantee legal compliance, and that Nigerian legal and privacy professionals should review the final implementation and policies before launch.

---

## 31. DATA ARCHITECTURE

Use a relational database. Recommended entities: Users, Roles, Permissions, Clients, Partners, Staff, Services, Appointments, Availability, Matters, MatterParticipants (with OriginatingPartnerID and HandlingPartnerID), DriveFolderLinks, MeetSessionLinks, Messages, MessageAttachments, Invoices, InvoiceItems, Payments, ConsultationSessions, ConsultationNotes, Notifications, Tasks, ActivityLogs, ConflictChecks, AuditLogs, ConsentRecords.

Use proper foreign keys and indexes, UUIDs for public facing identifiers, and never expose sequential database IDs publicly.

---

## 32. API ARCHITECTURE

Frontend, then API, then authentication and authorization, then business logic, then database, then external services. External integrations: Paystack, Google Meet and Google Calendar API, Google Drive API, email provider, SMS provider, WhatsApp provider where applicable. Keep integrations modular so providers can be swapped later if needed.

---

## 33. EMAIL SYSTEM

Branded transactional emails for welcome, verify account, appointment confirmation, appointment reminder with Meet link, payment receipt, invoice, new message, document request, matter update, and password reset, all using Attorneys Klinique branding.

---

## 34. MOBILE EXPERIENCE

Fully responsive, mobile first, since most Nigerian clients will access the portal from smartphones. Simple bottom navigation: Home, Appointments, Matters, Messages, Profile. Large tappable buttons, easy forms, easy document upload through the embedded Drive picker, and an easy way to join a Meet consultation.

---

## 35. OPTIONAL MOBILE APP

Architect the backend so native iOS and Android apps can be built later without redesigning the core system. The web application must remain fully functional on its own.

---

## 36. ADMIN SETTINGS

Configurable firm details, logo, contact information, services, consultation fees, the 7 partner profiles, working hours, payment settings, notification settings, cancellation policy, terms, privacy policy, email templates, and SMS templates.

---

## 37. CONTENT MANAGEMENT

Basic CMS for blog and articles, FAQs, practice areas, all 7 partner profiles, testimonials, and announcements, with publish and unpublish controls.

---

## 38. SEO

Semantic HTML, metadata, Open Graph tags, structured data where appropriate, sitemap, robots.txt, fast loading, mobile optimization, and clean URLs, targeting Nigerian legal service searches without making unsupported legal claims.

---

## 39. ACCESSIBILITY

Target WCAG 2.2 AA where practical: keyboard navigation, appropriate contrast, screen reader labels, form validation messages, focus states, and accessible error messages.

---

## 40. ERROR HANDLING

Never expose technical errors to users. Show a friendly message such as "Something went wrong while processing your request. Please try again or contact Attorneys Klinique." Log technical errors privately for admins and developers.

---

## 41. EMPTY STATES

Useful empty states with clear calls to action, for example "No upcoming consultations" paired with "Book a Consultation," or "No documents have been uploaded for this matter" paired with "Upload Document."

---

## 42. DASHBOARD STATUS COLORS

Consistent visual indicators for Pending, Confirmed, Completed, Cancelled, Overdue, Paid, Unpaid, Active, and Closed, with color never used as the only signal.

---

## 43. VIDEO SECURITY (GOOGLE MEET SPECIFIC)

Every Meet link must be uniquely generated per appointment through the Calendar API, never a shared static link. Links must be tied to authenticated appointment records, visible only to the client and partner attached to that appointment, and should not remain valid indefinitely after the matter's need for them has passed. Prevent unauthorized users from joining by keeping join buttons behind authenticated portal access rather than exposing raw Meet URLs anywhere public.

---

## 44. CONSULTATION PRIVACY

No recording by default. If recording through Meet is introduced later, require explicit consent, show recording status clearly, allow clients to decline where appropriate, store recordings securely with restricted access, set a retention policy, and log all access to recordings.

---

## 45. PERFORMANCE

Fast initial load, optimized images, lazy loading, efficient API queries, database indexes, pagination, caching where appropriate, and a CDN for public assets. Ordinary portal functions should work on modest smartphones and slower connections.

---

## 46. TESTING

Test authentication (registration, login, logout, password reset, 2FA), booking (availability across all 7 partners, double booking prevention, cancellation, rescheduling, payment confirmation), payments (successful, failed, webhook verification, duplicate webhook prevention), permissions (a client cannot see another client's matter, a partner's access to the firm wide view respects the pooled model without leaking data to clients, staff only see permitted data, admin has appropriate access), documents (upload, download, permission enforcement through Drive sharing, invalid file handling), and video (authorized access to Meet sessions, unauthorized access blocked, session tied correctly to appointment).

---

## 47. DEVELOPMENT ENVIRONMENT

Frontend: Next.js with TypeScript. UI: Tailwind CSS with an accessible component library. Backend: Node.js with TypeScript. Database: PostgreSQL. Authentication: secure managed authentication or a properly implemented server side solution. Storage: Google Drive API for documents. Payments: Paystack. Video: Google Meet via Google Calendar API. Hosting: a reliable cloud platform. Do not hard code provider specific functionality into the core business logic, so providers can be swapped if needed later.

---

## 48. ENVIRONMENT VARIABLES

All secrets as environment variables, never committed to source control. Examples:

```
DATABASE_URL
PAYSTACK_SECRET_KEY
PAYSTACK_PUBLIC_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_DRIVE_FOLDER_ROOT_ID
GOOGLE_CALENDAR_ID
EMAIL_API_KEY
SMS_API_KEY
```

Provide a `.env.example` file.

---

## 49. DATABASE SECURITY

Row level authorization where appropriate, proper indexes, foreign key constraints, transaction handling, soft deletion for important records, and data retention policies. Never permanently delete critical legal records without an appropriate authorization workflow.

---

## 50. BACKUP AND RECOVERY

Automated database backups, backup monitoring, and a documented recovery procedure. Since documents live in Google Drive, rely on Drive's own versioning and trash retention as a secondary layer, but still document the firm's overall recovery objectives.

---

## 51. BILLING MODEL

Support consultation fees (for example, a 45 minute virtual consultation at a set naira amount), and future flexibility for fixed fee, hourly billing, retainer, and custom quotation models, since not every legal service will bill the same way.

---

## 52. CLIENT JOURNEY

Visitor views the website, selects "Book Consultation," chooses a legal service, creates an account, completes the intake questionnaire, chooses an available date and time with any partner or a specific one, pays the consultation fee, receives confirmation with the Meet link, receives reminders, logs into the portal, joins the consultation through the embedded Meet session, the partner records internal notes, the client receives appropriate follow up, documents are exchanged through the embedded Drive folder, a matter is created if the engagement proceeds, invoices and payments are managed through the portal, the client tracks the matter, and the matter is eventually completed and closed.

---

## 53. CLIENT EXPERIENCE PRINCIPLE

The client should never feel like they are interacting with complicated legal management software. The experience should feel as simple as: tell us what you need, book, pay, meet your lawyer, manage your matter.

---

## 54. PARTNER EXPERIENCE PRINCIPLE

Every one of the 7 partners should be able to run their part of the firm's digital workflow from one dashboard, while always having a clear window into what the other partners and the firm as a whole are doing, so no one is duplicating effort or working blind. Avoid requiring partners to manually copy information between separate systems.

---

## 55. IMPORTANT LEGAL DISCLAIMER

Clearly distinguish general information, legal consultation, formal legal advice, and legal representation. The system must not automatically imply that submitting an inquiry creates a lawyer client relationship. Include configurable disclaimers and engagement terms.

---

## 56. MVP PRIORITY

**Phase 1**

1. Public website with all 7 partner profiles
2. Client registration and login
3. Client dashboard
4. Services
5. Consultation booking across all 7 partners
6. Paystack payments
7. Partner availability
8. Appointment management
9. Google Meet embedded video consultation
10. Google Drive embedded document storage
11. Client and partner messaging
12. Basic matter management with originating and handling partner fields
13. Firm Overview shared dashboard (section 4)
14. Notifications
15. Admin dashboard
16. Basic invoicing
17. Audit logging
18. Security controls

**Phase 2**

* Advanced matter management
* Conflict checking
* Advanced analytics and per partner profit sharing reports
* WhatsApp and SMS integration
* E signatures
* Advanced billing
* Native mobile apps
* Advanced reporting

---

## 57. UI SCREENS TO CREATE

**Public:** Home, About, Services, Service Details, Partners, Partner Profile, FAQs, Articles, Contact, Book Consultation

**Authentication:** Register, Login, Forgot Password, Verify Account, Two Factor Authentication

**Client:** Dashboard, Profile, Appointments, Book Appointment, Appointment Details, Waiting Room, Video Consultation (Meet embed), Matters, Matter Details, Matter Timeline, Documents (Drive embed), Document Details, Messages, Payments, Invoices, Notifications, Settings

**Partner (x7 profiles, one shared UI):** Partner Dashboard, Firm Overview, Calendar, Appointments, Client Details, Matter Management, Consultation Notes, Documents (Drive embed), Messages, Tasks, Availability

**Admin:** Admin Dashboard, Users, Clients, Partners, Services, Appointments, Matters, Documents, Payments, Invoices, Notifications, Reports, Audit Logs, Settings, Content Management

---

## 58. DESIGN REQUIREMENT

Before coding the full application: create the design system, create wireframes, create high fidelity UI for the core screens, ensure desktop and mobile designs exist for each, establish navigation, establish user flows, then implement. All screens must use the same design system and navigation architecture, no disconnected screens.

---

## 59. PRODUCTION REQUIREMENT

Do not build a superficial demo. Build with production architecture in mind. Avoid fake payment success, fake authentication, hard coded appointments, public document URLs, fake video interfaces, hard coded users, frontend only authorization, exposed API keys, and placeholder security. Where a third party service like Paystack, Google Meet, or Google Drive is required, build the real integration architecture and clearly identify the required credentials and configuration.

---

## 60. FINAL DELIVERABLE

1. Fully responsive web application
2. Client portal
3. Partner portal for all 7 partners
4. Admin portal
5. Firm Overview shared dashboard connecting all partners
6. Secure authentication with 2FA
7. Consultation booking across all partners
8. Paystack payment integration
9. Google Meet embedded video consultation
10. Google Drive embedded document management
11. Secure client and partner messaging
12. Matter management with originating and handling partner tracking
13. Notifications
14. Invoicing
15. Audit logging
16. Privacy and security controls
17. Database schema
18. API documentation
19. Environment variable documentation
20. Deployment instructions
21. Testing suite
22. Admin user guide
23. Partner user guide
24. Client user guide

The finished product should look and feel like a premium digital platform belonging to Attorneys Klinique Law Consultancy, built around 7 partners running one connected firm rather than 7 separate practices, not a generic template or a clone of another company's application.

The primary objective is to make it extremely easy for a Nigerian client to go from "I need legal help" to "I have spoken face to face with an Attorneys Klinique partner and my matter is now being handled," while giving every partner full visibility into how the firm is running as a whole.
