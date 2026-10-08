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
and Python.

**Customer problem.** People handling sensitive documents must choose between
shady online converters (uploads leave the machine) and expensive proprietary
suites. MyPDF does the same chores locally, in Indonesian and English.

**Traction.** None to report yet. v0.3.0 is in release QA; installer download
counts, when they exist, count downloads, not users. Do not quote them as
users.

**AI use case (roadmap, first POC done, not shipped).** No AI features exist
in the app today by design: the core promise is offline processing. A first
proof of concept, Smart Intake (`experiments/smart-intake`, PR #4), runs an
end to end invoice workflow: batch PDFs in, local text extraction, field
extraction through a provider interface, validation flags, human review,
CSV plus organized copies. The default provider is local and offline; the
Claude provider is implemented but untested (no API key here) and strictly
opt in with explicit consent. Next step with credits: keyed live runs to
measure field accuracy, latency, tokens, and cost on diverse documents. Do
not apply as an AI product; apply as a local first tool with a working
workflow prototype exploring one consented AI extension.

**Prototype status.** Working desktop prototype, v0.3.0 pending final clean
Windows QA. Public repo: https://github.com/fahmiridho07/mypdf

**Business model.** Free and open source today; no revenue, no pricing, no
incorporation. Any future model (supporter builds, managed team features) is
undecided and must stay AGPL compatible.

**Founder.** Solo developer, final year Information Systems student, building
in the open. No team, no funding.

## Email setup (owner action, required before applying)

1. In the fahmiridho.me domain provider, create a real mailbox (not a
   forwarder), e.g. `halo@fahmiridho.me` or `fahmi@fahmiridho.me`.
2. Confirm it can both receive and send: mail yourself from another account,
   reply, and check SPF/DKIM pass.
3. Forwarding alone is not enough; the Console accepts a domain address you
   can send from. Record the verification result here before applying.

Email status: NOT CONFIGURED.

## Submission gate

Apply only when: v0.3.0 is publicly downloadable, fahmiridho.me/mypdf/ is
live, the domain email sends and receives, and every answer above is still
true. The owner signs in to
https://platform.claude.com/offers/startups-application and submits by hand.
