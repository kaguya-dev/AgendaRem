// LLM integration, split by concern:
//   ssrf.ts       network safety: only public HTTPS hosts, DNS pinned to the request socket
//   crypto.ts      AES-256-GCM encryption for stored provider API keys
//   providers.ts   provider CRUD (list/save/delete/reset), persisted in agenda_llm_providers
//   usage.ts       per-provider daily rate limiting and error cooldowns
//   generate.ts    the failover loop: tries providers in priority order until one answers
//   reply.ts       second pass: rewrites the finished reply in natural language, then checks
//                  that no task line, code or date was changed before accepting it
export { isPublicAddress, validateApiUrl } from './ssrf';
export {
  listProviders,
  saveProvider,
  deleteProvider,
  resetProvider,
  detectLocalModels,
} from './providers';
export {
  generateCommands,
  generateText,
  type LlmRequestOptions,
  type ParseResult,
} from './generate';
export { generateReply, checkReply } from './reply';
