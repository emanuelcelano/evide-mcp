![MIT License](https://img.shields.io/badge/license-MIT-purple)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-success)

# EVIDE MCP Server v1.3.0

MCP server connecting AI agents to the [EVIDE External Evidentiary Deposit](https://app.certifywebcontent.com) API.

EVIDE crystallizes AI agent decisions, escalations, and governance states into independently verifiable forensic records -- anchored to a verified human identity, timestamped server-side in UTC, and externalized before consequence propagation begins.

> EVIDE is not an execution-control layer. It is an external evidentiary crystallization layer operating at the responsibility closure boundary.

---

## What's New in v1.3.0

- **EVIDE ANCHOR.** `declarations` on `evide_intake`, `evide_escalate` and `evide_intake_esb`: explicit, attributable, time-bound statements of the operational perimeter (environment, privileges, purpose, tools, prohibited operations, agent configuration) the agent was authorized within, before it acted. EVIDE preserves the declaration only -- it never verifies its correctness, applies it as policy, or compares it against observed behavior.
- **EVIDE Schema 2.1.** Previous versions declared `evide_schema: 2.0` and were rejected by production with `unsupported_schema` on every deposit. If you cloned before July 2026, your copy could not deposit at all.
- **Evidentiary Continuity.** `parent_evide_id`, `chain_type` and `matter_reference` on both deposit tools, with the four refusal codes documented.
- **External Artifacts.** `evidence_references` with structured hash declaration; the `extensions` registry is kept aligned by the client.
- **Epistemic Stabilization Buffer.** Three new tools: `evide_intake_esb`, `evide_buffer_observe`, `evide_buffer_close`.
- **Boundary Readiness aligned with independent gate declaration.** `candidate` is now the default for both tools, and the client no longer fabricates a `readiness_gate`.
- **The client no longer completes declarations that belong to someone else.** `hashed_by`, `readiness_gate`, `unresolved_signals` and `stabilization_score` are never filled in on the caller's behalf: a missing one fails the call rather than being invented.

---

## Prerequisites -- Read Before Installing

> **Both prerequisites are mandatory. The server will not start without them.**

### 1. DAPI -- Verified Identity

EVIDE does not accept anonymous deposits. Every record must be attributable to a verified, non-repudiable human identity.

**DAPI** (Digital Attestation of Personal Identity) is the identity layer that makes every deposit legally attributable. The DAPI number belongs to the human or organization responsible for the AI agent -- not to the agent itself. The agent cannot self-certify.

> **EVIDE does not certify the correctness of the decision itself.
> It certifies the externally reconstructable responsibility and governance conditions present at closure time.**

**How to obtain a DAPI:** [dapi-certification.com](https://dapi-certification.com)

DAPI verification requires: 1 valid identity document, 1 facial photo, 1 audio file with voice, 1 short video. Processing is manual. Allow time before planning your integration.

---

### 2. EVIDE API Key -- Active Subscription

Access to the EVIDE intake API requires an active plan and a dedicated API key (`evd_...`).

**Plans and pricing:** [app.certifywebcontent.com/pricing](https://app.certifywebcontent.com/pricing)

Available plans: Entry (10 intakes/month), Starter (75), Professional (200), Enterprise (500). For volumes above 500 intakes/month, dedicated infrastructure is required -- contact us before activating.

---

## What EVIDE Deposits

Each record anchors:

- the identity of the accountable authority (DAPI-bound owner)
- the execution identity of the agent (architecturally separated from the owner)
- the classification state and operational stability at closure
- the boundary readiness and gate visibility surface
- the human oversight level declared at closure
- unresolved signals that could not be confirmed at crossing time

The server-computed **evidentiary profile** (profile_version: 1.1) includes:

- **Dim 9 -- Forensic Cross-Check** -- continuity inference (classification x runtime_visibility) -- anti-Synthetic-Coherence sensor
- **Dim 10 -- Decision Wave Compression (DWC)** -- oversight throughput boundary detection
- **Dim 11 -- Formal Accountability Collapse (FAC)** -- authority fragmentation detection

> **Important:** The evidentiary profile contains inferred governance signals.
> These signals are probabilistic governance indicators, not judicial determinations or accusations of misconduct.
> A `detected` or `critical` state for DWC or FAC indicates a structural condition present at closure time -- it does not constitute a finding of wrongdoing by any party.

---

## Installation

```bash
git clone https://github.com/emanuelcelano/evide-mcp
cd evide-mcp
npm install
```

**Node.js >= 18 required.**

---

## Configuration

Add to your MCP client configuration (`claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "evide": {
      "command": "node",
      "args": ["/path/to/evide-mcp/index.js"],
      "env": {
        "EVIDE_API_KEY":      "evd_your_key_here",
        "EVIDE_DAPI_NUMBER":  "0123456789",
        "EVIDE_OWNER_ID":     "your_owner_id",
        "EVIDE_OWNER_ROLE":   "AI System Operator",
        "EVIDE_AGENT_SYSTEM": "MyAgentSystem",
        "EVIDE_AGENT_ID":     "agent_xyz"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `EVIDE_API_KEY` | **Yes** | Your EVIDE API key (`evd_...`) |
| `EVIDE_DAPI_NUMBER` | **Yes** | Your 10-digit DAPI number |
| `EVIDE_OWNER_ID` | **Yes** | Your identifier in the source system |
| `EVIDE_OWNER_ROLE` | No | Role description. Default: `AI System Operator` |
| `EVIDE_AGENT_SYSTEM` | No | Agent system name. Default: `Unknown Agent System` |
| `EVIDE_AGENT_ID` | No | Agent instance identifier. Default: `agent_unspecified` |

---

## Tools

### `evide_intake`
Deposit a finalized AI decision as an evidentiary record.

```json
{
  "source_reference": "CDR-2026-00421",
  "decision_type": "candidate_evaluation",
  "decision_summary": "Candidate approved for second round interview.",
  "classification_status": "stable",
  "threshold_status": "met",
  "boundary_status": "candidate",
  "human_oversight_level": "L2"
}
```

**Optional external artifacts** (`evidence_references`):

```
{
  "source_reference": "CDR-2026-00423",
  "decision_type": "claim_assessment",
  "decision_summary": "Claim rejected: documentation inconsistent with policy terms.",
  "evidence_references": [
    {
      "artifact_type": "document",
      "pointer": "s3://evidence-store/claim-8812/policy.pdf",
      "declared_origin": "policy_management_system",
      "declared_relationship": "supporting_document",
      "declared_retention_status": "persistent_storage",
      "hash_algorithm": "sha256",
      "hash_value": "9f2c7a1b4e6d...",
      "hash_scope": "full_file",
      "hashed_by": "policy_management_system"
    }
  ]
}
```

EVIDE anchors the **declaration** that an artifact exists — the file itself is never uploaded, and EVIDE never computes or verifies its hash. That is why `hashed_by` is mandatory whenever a hash is declared: an anchored digest with no stated provenance would be worthless. The client validates this before the request leaves, so a missing field produces a message naming it rather than a generic server rejection. Nothing is inferred: `hashed_by` is never filled in with the agent identity, because claiming the agent computed a digest it merely relayed would be a false provenance claim.

Declaring the array automatically sets `extensions: ["evidence_references"]`. That registry is opt-in in both directions — a block present but undeclared is rejected, and a declaration with no content is rejected too — so the client keeps the two aligned by construction.

**Optional operational perimeter declarations** (`declarations`, EVIDE ANCHOR):

```
{
  "source_reference": "CDR-2026-00424",
  "decision_type": "operational_perimeter_declaration",
  "decision_summary": "Environment classification declared before agent action.",
  "declarations": [
    {
      "declaration_type": "environment_classification",
      "declared_value": "production",
      "declarant": "devops-lead",
      "declared_at": "2026-08-03T16:30:00Z",
      "declared_attribution_status": "attributed"
    }
  ]
}
```

A Declaration is an explicit, attributable, time-bound statement of the operational perimeter (environment, privileges, purpose, tools, prohibited operations, agent configuration) an agent was authorized within, **before** it acted. EVIDE preserves the declaration only — it never verifies its correctness, applies it as policy, or compares it against observed behavior. This is the primitive behind the incident that motivated it: an agent that mistakes a production database for a disposable test environment is exactly the case a declared `environment_classification` makes independently reconstructable after the fact.

This MCP-level schema is deliberately simplified relative to the full API: `declaration_type`, `declared_value`, `declarant`, `declared_at`, `declared_description` and a flattened `declared_attribution_status` are exposed here. Nested `subject_references`, `authority_source.references` and `declared_relations` (declaring that one Declaration supersedes, clarifies, or revokes another) are not — they remain available through the direct intake API for callers who need the nested form.

Declaring the array automatically sets `extensions: ["declarations"]`, using the same opt-in registry as `evidence_references` — both can be declared together in the same deposit.

**Optional chain parameters** (Evidentiary Continuity):

```
{
  "source_reference": "CDR-2026-00422",
  "decision_type": "candidate_evaluation",
  "decision_summary": "Escalation resolved: candidate approved after compliance review.",
  "parent_evide_id": "aed9e966-6f25-4358-b784-b06eff939e91",
  "chain_type": "escalation_resolution",
  "matter_reference": "MATTER-2026-4471"
}
```

The natural use is to pass the `evide_id` returned by an earlier `evide_escalate` as `parent_evide_id` on the deposit that resolves it — producing a declared lineage from "the agent stopped here" to "this is how it was closed".

Chain validation is strict and has no silent fallback. If the parent does not exist, belongs to another evidentiary domain, is in a non-chainable status, or declares a different `matter_reference`, the whole deposit is refused rather than silently starting a new chain. The refusals are `chain_parent_not_found` (422), `chain_parent_not_owned` (**403** — an authorization decision, not a payload error), `chain_parent_invalid_status` (422) and `chain_matter_mismatch` (422).

Returns: `evide_id`, `intake_hash`, `intake_timestamp_utc`, `profile_version`, Forensic Cross-Check state, DWC and FAC states when present, and — when the record continues from another — `chain_position`, `chain_type` and `chain_root_evide_id`.

---

### `evide_escalate`
Crystallize the agent state **before proceeding** at a high-stakes or contestable boundary.

```json
{
  "source_reference": "ESC-2026-00089",
  "agent_state_summary": "Transaction exceeds regulatory threshold. Human review required.",
  "escalation_trigger": "regulatory_threshold",
  "escalation_reason": "Amount exceeds €50,000 -- requires compliance officer approval.",
  "boundary_status": "verified_partial",
  "unresolved_signals": ["compliance_officer_availability", "aml_flag_status"]
}
```

`evide_escalate` accepts the same optional chain, `evidence_references` and `declarations` parameters as `evide_intake`, for the case where one escalation continues from another.

Available triggers: `high_stakes_decision` · `contestable_state` · `legal_ambiguity` · `regulatory_threshold` · `governance_uncertainty` · `semantic_instability` · `human_review_required` · `authority_incoherence`

---

### `evide_owner_info`
Returns the configured owner and agent identity. Does not expose the full API key.

---

### `evide_check`
Returns verification guidance for a previously deposited record.

---

## Epistemic Stabilization Buffer

Three additional tools let an agent drive the full ESB lifecycle:

| tool | what it does |
|---|---|
| `evide_intake_esb` | deposits the closure **and** opens a buffer over it. Returns `buffer_id`. |
| `evide_buffer_observe` | records an intermediate observation while the buffer is open. Callable more than once. |
| `evide_buffer_close` | closes the buffer with a verdict. |

The closure is anchored immediately, exactly as with `evide_intake`: the buffer opens **alongside** it, it does not delay or replace it. What the buffer adds is the trajectory — how the conditions settled over a real window, rather than only what they were at the crossing.

**A real observation window is required.** The server refuses a close occurring less than two seconds after the open, because a buffer that closes instantly observed nothing. The measured window comes back as `window_seconds`. `test_mode: true` bypasses this, and is exposed only because the server accepts it: a buffer closed in test mode did not observe a real window, and the record will not pretend otherwise.

**`stabilization_score` is declared, never computed.** Neither EVIDE nor this client calculates it. Out-of-range values are rejected rather than clamped, because clamping would hide a client error. If you have no basis for a score, omit it — the client does not supply one on your behalf. Same principle already applied to `hashed_by` and `readiness_gate`.

**Phase fields are enforced client-side.** `buffer/update` and `buffer/close` accept different key sets. Sending `stabilization_score` to an observation, or `stability_trend` to a close, is refused with a message naming the tool it belongs to — rather than being silently discarded, which is what the API itself did until July 2026.

```
evide_intake_esb        → closure anchored, buffer_id returned, buffer OPEN
      ↓
evide_buffer_observe    → stability_trend, continuity_state,
      ↓                   causal_persistence_signal, stabilization_source
evide_buffer_close      → verdict + window_seconds
                          "crossing-sufficient, NOT absolute epistemic truth"
```

---

## Boundary Readiness and the Independent Gate

Agent-originated intakes default to `boundary_readiness: candidate`. In the absence of an independently declared readiness gate, FCC, DWC and FAC may remain `unknown`. **This is an evidentiary result, not a processing failure.**

`boundary_readiness` declares whether an *independent* gate assessed the boundary. A depositing agent is not that gate: it cannot attest to its own readiness at a boundary any more than a system can self-certify. The client therefore never fabricates one — `readiness_gate_id` and `readiness_gate_scope` must come from the caller, and any status other than `candidate` is refused without them.

The same applies to `unresolved_signals`, which carries the identifiers **a gate** could not resolve during its assessment. With `candidate` the array is empty by definition, not by restriction: no assessment took place, so nothing could have been left open. What the *agent* could not decide is a different thing, and lives in `escalation_reason` and `agent_state_summary`.

This is the intended lifecycle, and it is already how independent integrations use the schema in production:

```
agent
  ↓  evide_escalate / evide_intake  →  boundary_readiness: candidate
  ↓                                    FCC / DWC / FAC: unknown
independent gate (human supervisor, orchestrator, external governance component)
  ↓  assessment                      →  boundary_readiness: verified_partial
                                       with its own readiness_gate
```

The agent never has to impersonate the gate. Same principle already applied to `hashed_by`: the client does not invent a declaration that belongs to someone else.

---

## Scope of the Current Abstractions

Current MCP abstractions intentionally expose only the intervention types required by the implemented tools (`approval` for `evide_intake`, `escalation` for `evide_escalate`). Additional intervention semantics — for example `override` or `rejection` — will be introduced only when a concrete agent workflow requires them, rather than speculating about future use cases.

The same reasoning applies to `human_oversight.is_declared`, which is always `true`. This is not a shortcut: the server cannot start without a DAPI number, so every deposit made through it is by construction attributable to a declared accountable human. There is no anonymous path to leave open. The oversight *level* remains the caller's choice (`L1` / `L2` / `L3`); only the existence of a declared authority is fixed, because the transport itself guarantees it.

---

## Architectural Principle

```
authority          = accountable human / organization (DAPI-bound)
execution_identity = the agent that produced the closure
escalation_context = why crystallization was requested
```

Responsibility always converges on the DAPI-verified owner. The agent cannot self-certify.

---

## Live Validation

First live agent evidentiary crystallization: **May 2026**, via Claude Desktop + MCP.

```
continuity.state:    degraded
boundary_readiness:  verified_partial
unresolved_signals:  8
FCC:                 DEGRADED
```

The record preserved a degraded governance state without flattening instability into false certainty.

[LinkedIn -- First Live Agent Evidentiary Crystallization](https://www.linkedin.com/feed/update/urn:li:activity:7463539504990212096/)

### End-to-end validation, July 2026

v1.2.0 was exercised through a real MCP client along the complete path -- client, JSON-RPC over stdio, payload builders, HTTP transport, EVIDE Intake API -- rather than by re-running the builders in isolation.

| exercised | result |
|---|---|
| `evide_intake` with an incomplete hash declaration | refused **in the client**, before any network call |
| `evide_intake` with `verified_partial` and no declared gate | refused in the client |
| `evide_intake` with a structured hash and `boundary_status: candidate` | deposited; FCC, DWC and FAC all `unknown`, as expected with no independent gate |
| `evide_intake_esb` -> two `evide_buffer_observe` -> `evide_buffer_close` | full lifecycle over a real **502-second** window, with a declared `stabilization_score` |

**Not yet exercised along that path:** `evide_escalate`, `evide_owner_info`, `evide_check`, and the chain parameters. A defect in the `evide_escalate` handler was found by code review immediately afterwards -- precisely because it was not part of the run. The distinction between what has been executed and what has only been read is kept here for the same reason it is kept in the evidentiary records themselves.

---

## Documentation

- [EVIDE JSON Schema](https://app.certifywebcontent.com/json)
- [API Documentation](https://app.certifywebcontent.com/docs/evide-intake-schema/)
- [Payload Canonicalization](https://app.certifywebcontent.com/docs/payload-canonicalization/)
- [Closure Layer](https://app.certifywebcontent.com/docs/evide-closure-layer/)
- [EVIDE vs Execution Certification](https://app.certifywebcontent.com/docs/evide-vs-execution-certification/)
- [Pricing & Service Conditions](https://app.certifywebcontent.com/pricing)

---

## Author

**Dott. Emanuel Celano** -- Informatica in Azienda
[info@informaticainazienda.it](mailto:info@informaticainazienda.it)
Bologna, Italy

---

## License

MIT

> Use of this server requires a valid DAPI identity and an active EVIDE subscription.
> Service conditions: [app.certifywebcontent.com/pricing#service-conditions](https://app.certifywebcontent.com/pricing#service-conditions)
