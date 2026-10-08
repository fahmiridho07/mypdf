# Claude Startups application, draft (DO NOT SUBMIT)

Prepared 2026-10-08 from https://claude.com/programs/startups.
Submission is an owner controlled gate: it needs human authentication in the
Claude Console and truthful company details. Nothing here has been submitted.

## Eligibility check (honest)

- MyPDF is a solo open source project, not an incorporated company. The
  program accepts bootstrapped projects with no VC funding, but review is
  manual and acceptance is not automatic.
- The application needs a company email matching the website domain. That
  email does not exist yet, see Email setup below.
- Do not present MyPDF as an incorporated company, do not invent users,
  revenue, or AI features. Everything below is factual today.

## Draft answers

**Product.** MyPDF is a free, open source, offline Windows desktop app that
handles everyday PDF work (merge, split, compress, convert, OCR, and more)
without uploads, accounts, or tracking. AGPL 3.0, built with React, Tauri,
and Python. Product direction is an intelligent document workspace for
small team paperwork (intake, classify, extract, validate), with the Smart
Intake experiment as the first workflow prototype; the shipped app remains
a local PDF toolkit.

**Customer problem.** People handling sensitive documents must choose between
shady online converters (uploads leave the machine) and expensive proprietary
suites. MyPDF does the same chores locally, in Indonesian and English.

**Traction.** None to report yet. v0.3.0 is publicly released
(`MyPDF_0.3.0_x64-setup.exe`, 94.8 MB, plus MSI and Linux/macOS builds);
installer download counts, when they exist, count downloads, not users. Do
not quote them as users.

**AI use case (first POC live tested, not shipped).** No AI features exist
in the app today by design: the core promise is offline processing. Smart
Intake (`experiments/smart-intake`) runs an end to end invoice workflow:
batch PDFs in, local text extraction with OCR fallback for scans, field
extraction through a provider interface, validation flags, interactive
human review with correction, CSV plus organized copies. A Gemini provider
was tested live on 2026-10-08: 2 synthetic invoices extracted correctly
before the free tier key hit HTTP 429 quota exhaustion, so token, latency,
and accuracy numbers are still unmeasured; the Claude provider is
implemented but untested. All cloud use is opt in with explicit consent.
Next step with credits: keyed live runs on diverse documents. Do not apply
as an AI product; apply as a local first tool with a working workflow
prototype exploring one consented AI extension.

**Prototype status.** v0.3.0 desktop app publicly released; Smart Intake AI
experiment on main with mock plus Gemini providers. Public repo:
https://github.com/fahmiridho07/mypdf

**Business model.** Free and open source today; no revenue, no pricing, no
incorporation. Any future model (supporter builds, managed team features) is
undecided and must stay AGPL compatible.

**Founder.** Solo developer, final year Information Systems student, building
in the open. No team, no funding.

## Email setup (owner action, required before applying)

Target address: `founder@fahmiridho.me`.

Verified 2026-10-08: the domain MX records point to
`route1/2/3.mx.cloudflare.net`, i.e. Cloudflare Email Routing. That is
mail routing/forwarding, not a full mailbox: it can receive and forward
inbound mail, but it cannot send from the domain by itself.

- Routing (what exists): Cloudflare Email Routing can deliver
  `founder@fahmiridho.me` to a personal inbox. Verify the route plus a
  test inbound message.
- Full mailbox (what the application needs): an address you can also send
  from, with SPF/DKIM passing. That requires either a mailbox provider
  for the domain or an SMTP sending service wired to it. Forwarding alone
  is not enough; the Console accepts a domain address you can send from.

Email status: ROUTING ONLY (Cloudflare), mailbox send capability NOT
CONFIRMED. Record the send test result here before applying.

## Submission gate

Apply only when: v0.3.0 is publicly downloadable, fahmiridho.me/mypdf/ is
live, the domain email sends and receives, and every answer above is still
true. The owner signs in to
https://platform.claude.com/offers/startups-application and submits by hand.
