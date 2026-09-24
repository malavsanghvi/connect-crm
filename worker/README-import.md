# import.suggest_mapping (o-import)

`src/handlers/import.suggest_mapping.ts` is the o-import stream's worker handler. It is
written against the o-vault worker contract (`{ kind, configured, run(job, ctx) }`,
`src/types.ts`, `src/config.ts`, `src/errors.ts`); the o-vault stream owns the rest of
`worker/`. When the branches are integrated:

1. Add `"@anthropic-ai/sdk"` to `worker/package.json` dependencies (the handler uses the
   official SDK: `claude-opus-5`, structured outputs via `output_config.format`,
   server-side refusal fallbacks `fallbacks: "default"`).
2. Register it in `src/handlers/index.ts`: `import * as importSuggestMapping from "./import.suggest_mapping";`
   and add it to `HANDLERS`.
3. Set `ANTHROPIC_API_KEY` on the background service. Without it the job fails at once as
   "not configured" and the portal's Map step says only name-based matching ran.

The portal enqueues the job with `app.import_request_ai_mapping` only when
`app.enqueue_job` exists; the payload is headers plus masked samples only
(`src/lib/import/mask.ts`, masked on the server in the portal's action).

Tests: `worker/test/import.suggest_mapping.test.ts` (vitest, a local mock HTTP server and a
fake key). It passed against a copy of the o-vault worker with `@anthropic-ai/sdk` 0.128.0.
