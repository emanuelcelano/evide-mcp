![MIT License](https://img.shields.io/badge/license-MIT-purple)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue)
![MCP Compatible](https://img.shields.io/badge/MCP-compatible-success)

# EVIDE MCP Server v1.1.0

MCP server connecting AI agents to the [EVIDE External Evidentiary Deposit](https://app.certifywebcontent.com) API.

EVIDE crystallizes AI agent decisions, escalations, and governance states into independently verifiable forensic records -- anchored to a verified human identity, timestamped server-side in UTC, and externalized before consequence propagation begins.

> EVIDE is not an execution-control layer. It is an external evidentiary crystallization layer operating at the responsibility closure boundary.

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

Returns: `evide_id`, `intake_hash`, `intake_timestamp_utc`, Forensic Cross-Check state.

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

Available triggers: `high_stakes_decision` · `contestable_state` · `legal_ambiguity` · `regulatory_threshold` · `governance_uncertainty` · `semantic_instability` · `human_review_required` · `authority_incoherence`

---

### `evide_owner_info`
Returns the configured owner and agent identity. Does not expose the full API key.

---

### `evide_check`
Returns verification guidance for a previously deposited record.

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
