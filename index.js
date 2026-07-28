#!/usr/bin/env node
/**
 * EVIDE MCP Server v1.1.0
 * Connects any agentic AI system to the EVIDE Evidentiary Deposit API.
 *
 * IDENTITY REQUIREMENT:
 * The API key and DAPI number MUST belong to the human/organization
 * that owns and is responsible for the AI agent.
 * The agent cannot self-certify. The owner must pre-configure credentials.
 *
 * ARCHITECTURAL SEPARATION (v1.1.0):
 *   authority          = accountable human / organization identity (DAPI-bound)
 *   execution_identity = the agent or automated system that produced the closure
 *   escalation_context = why the agent is requesting evidentiary crystallization
 *
 * Tools:
 *   evide_intake    - deposit a finalized AI decision as an evidentiary record
 *   evide_escalate  - crystallize a high-stakes / contestable agent state before proceeding
 *   evide_owner_info - return configured owner identity (no key exposure)
 *   evide_check     - verification guidance for a deposited record
 *
 * Usage:
 *   EVIDE_API_KEY=evd_xxx EVIDE_DAPI_NUMBER=0123456789 node index.js
 *
 * MCP client configuration (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "evide": {
 *         "command": "node",
 *         "args": ["/path/to/evide-mcp/index.js"],
 *         "env": {
 *           "EVIDE_API_KEY":      "evd_your_key_here",
 *           "EVIDE_DAPI_NUMBER":  "0123456789",
 *           "EVIDE_OWNER_ID":     "your_owner_id",
 *           "EVIDE_OWNER_ROLE":   "AI System Operator",
 *           "EVIDE_AGENT_SYSTEM": "MyAgentSystem",
 *           "EVIDE_AGENT_ID":     "agent_xyz"
 *         }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    apiKey:      process.env.EVIDE_API_KEY      || '',
    dapiNumber:  process.env.EVIDE_DAPI_NUMBER  || '',
    ownerId:     process.env.EVIDE_OWNER_ID     || '',
    ownerRole:   process.env.EVIDE_OWNER_ROLE   || 'AI System Operator',
    agentSystem: process.env.EVIDE_AGENT_SYSTEM || 'Unknown Agent System',
    agentId:     process.env.EVIDE_AGENT_ID     || 'agent_unspecified',
    apiEndpoint: process.env.EVIDE_API_ENDPOINT || 'https://app.certifywebcontent.com/api/intake/json',
};

if (!CONFIG.apiKey || !CONFIG.dapiNumber || !CONFIG.ownerId) {
    process.stderr.write(
        '[EVIDE MCP] ERROR: Missing required environment variables.\n' +
        '  EVIDE_API_KEY      - Your EVIDE API key (belongs to agent owner)\n' +
        '  EVIDE_DAPI_NUMBER  - Your DAPI number (10 digits, verified identity)\n' +
        '  EVIDE_OWNER_ID     - Your owner identifier in the source system\n' +
        '\n' +
        '  The API key and DAPI number must belong to the human or organization\n' +
        '  responsible for this AI agent. The agent cannot self-certify.\n'
    );
    process.exit(1);
}

// =============================================================================
// EVIDE API CLIENT
// =============================================================================

async function evidePost(payload) {
    const response = await fetch(CONFIG.apiEndpoint, {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key':    CONFIG.apiKey,
        },
        body: JSON.stringify(payload),
    });
    return response.json();
}

// =============================================================================
// PAYLOAD BUILDERS
// =============================================================================

/**
 * execution_identity block - always present when depositing via MCP.
 * Separates the accountable owner identity from the operational agent identity.
 */
function buildExecutionIdentity() {
    return {
        type:               'agent_identity',
        agent_id:           CONFIG.agentId,
        agent_system:       CONFIG.agentSystem,
        accountability_model: 'owner_bound',   // responsibility converges on DAPI-verified owner
    };
}

/**
 * execution_identity and escalation_context are EVIDE 2.0 extension fields.
 * They are accepted by the server, preserved in raw_evidence_json,
 * and may be formalized in a future schema version.
 */

/**
 * Builds a valid boundary_readiness object for any status.
 * Ensures readiness_gate and visibility_surface are correctly populated
 * for non-candidate states, preventing server-side validation errors.
 */
/**
 * Costruisce il blocco chain (Evidentiary Continuity).
 *
 * La validazione lato server e' stretta e non ha fallback silenziosi: un
 * parent_evide_id inesistente, di un altro dominio evidenziario, in uno stato
 * non incatenabile, o con un matter_reference discordante fa fallire l'intero
 * deposito invece di aprire silenziosamente una catena nuova. I codici
 * restituiti sono chain_parent_not_found (422), chain_parent_not_owned (403),
 * chain_parent_invalid_status (422) e chain_matter_mismatch (422).
 *
 * Se non viene dichiarato alcun parent, i campi restano null: e' il caso
 * normale di una chiusura che apre una catena di un solo anello.
 */
/**
 * Costruisce e valida il blocco evidence_references (External Artifacts).
 *
 * EVIDE ancora la DICHIARAZIONE di esistenza di un artefatto esterno, mai
 * l'artefatto stesso: il file non viene mai caricato. Di conseguenza EVIDE non
 * calcola ne' verifica mai l'hash di integrita' - lo ancora esattamente come
 * dichiarato dal mittente, ed e' per questo che hashed_by e' obbligatorio
 * quando un hash e' presente: senza, l'hash sarebbe una provenienza anonima.
 *
 * La validazione lato server e' condizionale: se hash e' presente diventano
 * obbligatori hash.algorithm, hash.value, hash_scope e hashed_by. Qui li
 * controlliamo prima di partire, cosi' l'agente riceve un errore che nomina il
 * campo mancante invece di un 422 generico dopo il viaggio di rete.
 *
 * Nessun valore viene inventato: se hashed_by manca la chiamata fallisce e non
 * viene sostituito con l'identita' dell'agente. Dichiarare che sia stato
 * l'agente a calcolare un hash che ha solo ricevuto sarebbe una falsa
 * provenienza, e la provenienza e' esattamente cio' che questo blocco anchora.
 */
const HASH_SCOPES       = ['full_file', 'segment', 'frame', 'archive'];
const RETENTION_STATUSES = ['persistent_storage', 'rolling_buffer', 'unknown'];

function buildEvidenceReferences(refs = []) {
    if (!Array.isArray(refs) || refs.length === 0) return null;

    return refs.map((r, i) => {
        const out = {};
        for (const f of ['artifact_type', 'pointer', 'declared_origin',
                         'declared_relationship', 'declared_description']) {
            if (r[f]) out[f] = String(r[f]);
        }

        if (r.declared_retention_status) {
            if (!RETENTION_STATUSES.includes(r.declared_retention_status)) {
                throw new Error(
                    `evidence_references[${i}].declared_retention_status must be one of: ` +
                    RETENTION_STATUSES.join(', '));
            }
            out.declared_retention_status = r.declared_retention_status;
        }

        // Blocco hash: tutto o niente, e mai completato per inferenza.
        if (r.hash_algorithm || r.hash_value || r.hash_scope || r.hashed_by) {
            const missing = [];
            if (!r.hash_algorithm) missing.push('hash_algorithm');
            if (!r.hash_value)     missing.push('hash_value');
            if (!r.hash_scope)     missing.push('hash_scope');
            if (!r.hashed_by)      missing.push('hashed_by');
            if (missing.length) {
                throw new Error(
                    `evidence_references[${i}]: declaring an integrity hash requires all of ` +
                    `hash_algorithm, hash_value, hash_scope, hashed_by. Missing: ${missing.join(', ')}. ` +
                    `EVIDE never computes or verifies the hash - it anchors it exactly as declared, ` +
                    `so its provenance must be stated.`);
            }
            if (!HASH_SCOPES.includes(r.hash_scope)) {
                throw new Error(
                    `evidence_references[${i}].hash_scope must be one of: ` + HASH_SCOPES.join(', '));
            }
            out.hash       = { algorithm: String(r.hash_algorithm), value: String(r.hash_value) };
            out.hash_scope = r.hash_scope;
            out.hashed_by  = String(r.hashed_by);
        }

        return out;
    });
}

function buildChain(parentEvideId = null, chainType = null, matterReference = null) {
    const chain = {
        parent_evide_id: parentEvideId || null,
        chain_type:      chainType     || null,
    };
    // matter_reference si dichiara solo quando valorizzato: se omesso su un
    // figlio, il server lo eredita dal padre.
    if (matterReference) chain.matter_reference = matterReference;
    return chain;
}

function buildBoundaryReadiness(status, unresolvedSignals = []) {
    if (status === 'candidate') {
        return {
            status:             'candidate',
            readiness_gate:     null,
            visibility_surface: null,
            unresolved_signals: [],
        };
    }

    const visibilityMap = {
        verified:         'declared_complete',
        verified_partial: 'partial',
        unverifiable:     'insufficient',
    };

    // For non-candidate: auto-build gate from agent system config
    return {
        status,
        readiness_gate: {
            identifier:      `${CONFIG.agentSystem}_boundary_gate`,
            scope_reference: `evide:mcp:intake:${CONFIG.agentSystem}`,
        },
        visibility_surface: visibilityMap[status] || 'partial',
        unresolved_signals: status === 'verified' ? [] : unresolvedSignals,
    };
}

/**
 * Standard finalized decision deposit.
 */
function buildIntakePayload({
    sourceReference,
    decisionType,
    decisionSummary,
    closureTimestamp,
    classificationStatus = 'stable',
    thresholdStatus       = 'not_defined',
    boundaryStatus        = 'candidate',
    humanOversightLevel   = 'L2',
    fedisRequested        = false,
    unresolvedSignals     = [],
    traceReference        = null,
    rationale             = null,
    parentEvideId         = null,
    chainType             = null,
    matterReference       = null,
    evidenceReferences    = [],
}) {
    const now     = new Date().toISOString();
    const closure = closureTimestamp || now;

    const payload = {
        evide_schema:         '2.1',
        created_at_utc:       now,
        object_class:         'decision_record',
        source_system:        CONFIG.agentSystem,
        source_reference:     sourceReference,
        source_timestamp_utc: now,
        decision: {
            type:                  decisionType,
            status:                'finalized',
            closure_timestamp_utc: closure,
            summary:               decisionSummary,
        },
        authority: {
            id:          CONFIG.ownerId,
            role:        CONFIG.ownerRole,
            dapi_number: CONFIG.dapiNumber,
        },
        execution_identity: buildExecutionIdentity(),
        human_oversight: {
            is_declared:    true,
            declared_level: humanOversightLevel,
        },
        intervention: {
            type:                 'approval',
            classification_status: classificationStatus,
            classification_context: {
                threshold_status: thresholdStatus,
            },
        },
        chain: buildChain(parentEvideId, chainType, matterReference),
        fedis_requested: fedisRequested,
        handoff: {
            boundary_readiness: buildBoundaryReadiness(boundaryStatus, unresolvedSignals),
            reconstruction_independence: 'declared',
            submission_status:  'not_submitted',
            acceptance_status:  'not_claimed',
        },
    };

    // extensions e' un registro opt-in bidirezionale: un blocco presente ma non
    // dichiarato viene rifiutato, e uno dichiarato ma vuoto pure. Il client li
    // tiene allineati per costruzione, cosi' l'agente non puo' sbagliarlo.
    const evRefs = buildEvidenceReferences(evidenceReferences);
    if (evRefs) {
        payload.extensions          = ['evidence_references'];
        payload.evidence_references = evRefs;
    }

    if (rationale)       payload.intervention.rationale = rationale;
    if (traceReference)  payload.intervention.trace = { reference: traceReference, access: 'declared' };

    return payload;
}

/**
 * Evidentiary escalation - called by agent at high-stakes / contestable boundary.
 * Always uses verified_partial or unverifiable boundary_readiness.
 * Includes escalation_context explaining why crystallization was requested.
 */
function buildEscalatePayload({
    sourceReference,
    agentStateSummary,
    escalationTrigger,
    escalationReason,
    unresolvedSignals     = [],
    boundaryStatus        = 'verified_partial',
    thresholdStatus       = 'unknown',
    classificationStatus  = 'provisional',
    traceReference        = null,
    readinessGateId       = null,
    parentEvideId         = null,
    chainType             = null,
    matterReference       = null,
    evidenceReferences    = [],
}) {
    const now = new Date().toISOString();

    // escalation always requires at least one unresolved signal
    const signals = unresolvedSignals.length > 0
        ? unresolvedSignals
        : ['agent_uncertainty_at_governance_boundary'];

    // readiness_gate: the agent itself is the gate for escalation
    const readinessGate = (boundaryStatus !== 'candidate') ? {
        identifier:      readinessGateId || `${CONFIG.agentSystem}_escalation_gate`,
        scope_reference: `evide:mcp:escalation:${CONFIG.agentSystem}`,
    } : null;

    const visibilitySurface = boundaryStatus === 'verified_partial' ? 'partial'
        : boundaryStatus === 'unverifiable'   ? 'insufficient'
        : null;

    const payload = {
        evide_schema:         '2.1',
        created_at_utc:       now,
        object_class:         'escalation_record',
        source_system:        CONFIG.agentSystem,
        source_reference:     sourceReference,
        source_timestamp_utc: now,
        decision: {
            type:                  'evidentiary_escalation',
            status:                'finalized',
            closure_timestamp_utc: now,
            summary:               agentStateSummary,
        },
        authority: {
            id:          CONFIG.ownerId,
            role:        CONFIG.ownerRole,
            dapi_number: CONFIG.dapiNumber,
        },
        execution_identity: buildExecutionIdentity(),
        escalation_context: {
            type:    'legal_crystallization',
            trigger: escalationTrigger,
            reason:  escalationReason,
        },
        human_oversight: {
            is_declared:    true,
            declared_level: 'L2',
        },
        intervention: {
            type:                  'escalation',
            classification_status: classificationStatus,
            classification_context: {
                threshold_status: thresholdStatus,
            },
        },
        chain: buildChain(parentEvideId, chainType, matterReference),
        fedis_requested: false,
        handoff: {
            boundary_readiness: {
                status:             boundaryStatus,
                readiness_gate:     readinessGate,
                visibility_surface: visibilitySurface,
                unresolved_signals: signals,
            },
            reconstruction_independence: 'declared',
            submission_status:  'not_submitted',
            acceptance_status:  'not_claimed',
        },
    };

    if (traceReference) payload.intervention.trace = { reference: traceReference, access: 'declared' };

    const evRefs = buildEvidenceReferences(evidenceReferences);
    if (evRefs) {
        payload.extensions          = ['evidence_references'];
        payload.evidence_references = evRefs;
    }

    return payload;
}

// =============================================================================
// RESPONSE FORMATTER
// =============================================================================

function formatEvideResponse(result, label = 'EVIDE deposit') {
    if (!result.success) {
        return `${label} failed: ${result.error || 'unknown error'}\n${result.message || ''}`;
    }

    const profile  = result.evidentiary_profile || {};
    const fccState = profile.continuity?.state || 'unknown';
    const dwcState = profile.decision_wave_compression?.state || null;
    const facState = profile.formal_accountability_collapse?.state || null;

    const lines = [
        `${label} successful.`,
        ``,
        `evide_id:              ${result.evide_id}`,
        `intake_hash:           ${result.intake_hash}`,
        `intake_timestamp_utc:  ${result.intake_timestamp_utc}`,
        `schema_version:        ${result.schema_version}`,
        `profile_version:       ${profile.profile_version || 'n/a'}`,
        `status:                ${result.status}`,
        ``,
        `Forensic Cross-Check:  ${fccState.toUpperCase()}`,
        `  classification:      ${profile.classification || 'n/a'}`,
        `  runtime_visibility:  ${profile.runtime_visibility || 'n/a'}`,
        `  boundary_readiness:  ${profile.boundary_readiness || 'n/a'}`,
    ];

    // Dim 10 e 11 esistono da profile_version 1.1: mostrarle solo se presenti,
    // cosi' la risposta resta corretta anche su profili di generazione precedente.
    if (dwcState || facState) {
        lines.push(``);
        if (dwcState) lines.push(`Decision Wave Compression:      ${dwcState.toUpperCase()}`);
        if (facState) lines.push(`Formal Accountability Collapse: ${facState.toUpperCase()}`);
        lines.push(`  Inferred governance signals, not judicial determinations.`);
    }

    // Catena: mostrata solo quando questo record continua da un altro, cosi'
    // l'agente puo' usare chain_root_evide_id per costruire la lineage.
    const chain = result.chain || {};
    if (chain.chain_position && chain.chain_position > 1) {
        lines.push(``);
        lines.push(`Evidentiary Continuity:`);
        lines.push(`  chain_position:      ${chain.chain_position}`);
        lines.push(`  chain_type:          ${chain.chain_type || 'n/a'}`);
        lines.push(`  chain_root_evide_id: ${chain.chain_root_evide_id || 'n/a'}`);
    }

    lines.push(
        ``,
        `Owner (accountable):   ${CONFIG.ownerId} (${CONFIG.ownerRole})`,
        `Agent (execution):     ${CONFIG.agentId} / ${CONFIG.agentSystem}`,
        `DAPI prefix:           ${CONFIG.dapiNumber.substring(0, 4)}xxxxxx`,
    );

    return lines.join('\n');
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server(
    { name: 'evide-mcp', version: '1.1.0' },
    { capabilities: { tools: {} } }
);

// ---- Tool definitions -------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [

        // ----------------------------------------------------------------
        // evide_intake - standard finalized decision deposit
        // ----------------------------------------------------------------
        {
            name: 'evide_intake',
            description: `Deposit a finalized AI decision into EVIDE as an independently verifiable evidentiary record.

The deposit anchors the responsibility of the agent owner (pre-configured via DAPI + API key) at the exact moment of boundary crossing. The owner is the accountable identity. The agent is the execution identity. These are architecturally separated.

Returns evide_id, intake_hash, and the Forensic Cross-Check (FCC) continuity state.

Use this tool when the agent has finalized a decision and needs to create an independent evidentiary record of it.
For high-stakes or contestable states, use evide_escalate instead.`,
            inputSchema: {
                type: 'object',
                properties: {
                    source_reference: {
                        type: 'string',
                        description: 'Unique identifier for this decision in the source system.',
                    },
                    decision_type: {
                        type: 'string',
                        description: 'Category of decision (e.g. candidate_evaluation, risk_classification, content_moderation).',
                    },
                    decision_summary: {
                        type: 'string',
                        description: 'Natural language description of the finalized decision.',
                    },
                    classification_status: {
                        type: 'string',
                        enum: ['stable', 'provisional', 'contested'],
                        description: 'Stability of the classification at closure. Default: stable.',
                    },
                    threshold_status: {
                        type: 'string',
                        enum: ['met', 'not_met', 'unknown', 'not_defined'],
                        description: 'Whether a decision threshold was defined and satisfied. Default: not_defined.',
                    },
                    boundary_status: {
                        type: 'string',
                        enum: ['candidate', 'verified', 'verified_partial', 'unverifiable'],
                        description: 'Readiness state of the object at boundary crossing. Default: candidate.',
                    },
                    unresolved_signals: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Signals the gate could not resolve. Required for verified_partial and unverifiable.',
                    },
                    human_oversight_level: {
                        type: 'string',
                        enum: ['L1', 'L2', 'L3'],
                        description: 'Declared human oversight level. Default: L2.',
                    },
                    rationale: {
                        type: 'string',
                        description: 'Optional: rationale for the decision.',
                    },
                    trace_reference: {
                        type: 'string',
                        description: 'Optional: upstream trace reference for audit continuity.',
                    },
                    fedis_requested: {
                        type: 'boolean',
                        description: 'Request FEDIS forensic certification. Default: false.',
                    },
                    evidence_references: {
                        type: 'array',
                        description: 'Optional: external artifacts this record refers to (screenshots, video, sensor logs, documents). EVIDE anchors the DECLARATION that the artifact exists - the file itself is never uploaded, and EVIDE never computes or verifies its hash. Declaring the array automatically sets the required extensions registry entry.',
                        items: {
                            type: 'object',
                            properties: {
                                artifact_type:         { type: 'string', description: 'e.g. document, recording, screenshot, sensor_log.' },
                                pointer:               { type: 'string', description: 'Where the artifact lives in your own systems. Never fetched by EVIDE.' },
                                declared_origin:       { type: 'string', description: 'System or party the artifact came from.' },
                                declared_relationship: { type: 'string', description: 'How it relates to this decision, e.g. supporting_document, source_material.' },
                                declared_description:  { type: 'string', description: 'Short human-readable description.' },
                                declared_retention_status: {
                                    type: 'string',
                                    enum: ['persistent_storage', 'rolling_buffer', 'unknown'],
                                    description: 'Whether the artifact is expected to still exist later. rolling_buffer means it may be gone by the time anyone looks.',
                                },
                                hash_algorithm: { type: 'string', description: 'e.g. sha256. Required if any hash field is given.' },
                                hash_value:     { type: 'string', description: 'The digest itself. Required if any hash field is given.' },
                                hash_scope:     { type: 'string', enum: ['full_file', 'segment', 'frame', 'archive'], description: 'What the digest covers. Required if any hash field is given.' },
                                hashed_by:      { type: 'string', description: 'Who computed the digest. Required if any hash field is given: EVIDE anchors the hash exactly as declared and never verifies it, so its provenance must be stated. It is never inferred from the agent identity.' },
                            },
                        },
                    },
                    parent_evide_id: {
                        type: 'string',
                        description: 'Optional: EVIDE ID of a previously deposited record that this one continues from, forming a declared lineage of responsibility closures. Typical use: the evide_id returned by an earlier evide_escalate, when depositing the decision that resolved it. Validation is strict - if the parent does not exist, belongs to another evidentiary domain, is in a non-chainable status, or declares a different matter_reference, the whole deposit is refused rather than silently starting a new chain.',
                    },
                    chain_type: {
                        type: 'string',
                        description: 'Optional: free text describing the nature of the continuation, e.g. revision, escalation_resolution, supersession, review. Max 50 characters. Only meaningful together with parent_evide_id.',
                    },
                    matter_reference: {
                        type: 'string',
                        description: 'Optional: identifier of the matter this lineage belongs to. Inherited from the parent when omitted. If declared on both sides it must match exactly - this is what prevents an incorrect parent_evide_id from silently attaching a decision to an unrelated matter inside the same organization.',
                    },
                },
                required: ['source_reference', 'decision_type', 'decision_summary'],
            },
        },

        // ----------------------------------------------------------------
        // evide_escalate - legal crystallization at high-stakes boundary
        // ----------------------------------------------------------------
        {
            name: 'evide_escalate',
            description: `Crystallize the current agent state as an independent evidentiary record when entering a high-stakes, contestable, legally ambiguous, semantically unstable, or governance-sensitive condition.

Unlike evide_intake (which deposits a finalized decision), evide_escalate is called BEFORE or AT a risk boundary - when the agent detects that the current state requires independent anchoring before proceeding.

The deposit includes:
- execution_identity: the agent that triggered the escalation
- escalation_context: why crystallization was requested
- boundary_readiness: verified_partial or unverifiable (never candidate for escalation)

Use cases:
- Financial agent hitting a transaction requiring regulatory review
- Healthcare agent at a diagnosis threshold requiring human confirmation
- Legal workflow agent encountering an ambiguous clause
- Moderation system at an edge case requiring human judgment
- Any agent detecting contestable conditions before proceeding

Returns evide_id and intake_hash as independent proof that the agent recognized the boundary condition at that exact moment.`,
            inputSchema: {
                type: 'object',
                properties: {
                    source_reference: {
                        type: 'string',
                        description: 'Unique identifier for this escalation event in the source system.',
                    },
                    agent_state_summary: {
                        type: 'string',
                        description: 'Description of the agent state at the moment of escalation. What condition was detected.',
                    },
                    escalation_trigger: {
                        type: 'string',
                        enum: [
                            'high_stakes_decision',
                            'contestable_state',
                            'legal_ambiguity',
                            'regulatory_threshold',
                            'governance_uncertainty',
                            'semantic_instability',
                            'human_review_required',
                            'authority_incoherence',
                        ],
                        description: 'Category of condition that triggered the escalation.',
                    },
                    escalation_reason: {
                        type: 'string',
                        description: 'Natural language explanation of why the agent is requesting evidentiary crystallization.',
                    },
                    unresolved_signals: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Specific signals the agent could not resolve at this boundary. Auto-populated if empty.',
                    },
                    boundary_status: {
                        type: 'string',
                        enum: ['verified_partial', 'unverifiable'],
                        description: 'Boundary readiness state. Default: verified_partial (agent assessed but found gaps).',
                    },
                    trace_reference: {
                        type: 'string',
                        description: 'Optional: upstream trace reference linking this escalation to the originating workflow.',
                    },
                    evidence_references: {
                        type: 'array',
                        description: 'Optional: external artifacts this record refers to (screenshots, video, sensor logs, documents). EVIDE anchors the DECLARATION that the artifact exists - the file itself is never uploaded, and EVIDE never computes or verifies its hash. Declaring the array automatically sets the required extensions registry entry.',
                        items: {
                            type: 'object',
                            properties: {
                                artifact_type:         { type: 'string', description: 'e.g. document, recording, screenshot, sensor_log.' },
                                pointer:               { type: 'string', description: 'Where the artifact lives in your own systems. Never fetched by EVIDE.' },
                                declared_origin:       { type: 'string', description: 'System or party the artifact came from.' },
                                declared_relationship: { type: 'string', description: 'How it relates to this decision, e.g. supporting_document, source_material.' },
                                declared_description:  { type: 'string', description: 'Short human-readable description.' },
                                declared_retention_status: {
                                    type: 'string',
                                    enum: ['persistent_storage', 'rolling_buffer', 'unknown'],
                                    description: 'Whether the artifact is expected to still exist later. rolling_buffer means it may be gone by the time anyone looks.',
                                },
                                hash_algorithm: { type: 'string', description: 'e.g. sha256. Required if any hash field is given.' },
                                hash_value:     { type: 'string', description: 'The digest itself. Required if any hash field is given.' },
                                hash_scope:     { type: 'string', enum: ['full_file', 'segment', 'frame', 'archive'], description: 'What the digest covers. Required if any hash field is given.' },
                                hashed_by:      { type: 'string', description: 'Who computed the digest. Required if any hash field is given: EVIDE anchors the hash exactly as declared and never verifies it, so its provenance must be stated. It is never inferred from the agent identity.' },
                            },
                        },
                    },
                    parent_evide_id: {
                        type: 'string',
                        description: 'Optional: EVIDE ID of a previously deposited record that this escalation continues from. Validation is strict - if the parent does not exist, belongs to another evidentiary domain, is in a non-chainable status, or declares a different matter_reference, the whole deposit is refused rather than silently starting a new chain.',
                    },
                    chain_type: {
                        type: 'string',
                        description: 'Optional: free text describing the nature of the continuation, e.g. escalation, re_escalation, review. Max 50 characters. Only meaningful together with parent_evide_id.',
                    },
                    matter_reference: {
                        type: 'string',
                        description: 'Optional: identifier of the matter this lineage belongs to. Inherited from the parent when omitted. If declared on both sides it must match exactly.',
                    },
                },
                required: ['source_reference', 'agent_state_summary', 'escalation_trigger', 'escalation_reason'],
            },
        },

        // ----------------------------------------------------------------
        // evide_owner_info - identity inspection
        // ----------------------------------------------------------------
        {
            name: 'evide_owner_info',
            description: 'Returns the configured owner identity for this EVIDE MCP instance. Shows accountable identity (owner) and execution identity (agent) separately. Does not expose the full API key.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
            },
        },

        // ----------------------------------------------------------------
        // evide_check - verification guidance
        // ----------------------------------------------------------------
        {
            name: 'evide_check',
            description: 'Returns verification guidance for a previously deposited EVIDE record. Provides instructions for verifying the intake_hash against the live registry.',
            inputSchema: {
                type: 'object',
                properties: {
                    evide_id: {
                        type: 'string',
                        description: 'The EVIDE ID returned at intake or escalation time.',
                    },
                    expected_hash: {
                        type: 'string',
                        description: 'Optional: the intake_hash to verify against.',
                    },
                },
                required: ['evide_id'],
            },
        },
    ],
}));

// ---- Tool handlers ----------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ----------------------------------------------------------------
    // evide_intake
    // ----------------------------------------------------------------
    if (name === 'evide_intake') {
        try {
            const payload = buildIntakePayload({
                sourceReference:      args.source_reference,
                decisionType:         args.decision_type,
                decisionSummary:      args.decision_summary,
                classificationStatus: args.classification_status  || 'stable',
                thresholdStatus:      args.threshold_status        || 'not_defined',
                boundaryStatus:       args.boundary_status         || 'candidate',
                unresolvedSignals:    args.unresolved_signals      || [],
                humanOversightLevel:  args.human_oversight_level   || 'L2',
                rationale:            args.rationale               || null,
                traceReference:       args.trace_reference         || null,
                fedisRequested:       args.fedis_requested         || false,
                parentEvideId:        args.parent_evide_id         || null,
                chainType:            args.chain_type              || null,
                matterReference:      args.matter_reference        || null,
                evidenceReferences:   args.evidence_references     || [],
            });

            const result = await evidePost(payload);
            const text   = formatEvideResponse(result, 'EVIDE intake');

            return {
                content: [{ type: 'text', text }],
                isError: !result.success,
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `EVIDE MCP error: ${err.message}` }],
                isError: true,
            };
        }
    }

    // ----------------------------------------------------------------
    // evide_escalate
    // ----------------------------------------------------------------
    if (name === 'evide_escalate') {
        try {
            const payload = buildEscalatePayload({
                sourceReference:     args.source_reference,
                agentStateSummary:   args.agent_state_summary,
                escalationTrigger:   args.escalation_trigger,
                escalationReason:    args.escalation_reason,
                unresolvedSignals:   args.unresolved_signals  || [],
                boundaryStatus:      args.boundary_status     || 'verified_partial',
                traceReference:      args.trace_reference     || null,
                parentEvideId:       args.parent_evide_id     || null,
                chainType:           args.chain_type          || null,
                matterReference:     args.matter_reference    || null,
                evidenceReferences:  args.evidence_references || [],
            });

            const result = await evidePost(payload);
            const text   = formatEvideResponse(result, 'EVIDE escalation');

            if (result.success) {
                const extra = [
                    ``,
                    `Escalation trigger:  ${args.escalation_trigger}`,
                    `Crystallization:     independent evidentiary record created`,
                    `Agent may proceed:   with documented boundary state on record`,
                ].join('\n');
                return { content: [{ type: 'text', text: text + extra }] };
            }

            return {
                content: [{ type: 'text', text }],
                isError: true,
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `EVIDE MCP error: ${err.message}` }],
                isError: true,
            };
        }
    }

    // ----------------------------------------------------------------
    // evide_owner_info
    // ----------------------------------------------------------------
    if (name === 'evide_owner_info') {
        return {
            content: [{
                type: 'text',
                text: [
                    `EVIDE MCP v1.1.0 - Identity Configuration`,
                    ``,
                    `ACCOUNTABLE IDENTITY (owner - DAPI-bound):`,
                    `  Owner ID:    ${CONFIG.ownerId}`,
                    `  Owner Role:  ${CONFIG.ownerRole}`,
                    `  DAPI prefix: ${CONFIG.dapiNumber.substring(0, 4)}xxxxxx`,
                    `  API key:     ${CONFIG.apiKey.substring(0, 8)}...`,
                    ``,
                    `EXECUTION IDENTITY (agent - operational):`,
                    `  Agent ID:    ${CONFIG.agentId}`,
                    `  Agent system: ${CONFIG.agentSystem}`,
                    `  Accountability model: owner_bound`,
                    ``,
                    `API endpoint: ${CONFIG.apiEndpoint}`,
                    ``,
                    `IDENTITY RULE: The accountable identity (owner) and the execution`,
                    `identity (agent) are architecturally separated. Every deposit and`,
                    `escalation is bound to the owner's DAPI-verified identity.`,
                    `The agent cannot self-certify.`,
                ].join('\n'),
            }],
        };
    }

    // ----------------------------------------------------------------
    // evide_check
    // ----------------------------------------------------------------
    if (name === 'evide_check') {
        return {
            content: [{
                type: 'text',
                text: [
                    `evide_check: verification guidance for ${args.evide_id}`,
                    ``,
                    `To verify this record:`,
                    `  1. Log into app.certifywebcontent.com`,
                    `  2. Search the archive for evide_id: ${args.evide_id}`,
                    `  3. Compare intake_hash with expected: ${args.expected_hash || '(not provided)'}`,
                    ``,
                    `The intake_hash is the SHA-256 of the canonicalized payload`,
                    `and is independently verifiable using the algorithm at:`,
                    `  app.certifywebcontent.com/docs/payload-canonicalization/`,
                ].join('\n'),
            }],
        };
    }

    return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
    };
});

// =============================================================================
// START
// =============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(
    `[EVIDE MCP v1.1.0] Server started.\n` +
    `  Owner: ${CONFIG.ownerId} | Agent: ${CONFIG.agentId} / ${CONFIG.agentSystem}\n` +
    `  Credentials: present. Key validity verified at first deposit.\n`
);
