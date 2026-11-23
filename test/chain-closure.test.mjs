// Closed chains, continuation chains and partial outcomes (v1.5.0, EVIDE API v2.3).
//
// Imports the real implementation from index.js, guarded from starting a live
// MCP server via EVIDE_MCP_TEST_IMPORT=1. evidePost() is exercised against a
// replaced global fetch: no network request is made.
//
// Run: npm test  (or: node --test test/chain-closure.test.mjs)

process.env.EVIDE_MCP_TEST_IMPORT = '1';
process.env.EVIDE_API_KEY     ??= 'evd_test_dummy_key';
process.env.EVIDE_DAPI_NUMBER ??= '0000000000';
process.env.EVIDE_OWNER_ID    ??= 'test-owner';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const { buildChain, buildIntakePayload, buildEscalatePayload, evidePost, formatEvideResponse, server } =
    await import('../index.js');

const CLOSURE = '8f2c41d0-5b7e-4c1a-9e33-2a6d0f1b7c55';
const PARENT  = 'b39d0270-c894-4598-9dd4-c272341b544e';

function fakeFetch(status, body, headers = {}) {
    return async () => ({
        status,
        headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
        text: async () => body,
    });
}

test('buildChain: continues_closure_id is sent only when declared', () => {
    assert.deepEqual(buildChain(null, null, null, null), { parent_evide_id: null, chain_type: null });
    assert.deepEqual(buildChain(null, 'litigation_hold', 'M-1', CLOSURE),
        { parent_evide_id: null, chain_type: 'litigation_hold', matter_reference: 'M-1', continues_closure_id: CLOSURE });
});

test('buildChain: continues_closure_id with parent_evide_id is refused before any HTTP call', () => {
    assert.throws(() => buildChain(PARENT, null, null, CLOSURE), /cannot be combined with parent_evide_id/);
});

test('buildIntakePayload and buildEscalatePayload carry chain.continues_closure_id', () => {
    const p = buildIntakePayload({ sourceReference: 'r1', decisionType: 't', decisionSummary: 's', continuesClosureId: CLOSURE });
    assert.equal(p.chain.continues_closure_id, CLOSURE);
    assert.equal(p.chain.parent_evide_id, null);
    const e = buildEscalatePayload({ sourceReference: 'r2', agentStateSummary: 'a', escalationTrigger: 'manual', escalationReason: 'x', continuesClosureId: CLOSURE });
    assert.equal(e.chain.continues_closure_id, CLOSURE);
    const n = buildIntakePayload({ sourceReference: 'r3', decisionType: 't', decisionSummary: 's' });
    assert.equal('continues_closure_id' in n.chain, false);
});

test('tool schemas expose continues_closure_id on the three deposit tools', async () => {
    const handler = server._requestHandlers.get('tools/list');
    const res = await handler({ method: 'tools/list', params: {} }, {});
    const byName = Object.fromEntries(res.tools.map((t) => [t.name, t]));
    for (const name of ['evide_intake', 'evide_escalate', 'evide_intake_esb']) {
        assert.ok(byName[name].inputSchema.properties.continues_closure_id, name);
    }
    for (const name of ['evide_buffer_observe', 'evide_buffer_close', 'evide_check', 'evide_owner_info']) {
        assert.equal(byName[name].inputSchema.properties?.continues_closure_id, undefined, name);
    }
});

test('chain_closed: explains the continuation chain, no intake recorded', () => {
    const t = formatEvideResponse({ success: false, error: 'chain_closed', message: 'This chain is closed: no new deposit can be linked to it. To add material, start a continuation chain from the closed chain.', http_status: 409 }, 'EVIDE intake');
    assert.match(t, /^EVIDE intake failed: chain_closed/);
    assert.match(t, /No intake was recorded/);
    assert.match(t, /WITHOUT parent_evide_id/);
    assert.match(t, /continues_closure_id/);
});

test('continuation_invalid: reason and detail are shown', () => {
    const t = formatEvideResponse({ success: false, error: 'continuation_invalid', reason: 'not_authorized', detail: 'organization_unavailable', message: 'You do not have full access to this closed chain.' });
    assert.match(t, /reason: +not_authorized/);
    assert.match(t, /detail: +organization_unavailable/);
});

test('chain_busy_retry: Retry-After is reported, no automatic retry', async () => {
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (...a) => { calls++; return fakeFetch(503, JSON.stringify({ success: false, error: 'chain_busy_retry', message: 'Another operation was using this chain at the same moment. Retry.' }), { 'Retry-After': '2' })(...a); };
    try {
        const r = await evidePost({});
        assert.equal(calls, 1);
        assert.equal(r.http_status, 503);
        assert.equal(r.retry_after, '2');
        const t = formatEvideResponse(r, 'EVIDE intake');
        assert.match(t, /after 2 second/);
        assert.match(t, /does not retry on its own/);
    } finally { globalThis.fetch = orig; }
});

test('partial ESB outcome: recorded intake is not reported as a failed deposit', () => {
    const t = formatEvideResponse({
        success: false, error: 'esb_not_opened_chain_closed', request_recorded: true,
        evide_id: '06f302d6-b9f7-452c-a15b-7fd95a2b2fcb', esb_status: 'not_initialized',
        chain: { chain_position: 3, chain_root_evide_id: PARENT },
        message: 'The intake was recorded (evide_id: 06f302d6-b9f7-452c-a15b-7fd95a2b2fcb). Its ESB buffer was not opened because the chain has been closed. The deposit already exists: do not resend it.',
    }, 'EVIDE ESB intake');
    assert.doesNotMatch(t, /failed/);
    assert.match(t, /WAS RECORDED/);
    assert.match(t, /evide_id: +06f302d6-b9f7-452c-a15b-7fd95a2b2fcb/);
    assert.match(t, /Do not deposit this record again/);
    assert.match(t, /chain_root_evide_id: +b39d0270/);
});

test('non-JSON and empty responses become a readable outcome with the HTTP status', async () => {
    const orig = globalThis.fetch;
    try {
        globalThis.fetch = fakeFetch(500, '');
        let r = await evidePost({});
        assert.equal(r.success, false);
        assert.equal(r.error, 'non_json_response');
        assert.match(r.message, /HTTP 500/);
        assert.match(r.message, /empty body/);
        globalThis.fetch = fakeFetch(502, '<html><body>Bad Gateway</body></html>');
        r = await evidePost({});
        assert.match(r.message, /HTTP 502/);
        assert.match(r.message, /Bad Gateway/);
        assert.match(formatEvideResponse(r, 'EVIDE intake'), /non_json_response/);
    } finally { globalThis.fetch = orig; }
});

test('successful JSON responses are unchanged apart from http_status', async () => {
    const orig = globalThis.fetch;
    try {
        globalThis.fetch = fakeFetch(200, JSON.stringify({ success: true, evide_id: 'x', intake_hash: 'h' }));
        const r = await evidePost({});
        assert.equal(r.success, true);
        assert.equal(r.evide_id, 'x');
        assert.equal(r.http_status, 200);
        assert.equal('retry_after' in r, false);
    } finally { globalThis.fetch = orig; }
});
