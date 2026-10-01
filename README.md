# n8n-nodes-eu-pii-redact

An [n8n](https://n8n.io) community node that keeps European personal data out of your AI steps:
it replaces names, EU national ID numbers, IBANs, emails, phones and more with placeholders
like `[PERSON_1]` before text reaches an LLM, and puts the real values back afterwards.

Powered by the [EU PII Redaction API](https://rapidapi.com/JulianJohansen/api/eu-pii-redaction).

## Installation

In n8n: **Settings → Community Nodes → Install** and enter `n8n-nodes-eu-pii-redact`.
See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

You need a RapidAPI key with a plan for the EU PII Redaction API. The
[free plan](https://rapidapi.com/JulianJohansen/api/eu-pii-redaction/pricing) gives 500 requests a month.
Create an **EU PII Redaction API** credential in n8n and paste the key.

## Operations

- **Redact**: replaces personal data in a text. Outputs `redacted` (the text with placeholders),
  `entities` (type, position and placeholder of each finding; national IDs also carry `country`
  and `scheme`), `counts`, and `originals` (placeholder → original value, needed for Restore;
  can be switched off). Mode **Placeholders** or **Mask** (asterisks); optionally only some entity types.
- **Restore**: puts the original values back into a text, e.g. your AI node's answer. Runs locally,
  no API call. Set **Originals** to `{{ $('EU PII Redaction').item.json.originals }}`.

Typical workflow: **Trigger → EU PII Redaction (Redact) → AI node (prompt uses `redacted`) →
EU PII Redaction (Restore)**. The node can also be used as a tool by n8n's AI Agent.

## What it detects

Person names (from evidence: titles, greetings, roles, sign-offs, 140,000 known European first
names), national ID numbers from 21 EU/EEA countries (validated by check digit and birth date),
IBANs, card numbers, EU VAT numbers, emails, international phone numbers and IP addresses.
Rule-based and precise rather than exhaustive: treat it as a strong first layer, not a compliance guarantee.

## Compatibility

Built with `@n8n/node-cli` and tested against n8n-workflow's current API (n8n 1.x).

## Development

```bash
npm install
npm run build && node --test test/node.test.cjs   # unit tests with real API responses
npm run lint
npm run dev                                        # local n8n with the node loaded
```
