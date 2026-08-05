/**
 * AI route composition: provider management, chat, model catalogs, local
 * models (LM Studio + Ollama), engine installation, Codex, Devin, and
 * Cloudflare. Sub-modules live alongside this index.
 */
import type { Router } from "express";

import { mountProviderRoutes } from "./providerRoutes.ts";
import { mountChatRoutes } from "./chatRoutes.ts";
import { mountLmStudioRoutes } from "./lmStudioRoutes.ts";
import { mountOllamaRoutes } from "./ollamaRoutes.ts";
import { mountInstallEngineRoutes } from "./installEngineRoutes.ts";
import { mountCodexRoutes } from "./codexRoutes.ts";
import { mountDevinRoutes } from "./devinRoutes.ts";
import { mountCloudflareRoutes } from "./cloudflareRoutes.ts";

export function mountAiRoutes(router: Router): void {
  mountProviderRoutes(router);
  mountChatRoutes(router);
  mountLmStudioRoutes(router);
  mountOllamaRoutes(router);
  mountInstallEngineRoutes(router);
  mountCodexRoutes(router);
  mountDevinRoutes(router);
  mountCloudflareRoutes(router);
}
