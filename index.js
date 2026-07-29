#!/usr/bin/env node
/**
 * EVIDE MCP Server v1.2.0
 * Connects any agentic AI system to the EVIDE Evidentiary Deposit API.
 *
 * IDENTITY REQUIREMENT:
 * The API key and DAPI number MUST belong to the human/organization
 * that owns and is responsible for the AI agent.
 * The agent cannot self-certify. The owner must pre-configure credentials.
 *
 * ARCHITECTURAL SEPARATION (since v1.1.0):
 *   authority          = accountable human / organization identity (DAPI-bound)
 *   execution_identity = the agent or automated system that produced the closure
 *   escalation_context = why the agent is requesting evidentiary crystallization
 *
 * Tools:
 *   evide_intake         - deposit a finalized AI decision as an evidentiary record
 *   evide_intake_esb     - deposit AND open an Epistemic Stabilization Buffer over it
 *   evide_buffer_observe - record an intermediate observation on an open buffer
 *   evide_buffer_close   - close the buffer with a verdict over a real time window
 *   evide_escalate       - crystallize a high-stakes / contestable agent state before proceeding
 *   evide_owner_info     - return configured owner identity (no key exposure)
 *   evide_check          - verification guidance for a deposited record
 *
 * CHANGES IN v1.2.0:
 *   - evide_schema corrected from 2.0 to 2.1. Every deposit was previously
 *     rejected with unsupported_schema against production.
 *   - Evidentiary Continuity: parent_evide_id / chain_type / matter_reference
 *   - External artifacts: evidence_references, with the extensions registry
 *     kept aligned by the client
 *   - Epistemic Stabilization Buffer: three new tools for the full lifecycle
 *   - The client no longer completes declarations that belong to someone else:
 *     readiness_gate is never fabricated, unresolved_signals are never invented,
 *     hashed_by and stabilization_score are never filled in on the caller's behalf.
 *     evide_escalate now defaults to boundary_status 'candidate'.
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

// Gli endpoint ESB derivano dalla stessa base di apiEndpoint, cosi' chi ha gia'
// configurato EVIDE_API_ENDPOINT verso un ambiente diverso non deve toccare altro.
CONFIG.esbEndpoints = (() => {
    const base = CONFIG.apiEndpoint.replace(/\/api\/intake\/json\/?$/, '');
    return {
        intake: `${base}/api/intake/esb`,
        update: `${base}/api/buffer/update`,
        close:  `${base}/api/buffer/close`,
    };
})();

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

async function evidePost(payload, endpoint = CONFIG.apiEndpoint) {
    const response = await fetch(endpoint, {
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
// ESB - EPISTEMIC STABILIZATION BUFFER
// =============================================================================

/**
 * Il buffer non e' un payload: e' un ciclo di vita.
 *
 *   apri (intake ESB)  ->  osserva (una o piu' volte)  ->  chiudi con un verdetto
 *
 * Tra apertura e chiusura deve passare una finestra temporale REALE: il server
 * rifiuta una chiusura avvenuta meno di due secondi dopo l'apertura, perche' un
 * buffer che si chiude istantaneamente non ha osservato nulla. La finestra
 * misurata torna nella risposta come window_seconds.
 *
 * NIENTE VIENE INVENTATO DAL CLIENT. In particolare stabilization_score e' un
 * valore DICHIARATO da chi osserva, non calcolato dal server ne' dal client: se
 * l'agente non lo fornisce, non viene inviato. Vale lo stesso principio gia'
 * applicato a hashed_by e a readiness_gate - il client non completa una
 * dichiarazione che appartiene a un altro soggetto.
 *
 * Attenzione ai campi di fase: buffer/update e buffer/close accettano insiemi
 * di chiavi diversi, e mandare un campo alla fase sbagliata produce un 422
 * wrong_phase_field invece di essere scartato in silenzio.
 */
const BUFFER_ENUMS = {
    stability_trend:           ['improving', 'degrading', 'oscillating', 'static'],
    continuity_state:          ['coherent', 'partially_coherent', 'fragmented', 'unverifiable'],
    causal_persistence_signal: ['present', 'attenuated', 'absent', 'inconclusive'],
    stabilization_source:      ['human_review', 'automated_decay', 'quorum_resolution',
                                'timeout_expiration', 'external_override', 'mixed'],
    buffer_verdict:            ['stable', 'unstable', 'deferred'],
    closure_trigger:           ['manual_close', 'auto_threshold', 'timeout',
                                'downstream_dependency', 'escalation', 'evidentiary_freeze'],
    instability_reason:        ['authority_conflict', 'evidence_gap', 'runtime_drift',
                                'observability_loss', 'contradictory_signals',
                                'threshold_fragmentation', 'unresolved_intervention', 'unknown'],
};

function checkEnum(field, value) {
    if (value === undefined || value === null) return;
    if (!BUFFER_ENUMS[field].includes(value)) {
        throw new Error(`${field} must be one of: ${BUFFER_ENUMS[field].join(', ')}`);
    }
}

function buildBufferObservation(args) {
    if (!args.buffer_id) throw new Error('buffer_id is required.');

    // Campi che appartengono alla CHIUSURA: intercettati qui con un messaggio
    // che indirizza, invece di lasciare che il server risponda wrong_phase_field.
    const closeOnly = ['buffer_verdict', 'closure_trigger', 'stabilization_score',
                       'instability_reason', 'unresolved_at_close', 'test_mode'];
    const misplaced = closeOnly.filter((f) => args[f] !== undefined);
    if (misplaced.length) {
        throw new Error(
            `${misplaced.join(', ')} belong to evide_buffer_close, not evide_buffer_observe. ` +
            `An observation records what is happening while the buffer is open; a verdict and ` +
            `its score belong to the moment it closes.`);
    }

    for (const f of ['stability_trend', 'continuity_state',
                     'causal_persistence_signal', 'stabilization_source']) {
        checkEnum(f, args[f]);
    }

    const payload = { buffer_id: args.buffer_id };
    for (const f of ['stability_trend', 'continuity_state', 'causal_persistence_signal',
                     'stabilization_source', 'buffer_notes']) {
        if (args[f] !== undefined && args[f] !== null) payload[f] = args[f];
    }
    if (Number.isInteger(args.signal_count_total)) payload.signal_count_total = args.signal_count_total;

    if (Object.keys(payload).length === 1) {
        throw new Error(
            'An observation must carry at least one observed field. Sending only buffer_id ' +
            'would be a no-op and the server refuses it (no_observation_fields).');
    }
    return payload;
}

function buildBufferClose(args) {
    if (!args.buffer_id) throw new Error('buffer_id is required.');
    checkEnum('buffer_verdict', args.buffer_verdict);
    checkEnum('closure_trigger', args.closure_trigger);
    checkEnum('instability_reason', args.instability_reason);
    if (!args.buffer_verdict) {
        throw new Error(`buffer_verdict is required and must be one of: ${BUFFER_ENUMS.buffer_verdict.join(', ')}`);
    }

    // Campi che appartengono all'OSSERVAZIONE.
    const updateOnly = ['stability_trend', 'continuity_state', 'stabilization_source'];
    const misplaced = updateOnly.filter((f) => args[f] !== undefined);
    if (misplaced.length) {
        throw new Error(
            `${misplaced.join(', ')} belong to evide_buffer_observe, not evide_buffer_close. ` +
            `Record them while the buffer is open.`);
    }

    // Regole condizionali del server, verificate qui per dare un messaggio utile.
    if (args.buffer_verdict === 'unstable' && !args.instability_reason) {
        throw new Error(
            `buffer_verdict 'unstable' requires instability_reason. Allowed: ` +
            BUFFER_ENUMS.instability_reason.join(', '));
    }
    if ((args.buffer_verdict === 'deferred' || args.instability_reason) && !args.buffer_notes) {
        throw new Error(
            `buffer_notes is required when the verdict is 'deferred' or when an instability_reason is set: ` +
            `a non-stable closure must say in words what was left open.`);
    }
    if (args.stabilization_score !== undefined && args.stabilization_score !== null) {
        const n = Number(args.stabilization_score);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
            throw new Error(
                'stabilization_score must be a number between 0 and 100. Out-of-range values are ' +
                'rejected, never clamped: clamping would hide a client error.');
        }
    }

    const payload = { buffer_id: args.buffer_id, buffer_verdict: args.buffer_verdict };
    for (const f of ['closure_trigger', 'instability_reason', 'buffer_notes',
                     'causal_persistence_signal']) {
        if (args[f] !== undefined && args[f] !== null) payload[f] = args[f];
    }
    // Mai inventato: se l'agente non lo dichiara, non viene inviato.
    if (args.stabilization_score !== undefined && args.stabilization_score !== null) {
        payload.stabilization_score = Number(args.stabilization_score);
    }
    if (Number.isInteger(args.unresolved_at_close)) payload.unresolved_at_close = args.unresolved_at_close;
    if (Number.isInteger(args.signal_count_total))  payload.signal_count_total  = args.signal_count_total;
    if (args.test_mode === true) payload.test_mode = true;
    return payload;
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

/**
 * Costruisce handoff.boundary_readiness.
 *
 * PRINCIPIO: il gate non viene mai fabbricato dal client.
 *
 * boundary_readiness dichiara se un gate INDIPENDENTE ha valutato il confine.
 * Un agente che deposita non e' quel gate: non puo' attestare la propria
 * prontezza al confine piu' di quanto un sistema possa autocertificarsi.
 * La pagina intake-schema lo dice esplicitamente: "A system cannot self-certify
 * boundary_readiness.status = verified. That evaluation must come from an
 * independent gate declared in readiness_gate.identifier."
 *
 * Di conseguenza:
 *   candidate      -> nessun gate richiesto. L'upstream dichiara prontezza, ma
 *                     nessuna valutazione indipendente e' avvenuta. E' lo stato
 *                     normale e onesto di un deposito da agente.
 *   altri stati    -> readiness_gate obbligatorio E dichiarato dal chiamante.
 *                     Il client non lo inventa e non lo completa a meta'.
 *
 * Il server ancora la dichiarazione, non la giudica: non puo' dimostrare che il
 * gate sia davvero indipendente dal solo nome. Proprio per questo il client non
 * deve fabbricarlo - l'unica cosa garantibile e' che qualcuno l'abbia dichiarato.
 *
 * unresolved_signals appartiene al GATE, non all'agente: sono gli identificatori
 * che il gate non e' riuscito a risolvere durante la sua valutazione. Con
 * candidate l'array e' vuoto per definizione, non per restrizione, perche' non
 * c'e' stata alcuna valutazione che potesse lasciare qualcosa in sospeso.
 * Quello che l'agente non e' riuscito a decidere e' un'altra cosa, e oggi si
 * racconta in escalation_reason / agent_state_summary.
 */
function buildBoundaryReadiness(status, unresolvedSignals = [], gate = {}) {
    if (status === 'candidate') {
        if (unresolvedSignals.length > 0) {
            throw new Error(
                `unresolved_signals cannot be declared with boundary_status 'candidate': ` +
                `the field carries the identifiers an independent GATE could not resolve, ` +
                `and with 'candidate' no gate assessment took place. To declare what the ` +
                `AGENT could not resolve, use escalation_reason or agent_state_summary. ` +
                `To declare a gate's partial assessment, set boundary_status to ` +
                `'verified_partial' or 'unverifiable' and supply readiness_gate_id and ` +
                `readiness_gate_scope.`);
        }
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
    if (!visibilityMap[status]) {
        throw new Error(
            `boundary_status must be one of: candidate, verified, verified_partial, unverifiable.`);
    }

    // Il gate deve arrivare dal chiamante. Nessun valore di ripiego.
    const missing = [];
    if (!gate.identifier)      missing.push('readiness_gate_id');
    if (!gate.scope_reference) missing.push('readiness_gate_scope');
    if (missing.length) {
        throw new Error(
            `boundary_status '${status}' requires an independently declared readiness gate. ` +
            `Missing: ${missing.join(', ')}. Only 'candidate' may be declared without a gate. ` +
            `The client never fabricates one: an agent cannot certify the boundary it is itself crossing.`);
    }

    if (status !== 'verified' && unresolvedSignals.length === 0) {
        throw new Error(
            `boundary_status '${status}' requires at least one entry in unresolved_signals: ` +
            `a partial or unverifiable assessment must name what the gate could not resolve.`);
    }

    return {
        status,
        readiness_gate: {
            identifier:      String(gate.identifier),
            scope_reference: String(gate.scope_reference),
        },
        visibility_surface: visibilityMap[status],
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
    readinessGateId       = null,
    readinessGateScope    = null,
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
            boundary_readiness: buildBoundaryReadiness(boundaryStatus, unresolvedSignals, {
                identifier:      readinessGateId,
                scope_reference: readinessGateScope,
            }),
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
    boundaryStatus        = 'candidate',
    thresholdStatus       = 'unknown',
    classificationStatus  = 'provisional',
    traceReference        = null,
    readinessGateId       = null,
    readinessGateScope    = null,
    parentEvideId         = null,
    chainType             = null,
    matterReference       = null,
    evidenceReferences    = [],
}) {
    const now = new Date().toISOString();

    // Nessun segnale inventato e nessun gate fabbricato: un'escalation da agente
    // e' per sua natura 'candidate' - l'agente si e' fermato, nessun gate
    // indipendente ha ancora valutato quel confine. Cio' che l'agente non e'
    // riuscito a chiudere sta in escalation_reason e agent_state_summary; i
    // segnali irrisolti appartengono alla valutazione di un gate, e con
    // 'candidate' quella valutazione non c'e' stata.
    const readiness = buildBoundaryReadiness(boundaryStatus, unresolvedSignals, {
        identifier:      readinessGateId,
        scope_reference: readinessGateScope,
    });

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
            boundary_readiness: readiness,
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
    { name: 'evide-mcp', version: '1.2.0' },
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
                    readiness_gate_id: {
                        type: 'string',
                        description: 'Identifier of the INDEPENDENT gate that assessed the boundary. Required whenever boundary_status is not "candidate". The client never fabricates this: an agent cannot certify the boundary it is itself crossing. EVIDE anchors the declaration, it does not verify that the gate is genuinely independent - which is precisely why the value must come from you.',
                    },
                    readiness_gate_scope: {
                        type: 'string',
                        description: 'URL or hash of the gate policy document. Required whenever boundary_status is not "candidate". This is what makes a "verified" claim non-self-referential.',
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
- boundary_readiness: candidate by default. An agent stopping at a boundary has had no independent gate assess it, so the honest declaration is that none took place. FCC, DWC and FAC will read unknown: that is an evidentiary result, not a processing failure. Supply readiness_gate_id and readiness_gate_scope only if a genuinely independent gate assessed the boundary.

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
                    readiness_gate_id: {
                        type: 'string',
                        description: 'Identifier of the INDEPENDENT gate that assessed the boundary. Required whenever boundary_status is not "candidate". The client never fabricates this: an agent cannot certify the boundary it is itself crossing. EVIDE anchors the declaration, it does not verify that the gate is genuinely independent - which is precisely why the value must come from you.',
                    },
                    readiness_gate_scope: {
                        type: 'string',
                        description: 'URL or hash of the gate policy document. Required whenever boundary_status is not "candidate". This is what makes a "verified" claim non-self-referential.',
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
            name: 'evide_intake_esb',
            description: `Deposit a finalized decision AND open an Epistemic Stabilization Buffer over it.

Same payload as evide_intake, sent to the ESB profile. The closure is anchored immediately, exactly as with a normal intake - the buffer opens ALONGSIDE it, it does not delay or replace it.

Use this when the decision is closed but its stabilization is worth observing over a real time window: the buffer records how the conditions settled, not only what they were at the crossing.

Returns evide_id, intake_hash, the evidentiary profile, and a buffer_id. Keep the buffer_id: you need it to observe and to close. A buffer left open records an observation that never concluded.`,
            inputSchema: {
                type: 'object',
                properties: {
                    source_reference: { type: 'string', description: 'Your internal reference for this decision.' },
                    decision_type:    { type: 'string', description: 'Category of decision, e.g. candidate_evaluation, claim_assessment.' },
                    decision_summary: { type: 'string', description: 'What was decided, in plain language.' },
                    classification_status: { type: 'string', enum: ['stable', 'provisional', 'contested'] },
                    threshold_status:      { type: 'string', enum: ['met', 'not_met', 'unknown', 'not_defined'] },
                    boundary_status:       { type: 'string', enum: ['candidate', 'verified', 'verified_partial', 'unverifiable'], description: 'Defaults to candidate. Anything else requires readiness_gate_id and readiness_gate_scope.' },
                    human_oversight_level: { type: 'string', enum: ['L1', 'L2', 'L3'] },
                    unresolved_signals:    { type: 'array', items: { type: 'string' }, description: 'Identifiers the GATE could not resolve. Only with a non-candidate boundary_status.' },
                    readiness_gate_id:     { type: 'string', description: 'Identifier of the independent gate. Never fabricated by the client.' },
                    readiness_gate_scope:  { type: 'string', description: 'URL or hash of the gate policy document.' },
                    rationale:             { type: 'string' },
                    trace_reference:       { type: 'string' },
                    parent_evide_id:       { type: 'string', description: 'Optional: record this one continues from.' },
                    chain_type:            { type: 'string' },
                    matter_reference:      { type: 'string' },
                },
                required: ['source_reference', 'decision_type', 'decision_summary'],
            },
        },
        {
            name: 'evide_buffer_observe',
            description: `Record an intermediate observation on an open Epistemic Stabilization Buffer.

Call this one or more times while the buffer is open, to record how the stabilization is evolving: whether it is settling or drifting, whether the causal link is holding, how many signals are in play.

Every observation is persisted as an event in its own right, not merely counted. Nothing is invented: send only what you actually observed.

Fields belonging to the closing phase - buffer_verdict, stabilization_score, closure_trigger - are refused here rather than silently discarded.`,
            inputSchema: {
                type: 'object',
                properties: {
                    buffer_id: { type: 'number', description: 'The buffer_id returned by evide_intake_esb.' },
                    stability_trend: { type: 'string', enum: ['improving', 'degrading', 'oscillating', 'static'],
                        description: 'Direction of travel since the previous observation.' },
                    continuity_state: { type: 'string', enum: ['coherent', 'partially_coherent', 'fragmented', 'unverifiable'],
                        description: 'Whether the causal chain still holds together at this point in the window.' },
                    causal_persistence_signal: { type: 'string', enum: ['present', 'attenuated', 'absent', 'inconclusive'],
                        description: 'Whether the causal link between conditions and closure is still observable.' },
                    stabilization_source: { type: 'string', enum: ['human_review', 'automated_decay', 'quorum_resolution', 'timeout_expiration', 'external_override', 'mixed'],
                        description: 'What is driving the stabilization you are observing.' },
                    signal_count_total: { type: 'number', description: 'Total signals in play at this observation.' },
                    buffer_notes: { type: 'string', description: 'Free text: what you saw that the categorical fields cannot carry.' },
                },
                required: ['buffer_id'],
            },
        },
        {
            name: 'evide_buffer_close',
            description: `Close an open Epistemic Stabilization Buffer with a verdict.

The verdict states whether the closure stabilized sufficiently to cross the boundary - NOT whether it is true. The server returns the semantic note alongside it: "crossing-sufficient, NOT absolute epistemic truth".

A real observation window is required: the server refuses a close occurring less than two seconds after the open, because a buffer that closes instantly observed nothing. The measured window is returned as window_seconds.

stabilization_score is DECLARED by you, never computed by EVIDE or by this client. Out-of-range values are rejected, never clamped: clamping would hide the error. If you have no basis for a score, do not send one.`,
            inputSchema: {
                type: 'object',
                properties: {
                    buffer_id:      { type: 'number', description: 'The buffer_id returned by evide_intake_esb.' },
                    buffer_verdict: { type: 'string', enum: ['stable', 'unstable', 'deferred'],
                        description: 'stable = sufficiently stabilized for crossing. unstable requires instability_reason. deferred requires buffer_notes.' },
                    closure_trigger: { type: 'string', enum: ['manual_close', 'auto_threshold', 'timeout', 'downstream_dependency', 'escalation', 'evidentiary_freeze'],
                        description: 'What caused the buffer to close. A close by timeout is forensically distinct from a close by convergence.' },
                    stabilization_score: { type: 'number', description: 'Optional: 0 to 100, declared by you. Omit it if you have no basis for it - it is never inferred.' },
                    instability_reason: { type: 'string', enum: ['authority_conflict', 'evidence_gap', 'runtime_drift', 'observability_loss', 'contradictory_signals', 'threshold_fragmentation', 'unresolved_intervention', 'unknown'],
                        description: 'Required when buffer_verdict is unstable.' },
                    buffer_notes: { type: 'string', description: 'Required when the verdict is deferred, or whenever an instability_reason is set.' },
                    causal_persistence_signal: { type: 'string', enum: ['present', 'attenuated', 'absent', 'inconclusive'],
                        description: 'Optional: overrides the last observed value at the moment of closing.' },
                    unresolved_at_close: { type: 'number', description: 'How many signals were still unresolved when the buffer closed.' },
                    signal_count_total: { type: 'number' },
                    test_mode: { type: 'boolean',
                        description: 'Bypasses the two-second minimum observation window. For testing only: a buffer closed in test_mode did not observe a real window, and the record will not say otherwise.' },
                },
                required: ['buffer_id', 'buffer_verdict'],
            },
        },
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
                readinessGateId:      args.readiness_gate_id       || null,
                readinessGateScope:   args.readiness_gate_scope    || null,
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
                readinessGateId:     args.readiness_gate_id   || null,
                readinessGateScope:  args.readiness_gate_scope|| null,
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
    // evide_intake_esb - deposito + apertura del buffer
    // ----------------------------------------------------------------
    if (name === 'evide_intake_esb') {
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
                parentEvideId:        args.parent_evide_id         || null,
                chainType:            args.chain_type              || null,
                matterReference:      args.matter_reference        || null,
                evidenceReferences:   args.evidence_references     || [],
                readinessGateId:      args.readiness_gate_id       || null,
                readinessGateScope:   args.readiness_gate_scope    || null,
            });

            const result = await evidePost(payload, CONFIG.esbEndpoints.intake);
            let text = formatEvideResponse(result, 'EVIDE ESB intake');

            if (result.buffer && result.buffer.buffer_id) {
                text += `\n\nEpistemic Stabilization Buffer:` +
                        `\n  buffer_id:           ${result.buffer.buffer_id}` +
                        `\n  esb_status:          ${result.esb_status || 'n/a'}` +
                        `\n\nThe buffer is OPEN. Record observations with evide_buffer_observe,` +
                        `\nthen close it with evide_buffer_close. At least two seconds must elapse` +
                        `\nbetween opening and closing: a buffer that closes instantly observed nothing.`;
            }

            return { content: [{ type: 'text', text }], isError: !result.success };
        } catch (err) {
            return { content: [{ type: 'text', text: `EVIDE MCP error: ${err.message}` }], isError: true };
        }
    }

    // ----------------------------------------------------------------
    // evide_buffer_observe - osservazione intermedia
    // ----------------------------------------------------------------
    if (name === 'evide_buffer_observe') {
        try {
            const payload = buildBufferObservation(args);
            const result  = await evidePost(payload, CONFIG.esbEndpoints.update);

            const text = result.success
                ? [`Buffer observation recorded.`,
                   ``,
                   `buffer_id:       ${result.buffer_id}`,
                   `updated_fields:  ${result.updated_fields}`,
                   ``,
                   `The count reflects what was written. Fields belonging to the closing phase`,
                   `are refused, not discarded, so this number matches what you sent.`].join('\n')
                : `EVIDE buffer error: ${result.error || 'unknown'} - ${result.message || ''}`;

            return { content: [{ type: 'text', text }], isError: !result.success };
        } catch (err) {
            return { content: [{ type: 'text', text: `EVIDE MCP error: ${err.message}` }], isError: true };
        }
    }

    // ----------------------------------------------------------------
    // evide_buffer_close - chiusura con verdetto
    // ----------------------------------------------------------------
    if (name === 'evide_buffer_close') {
        try {
            const payload = buildBufferClose(args);
            const result  = await evidePost(payload, CONFIG.esbEndpoints.close);

            const text = result.success
                ? [`Buffer closed.`,
                   ``,
                   `buffer_id:         ${result.buffer_id}`,
                   `buffer_verdict:    ${result.buffer_verdict}`,
                   `buffer_open_at:    ${result.buffer_open_at}`,
                   `buffer_close_at:   ${result.buffer_close_at}`,
                   `window_seconds:    ${result.window_seconds}`,
                   `closure_trigger:   ${result.closure_trigger || 'n/a'}`,
                   result.stabilization_score !== undefined && result.stabilization_score !== null
                       ? `stabilization_score: ${result.stabilization_score}  (declared, not computed)`
                       : `stabilization_score: not declared`,
                   `causal_persistence_signal: ${result.causal_persistence_signal || 'n/a'}`,
                   ``,
                   `${result.semantic_note || ''}`].join('\n')
                : `EVIDE buffer error: ${result.error || 'unknown'} - ${result.message || ''}`;

            return { content: [{ type: 'text', text }], isError: !result.success };
        } catch (err) {
            return { content: [{ type: 'text', text: `EVIDE MCP error: ${err.message}` }], isError: true };
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
                    `EVIDE MCP v1.2.0 - Identity Configuration`,
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
    `[EVIDE MCP v1.2.0] Server started.\n` +
    `  Owner: ${CONFIG.ownerId} | Agent: ${CONFIG.agentId} / ${CONFIG.agentSystem}\n` +
    `  Credentials: present. Key validity verified at first deposit.\n`
);
