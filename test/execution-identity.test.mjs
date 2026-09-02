// execution_identity contract v2.2 - test suite (hardening pass)
//
// Imports the real implementation from index.js (not a reimplementation),
// guarded from starting a live MCP server via EVIDE_MCP_TEST_IMPORT=1.
//
// Run: npm test  (or: node --test test/execution-identity.test.mjs)
//
// Honesty note on SDK coverage (see hardening finding 6): the "tool schema"
// test below invokes the REAL handler the SDK registered for the
// 'tools/list' JSON-RPC method (via server._requestHandlers, a public
// runtime property on the SDK's Protocol class despite its underscore
// prefix - confirmed by reading the installed SDK source, not assumed).
// This exercises the real SDK request/validation path for schema exposure.
// It does NOT exercise 'tools/call' end-to-end: that would require a live
// network POST to the EVIDE API inside evidePost(), which is inappropriate
// for a unit test. The evide_intake_esb session/run test therefore calls
// buildIntakePayload() directly - the same function the real tools/call
// handler calls internally - and is labeled as such below, not as a
// full dispatch-through-SDK-to-network test.

process.env.EVIDE_MCP_TEST_IMPORT = '1';
process.env.EVIDE_API_KEY     ??= 'evd_test_dummy_key';
process.env.EVIDE_DAPI_NUMBER ??= '0000000000';
process.env.EVIDE_OWNER_ID    ??= 'test-owner';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// Dynamic import, deliberately not static: a static `import` is hoisted by
// the ES module loader and would run before the process.env assignments
// above, regardless of source order - defeating EVIDE_MCP_TEST_IMPORT and
// the dummy credentials.
const { CONFIG, meaningfulValue, buildExecutionIdentity, buildIntakePayload, buildEscalatePayload, server } =
    await import('../index.js');

function resetConfig() {
    CONFIG.agentId        = undefined;
    CONFIG.agentSystem    = undefined;
    CONFIG.modelReference = undefined;
    CONFIG.agentName      = undefined;
    CONFIG.deploymentId   = undefined;
}

beforeEach(() => {
    resetConfig();
});

// ---------------------------------------------------------------------------
// 1. Minimal future execution_identity: only type + accountability_model
// ---------------------------------------------------------------------------
test('1. minimal record: only type and accountability_model present', () => {
    const identity = buildExecutionIdentity();
    assert.deepEqual(identity, {
        type: 'agent_identity',
        accountability_model: 'owner_bound',
    });
});

// ---------------------------------------------------------------------------
// 2. Legacy-style record: agent_id + agent_system, nothing else
// ---------------------------------------------------------------------------
test('2. legacy-style record: agent_id and agent_system present, no other optional field', () => {
    CONFIG.agentId = 'legal-intake-agent';
    CONFIG.agentSystem = 'CLARIXO';

    const identity = buildExecutionIdentity();
    assert.deepEqual(identity, {
        type: 'agent_identity',
        agent_id: 'legal-intake-agent',
        agent_system: 'CLARIXO',
        accountability_model: 'owner_bound',
    });
});

// ---------------------------------------------------------------------------
// 3. Expanded deployment-level metadata
// ---------------------------------------------------------------------------
test('3. expanded record: model_reference, agent_name, deployment_id all present', () => {
    CONFIG.agentId        = 'legal-intake-agent';
    CONFIG.agentSystem    = 'CLARIXO';
    CONFIG.modelReference = 'claude-sonnet-4-6-20260514';
    CONFIG.agentName      = 'Legal Intake Agent';
    CONFIG.deploymentId   = 'legal-intake-prod-eu-2026-07';

    const identity = buildExecutionIdentity();
    assert.deepEqual(identity, {
        type: 'agent_identity',
        agent_id: 'legal-intake-agent',
        agent_system: 'CLARIXO',
        model_reference: 'claude-sonnet-4-6-20260514',
        agent_name: 'Legal Intake Agent',
        deployment_id: 'legal-intake-prod-eu-2026-07',
        accountability_model: 'owner_bound',
    });
});

// ---------------------------------------------------------------------------
// 4. session_id only
// ---------------------------------------------------------------------------
test('4. session_id supplied, run_id absent', () => {
    const identity = buildExecutionIdentity('sess_8f21c', null);
    assert.deepEqual(identity, {
        type: 'agent_identity',
        session_id: 'sess_8f21c',
        accountability_model: 'owner_bound',
    });
    assert.equal('run_id' in identity, false, 'run_id must be omitted, not null');
});

// ---------------------------------------------------------------------------
// 5. run_id only
// ---------------------------------------------------------------------------
test('5. run_id supplied, session_id absent', () => {
    const identity = buildExecutionIdentity(null, 'run_3af90d');
    assert.deepEqual(identity, {
        type: 'agent_identity',
        run_id: 'run_3af90d',
        accountability_model: 'owner_bound',
    });
    assert.equal('session_id' in identity, false, 'session_id must be omitted, not null');
});

// ---------------------------------------------------------------------------
// 6. Both session_id and run_id
// ---------------------------------------------------------------------------
test('6. both session_id and run_id supplied, alongside deployment-level fields', () => {
    CONFIG.agentId     = 'legal-intake-agent';
    CONFIG.agentSystem = 'CLARIXO';

    const identity = buildExecutionIdentity('sess_8f21c', 'run_3af90d');
    assert.deepEqual(identity, {
        type: 'agent_identity',
        agent_id: 'legal-intake-agent',
        agent_system: 'CLARIXO',
        session_id: 'sess_8f21c',
        run_id: 'run_3af90d',
        accountability_model: 'owner_bound',
    });
});

// ---------------------------------------------------------------------------
// 7. Omission of all unavailable optional fields
// ---------------------------------------------------------------------------
test('7. every unavailable optional field is a genuinely absent key, not null/empty', () => {
    const identity = buildExecutionIdentity();
    const optionalKeys = [
        'agent_id', 'agent_system', 'model_reference',
        'agent_name', 'deployment_id', 'session_id', 'run_id',
    ];
    for (const key of optionalKeys) {
        assert.equal(key in identity, false, `${key} must be an absent key`);
    }
    assert.equal(Object.keys(identity).length, 2, 'only type and accountability_model should be present');
});

// ---------------------------------------------------------------------------
// 8. Old placeholder fallbacks are never emitted again
// ---------------------------------------------------------------------------
test('8. legacy placeholders ("agent_unspecified", "Unknown Agent System") never appear in execution_identity', () => {
    const identity = buildExecutionIdentity();
    const serialized = JSON.stringify(identity);
    assert.ok(!serialized.includes('agent_unspecified'), 'agent_unspecified must not appear');
    assert.ok(!serialized.includes('Unknown Agent System'), 'Unknown Agent System must not appear in execution_identity');
});

// ---------------------------------------------------------------------------
// 9. accountability_model remains 'owner_bound' regardless of declared context
// ---------------------------------------------------------------------------
test('9. accountability_model stays owner_bound across every scenario, never derived from other fields', () => {
    const scenarios = [
        () => buildExecutionIdentity(),
        () => { CONFIG.agentId = 'x'; return buildExecutionIdentity(); },
        () => { CONFIG.agentSystem = 'y'; return buildExecutionIdentity(); },
        () => buildExecutionIdentity('sess_1', null),
        () => buildExecutionIdentity(null, 'run_1'),
        () => buildExecutionIdentity('sess_1', 'run_1'),
    ];
    for (const scenario of scenarios) {
        resetConfig();
        const identity = scenario();
        assert.equal(identity.accountability_model, 'owner_bound');
    }
});

// ---------------------------------------------------------------------------
// 10. Whitespace-only values (hardening finding 5)
// ---------------------------------------------------------------------------
test('10a. meaningfulValue() rejects whitespace-only and empty strings, without normalizing meaningful ones', () => {
    assert.equal(meaningfulValue(undefined), null);
    assert.equal(meaningfulValue(null), null);
    assert.equal(meaningfulValue(''), null);
    assert.equal(meaningfulValue('   '), null);
    assert.equal(meaningfulValue('\t'), null);
    assert.equal(meaningfulValue('\n  \n'), null);
    assert.equal(meaningfulValue('x'), 'x');
    // trim() is used only as a presence test - the returned value must be
    // the exact original string, not a trimmed copy of it.
    assert.equal(meaningfulValue('  legal-intake-agent  '), '  legal-intake-agent  ', 'meaningful values are preserved exactly as supplied, not trimmed');
});

test('10b. whitespace-only CONFIG values are omitted from execution_identity, not preserved verbatim', () => {
    CONFIG.agentId        = '   ';
    CONFIG.agentSystem    = '\t';
    CONFIG.modelReference = '\n';
    CONFIG.agentName      = '';
    CONFIG.deploymentId   = undefined;

    const identity = buildExecutionIdentity('  ', '\t\t');
    assert.deepEqual(identity, {
        type: 'agent_identity',
        accountability_model: 'owner_bound',
    });
});

test('10c. a whitespace-padded but meaningful deployment-level value is preserved exactly as supplied, not trimmed', () => {
    CONFIG.agentId = '  legal-intake-agent  ';
    const identity = buildExecutionIdentity();
    assert.equal(identity.agent_id, '  legal-intake-agent  ', 'no application-level normalization of a meaningful declared value');
});

test('10d. a whitespace-padded but meaningful session_id/run_id is preserved exactly as supplied, not trimmed', () => {
    const identity = buildExecutionIdentity('  sess_8f21c  ', '\trun_3af90d\t');
    assert.equal(identity.session_id, '  sess_8f21c  ', 'no application-level normalization of a meaningful declared value');
    assert.equal(identity.run_id, '\trun_3af90d\t', 'no application-level normalization of a meaningful declared value');
});

// ---------------------------------------------------------------------------
// Integration: session_id/run_id and source_system through the payload
// builders (buildIntakePayload / buildEscalatePayload directly - these are
// the same functions the real tools/call handlers invoke internally).
// ---------------------------------------------------------------------------
test('integration: buildIntakePayload propagates sessionId/runId into execution_identity', () => {
    const payload = buildIntakePayload({
        sourceReference: 'ref-1',
        decisionType: 'test_decision',
        decisionSummary: 'test',
        sessionId: 'sess_int_1',
        runId: 'run_int_1',
    });
    assert.equal(payload.execution_identity.session_id, 'sess_int_1');
    assert.equal(payload.execution_identity.run_id, 'run_int_1');
    assert.equal(payload.execution_identity.accountability_model, 'owner_bound');
});

test('integration: buildIntakePayload omits session_id/run_id when not supplied', () => {
    const payload = buildIntakePayload({
        sourceReference: 'ref-2',
        decisionType: 'test_decision',
        decisionSummary: 'test',
    });
    assert.equal('session_id' in payload.execution_identity, false);
    assert.equal('run_id' in payload.execution_identity, false);
});

test('integration: buildIntakePayload rejects whitespace-only sessionId/runId', () => {
    const payload = buildIntakePayload({
        sourceReference: 'ref-2b',
        decisionType: 'test_decision',
        decisionSummary: 'test',
        sessionId: '   ',
        runId: '\t',
    });
    assert.equal('session_id' in payload.execution_identity, false);
    assert.equal('run_id' in payload.execution_identity, false);
});

test('integration: buildIntakePayload still produces a required source_system even with agentSystem unset', () => {
    // Regression guard for the source_system/agent_system decoupling fix:
    // source_system is a separate, required, pre-existing top-level field
    // and must never be omitted, unlike execution_identity.agent_system.
    const payload = buildIntakePayload({
        sourceReference: 'ref-3',
        decisionType: 'test_decision',
        decisionSummary: 'test',
    });
    assert.equal(typeof payload.source_system, 'string');
    assert.ok(payload.source_system.length > 0, 'source_system must never be empty/undefined');
    assert.equal('agent_system' in payload.execution_identity, false, 'execution_identity.agent_system must still be omitted');
});

test('integration: buildEscalatePayload propagates sessionId/runId into execution_identity', () => {
    const payload = buildEscalatePayload({
        sourceReference: 'ref-4',
        agentStateSummary: 'test state',
        escalationTrigger: 'governance_uncertainty',
        escalationReason: 'test reason',
        sessionId: 'sess_esc_1',
        runId: 'run_esc_1',
    });
    assert.equal(payload.execution_identity.session_id, 'sess_esc_1');
    assert.equal(payload.execution_identity.run_id, 'run_esc_1');
    assert.equal(payload.execution_identity.accountability_model, 'owner_bound');
});

test('integration: buildEscalatePayload still produces a required source_system even with agentSystem unset', () => {
    const payload = buildEscalatePayload({
        sourceReference: 'ref-5',
        agentStateSummary: 'test state',
        escalationTrigger: 'governance_uncertainty',
        escalationReason: 'test reason',
    });
    assert.equal(typeof payload.source_system, 'string');
    assert.ok(payload.source_system.length > 0, 'source_system must never be empty/undefined');
});

// evide_intake_esb calls buildIntakePayload() internally - same function
// already covered above. This test is named for evide_intake_esb explicitly
// (hardening finding 6) but is honestly the same code path as the
// evide_intake tests above, not a separate implementation to verify.
test('integration: evide_intake_esb path (buildIntakePayload) carries session_id/run_id, same as evide_intake', () => {
    const payload = buildIntakePayload({
        sourceReference: 'ref-esb-1',
        decisionType: 'test_decision',
        decisionSummary: 'test',
        sessionId: 'sess_esb_1',
        runId: 'run_esb_1',
    });
    assert.equal(payload.execution_identity.session_id, 'sess_esb_1');
    assert.equal(payload.execution_identity.run_id, 'run_esb_1');
});

// ---------------------------------------------------------------------------
// Tool schema exposure - invokes the REAL handler the MCP SDK registered
// for the 'tools/list' JSON-RPC method. No network call: this method only
// returns the static tool definitions, it never calls evidePost().
// ---------------------------------------------------------------------------
test('schema: real SDK tools/list handler exposes session_id/run_id on all three tools', async () => {
    const registeredHandler = server._requestHandlers.get('tools/list');
    assert.ok(registeredHandler, 'no handler registered for tools/list - SDK registration may have changed');

    const result = await registeredHandler({ method: 'tools/list', params: {} }, {});
    const byName = Object.fromEntries(result.tools.map(t => [t.name, t]));

    for (const toolName of ['evide_intake', 'evide_escalate', 'evide_intake_esb']) {
        assert.ok(byName[toolName], `${toolName} missing from real tools/list response`);
        const props = byName[toolName].inputSchema.properties;
        assert.ok(props.session_id, `${toolName}.session_id missing from schema`);
        assert.equal(props.session_id.type, 'string');
        assert.ok(props.run_id, `${toolName}.run_id missing from schema`);
        assert.equal(props.run_id.type, 'string');
        assert.ok(!byName[toolName].inputSchema.required?.includes('session_id'), `${toolName}.session_id must not be required`);
        assert.ok(!byName[toolName].inputSchema.required?.includes('run_id'), `${toolName}.run_id must not be required`);
    }
});
