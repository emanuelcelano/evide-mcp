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
}) {
    const now     = new Date().toISOString();
    const closure = closureTimestamp || now;

    const payload = {
        evide_schema:         '2.0',
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
        chain: {
            parent_evide_id: null,
            chain_type:      null,
        },
        fedis_requested: fedisRequested,
        handoff: {
            boundary_readiness: buildBoundaryReadiness(boundaryStatus, unresolvedSignals),
            reconstruction_independence: 'declared',
            submission_status:  'not_submitted',
            acceptance_status:  'not_claimed',
        },
    };

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
        evide_schema:         '2.0',
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
        chain: {
            parent_evide_id: null,
            chain_type:      null,
        },
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

    return payload;
}

// =============================================================================
// RESPONSE FORMATTER
// =============================================================================

function formatEvideResponse(result, label = 'EVIDE deposit') {
    if (!result.success) {
        return `${label} failed: ${result.error || 'unknown error'}\n${result.message || ''}`;
    }

    const fccState = result.evidentiary_profile?.continuity?.state || 'unknown';
    return [
        `${label} successful.`,
        ``,
        `evide_id:              ${result.evide_id}`,
        `intake_hash:           ${result.intake_hash}`,
        `intake_timestamp_utc:  ${result.intake_timestamp_utc}`,
        `schema_version:        ${result.schema_version}`,
        `status:                ${result.status}`,
        ``,
        `Forensic Cross-Check:  ${fccState.toUpperCase()}`,
        `  classification:      ${result.evidentiary_profile?.classification || 'n/a'}`,
        `  runtime_visibility:  ${result.evidentiary_profile?.runtime_visibility || 'n/a'}`,
        `  boundary_readiness:  ${result.evidentiary_profile?.boundary_readiness || 'n/a'}`,
        ``,
        `Owner (accountable):   ${CONFIG.ownerId} (${CONFIG.ownerRole})`,
        `Agent (execution):     ${CONFIG.agentId} / ${CONFIG.agentSystem}`,
        `DAPI prefix:           ${CONFIG.dapiNumber.substring(0, 4)}xxxxxx`,
    ].join('\n');
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