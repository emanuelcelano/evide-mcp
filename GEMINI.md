# EVIDE MCP Server

This extension connects Gemini CLI to EVIDE (External Evidentiary Deposit) through the `evide` MCP server.

## What the tools do

- `evide_intake` deposits a structured evidentiary record of an AI agent decision.
- `evide_intake_esb`, `evide_buffer_observe`, `evide_buffer_close` manage an Epistemic Stabilization Buffer.
- `evide_escalate` records an escalation to the human owner.
- `evide_owner_info` and `evide_check` report configuration and status.

## How to use them

- Deposit only what the user or the agent actually declares. Do not invent values to fill fields.
- If a value is unknown, leave the optional field out rather than writing a placeholder.
- A deposit preserves declarations and their time of acquisition. It does not prove that a declaration is true, that its author had authority, or that a system behaved as described.
- Credentials (API key and DAPI number) belong to the human or organization responsible for the agent. The agent cannot self-certify.
- Ask the user before making a deposit when the content or its consequences are unclear.

Documentation: https://app.certifywebcontent.com/docs/evide-mcp/
