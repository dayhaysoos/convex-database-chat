# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0-alpha.0] - 2026-08-28 (alpha)

### Breaking

- `DatabaseChatClient.addMessage` and `getMessagesForLLM` are now
  fail-closed: they require an identity (a configured `getExternalId`
  resolver or an explicit `externalId`) and throw when none is available.
  Previously they silently bypassed ownership checks.
- `DatabaseChatApi` (the object passed to `DatabaseChatProvider`) now
  declares exact argument and return types for each entry. Wrappers whose
  arguments don't match the expected shape will surface type errors at
  compile time.

### Added

- `messages.addForExternalId`: ownership-checked message write, mirroring
  the other `*ForExternalId` endpoints.
- `DatabaseChatClient.getMessagesForLLM` now replays assistant
  `tool_calls` and tool results faithfully for bring-your-own-SDK
  consumers, matching the main send path's behavior.

### Changed

- `client.ts` uses structural context types instead of
  `GenericQueryCtx<any>`-style aliases, and centralizes its component-ID
  conversions behind named boundary helpers.

## [0.4.0] - 2026-08-28

### Added

- **OpenRouter provider module** (`src/openrouter/`): the chat-completions and
  embedding calls now share one transport with typed errors, retry, and
  timeout handling. A single attempt-runner owns the connection,
  classification, and backoff protocol for both call types; all provider
  failures surface as `OpenRouterError` with a machine-readable `code` and a
  `retryable` flag.
- Typed error codes on send results: failed sends return `errorCode`
  (`unauthorized`, `rate_limited`, `provider_error`, `network_error`,
  `timeout`, `aborted`, `invalid_request`, `unknown`) and `retryable` next to
  the existing `error` message.
- Automatic retries for transient failures (network errors, 408/429/5xx) with
  exponential backoff, full jitter, and `Retry-After` support. Retries cover
  only the connection phase of a request - content that has already streamed
  is never duplicated. New config: `maxRetries` (default 2).
- Time-to-first-byte timeout per provider attempt (default 30s, configurable
  via `requestTimeoutMs`). Total generation time remains uncapped; the
  existing stream heartbeat still bounds zombie streams.
- `generateEmbedding` now sends the same OpenRouter attribution defaults as
  the chat path (`HTTP-Referer` / `X-Title`) and accepts an `abortSignal`.
- Runtime validation of the standard result contract for tools declaring
  `metadata.resultContract: "standard"`. New config
  `validateResultContract`: `"warn"` (default) logs violations and passes the
  result through; `"enforce"` returns the validation errors to the LLM
  instead of the malformed result; `"off"` skips validation.
- `stoppedReason: "max_tool_loops"` on the send result when the tool loop is
  exhausted without a final answer.

### Fixed

- Trailing SSE lines without a terminating newline were silently dropped at
  the end of a stream; they are now flushed and processed.
- Conversation-history truncation could start the LLM context with tool
  results whose paired assistant `tool_calls` message fell outside the
  window, producing a payload providers reject. Orphaned tool messages are
  now dropped.
- Tool loops that exhaust `maxToolLoops` no longer persist a silently empty
  final assistant message; the persisted message explains the cutoff.
- The enforce path of `validateResultContract` now routes its error envelope
  through the same size cap as every other tool result, so a large set of
  contract errors cannot blow up the LLM context.

### Changed

- `validateResultContract` now validates against the closed set
  (`"off" | "warn" | "enforce"`) at the function boundary; unknown values
  throw a validation error instead of silently running in warn mode. Send
  results carry the typed unions (`errorCode`, `stoppedReason`), and the
  React hook detects aborts solely via `errorCode: "aborted"`.
- **Breaking** (`./vector` entrypoint): `generateEmbedding` options
  `referer` and `title` are renamed to `httpReferer` and `xTitle`, matching
  the chat surface. The function now also throws `OpenRouterError` (an
  `Error` subclass, so existing `instanceof Error` checks keep working) and
  retries transient failures with a whole-request timeout (default 30s).

## [0.3.1] - 2026-08-21

### Changed

- Internal refactor: `executeToolHandler` deduplicated into
  `toolExecution.ts`; shared DataModel-typed context helpers extracted to
  `contextTypes.ts`. No API or behavior changes.

### Fixed

- README: removed examples referencing non-exported functions and replaced
  them with the actual built-in integration path; File Structure listing now
  matches the real tree.

## [0.3.0] - 2026-08-21

### Added

- **Secure-by-default client**: `defineDatabaseChat` accepts a
  `getExternalId(ctx)` resolver. All client data-access methods
  (`getMessages`, `getConversation`, `listConversations`,
  `createConversation`, `getStreamState`, `getStreamDeltas`, `abortStream`,
  `send`) route through ownership-checked `*ForExternalId` endpoints.
- Partial-response persistence: when a stream is interrupted by user abort,
  timeout, or error, content streamed so far is saved as an assistant message
  flagged `partial: true`.
- Final-round-only streaming: intermediate rounds of tool-calling loops no
  longer stream text to clients; only the final answer streams. Streams rotate
  between rounds.
- Tool result caps: serialized tool results sent to the LLM are truncated at
  `maxToolResultChars` (default 16000) and wrapped in a
  `{ truncated: true, originalLength, data }` envelope.
- New configuration options: `maxToolLoops` (default 5), `streamThrottleMs`
  (default 100), `maxToolResultChars` (default 16000), `httpReferer`,
  `xTitle`. Settable at `defineDatabaseChat`, per message, or via the raw
  `chat.send` config.
- New optional schema field: `messages.partial`.
- `Message.partial` surfaced in the React client types.

### Changed

- Client methods that access conversation data now throw when no identity can
  be resolved (no `getExternalId` configured and no explicit `externalId`
  passed) instead of silently skipping access control.

### Fixed

- Conversation history sent to the LLM preserves prior `tool_calls` /
  `tool_results` pairing on multi-turn conversations instead of replaying
  assistant tool-call turns as empty messages.
- Pressing Stop during tool-call generation or execution reliably stops
  generation. Previously the action could continue as a zombie and stream a
  full response after the user aborted.
- `useSmoothText` speed-adaptation: the ease-off branch was unreachable
  because it was gated behind a condition that always matched first.
- OpenRouter `HTTP-Referer` default no longer points at the wrong repository;
  attribution headers are configurable.

### Known limitations

- If the final round of a tool loop fails before streaming any text, content
  from intermediate rounds cannot be recovered (discarded by design on
  rotation).
- Abort detection during tool execution lands at the next tool-loop boundary;
  a long-running individual tool call cannot be interrupted mid-flight.
- Between tool rounds, streams rotate eagerly: clients subscribed to stream
  state may observe a brief `streaming` -> `aborted` -> `streaming`
  transition with no content between rounds.

## [0.2.0] - 2026

Initial public component release: conversation/message storage, delta-based
streaming, abort support, tool calling, React hooks, scoped
`*ForExternalId` endpoints, typed tool builders, result contracts, and tool
guidance injection.

[0.3.1]: https://github.com/dayhaysoos/convex-database-chat/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/dayhaysoos/convex-database-chat/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dayhaysoos/convex-database-chat/releases/tag/v0.2.0
