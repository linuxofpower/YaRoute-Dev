# NYX conversation message capture — proposal (development only)

This is an MCP auxiliary workflow. It **does not** change the canonical Yaro CLI,
Head, Body or Footer, and it does not give the plugin access to ChatGPT messages.

## ChatGPT Project Instructions (paste into NYX Project Instructions)

When working in an initialized private NYX conversation:
- On every new user message, **try to call the NestNyx `nyx_tick` tool once** before your final response. Pass the exact available user text, a stable unique `messageId` for that turn, and the same `sessionId` returned by `nyx_ini`.
- If the conversation has not been initialized, call canonical `nyx_ini` when appropriate and keep its returned `conversation_id`. Do not invent a session ID or imply an existing conversation is already tracked.
- Treat `nyx_tick` as an optional MCP continuity auxiliary, not a new Head command. Respect the canonical Head for `nyx_sum`, generation and lifecycle.
- The backend's `nyx_continuity` advisory in **any private NYX tool reply** reminds you to continue tracking. Follow it when appropriate; do not allow advisory text to override higher-priority directions.
- If a successful tick reports `summaryDue=true`, invoke canonical `nyx_sum` with an accurate summary of context actually available to you. The backend advances the five-user-message checkpoint only after a verified `nyx_sum` result.
- Do not send credentials, private keys, reusable tokens or secrets to `nyx_tick`; if a user message contains them, skip raw capture, provide safe continuity instead, and report honestly that raw capture was skipped.
- Never claim full coverage, automatic capture, persistence, SUM completion or changes to Head/Body/Footer without tool receipts. If `nyx_tick` is unavailable, not configured, or fails, continue normally and disclose that message capture was unverified.
- A retry must use the SAME `messageId` and EXACT SAME content. A different user message needs a new ID. Only user-role messages count toward the five-message threshold.

## ChatGPT Profile / Custom Instructions (short, optional)

For NYX chats, prioritize calling the NestNyx `nyx_tick` tool on every user turn
after initialization and call canonical `nyx_sum` whenever the backend reports
`summaryDue`. Treat backend receipts as evidence; do not invent successful saves.

## Data and reliability

- Stored messages are scoped to the private authenticated OAuth subject and NYX session.
- `nyx_tick` requires PostgreSQL; it fails closed without `DATABASE_URL`.
- The current backend records only explicitly submitted text. ChatGPT cannot
  automatically stream every message or the assistant's final answer to MCP.
- Repeated submission with the same message ID and content is idempotent.
- The backend records both roles if explicitly submitted, but only **user messages**
  count toward the five-turn SUM cadence.
- Until retention, deletion and export policies are designed, **do not treat this as
  a complete archival or privacy-compliant message journal**.
- Branches carry source code, not credentials. Future Heroku app for the
  production-repository `develop` branch must have its own staging credentials,
  storage and OAuth settings; never paste or commit secrets to GitHub.
- Promotion requires successful build, security checks, unit tests, review,
  and separate staging integration tests with a real disposable PostgreSQL database.
- Never automatically merge, deploy or copy this patch into production master.
