// src/llm/factory.js
import { classifyBatch as openaiClassify } from "./openai-provider.js";
import { classifyBatch as geminiClassify } from "./gemini-provider.js";
import { classifyBatch as claudeClassify } from "./claude-provider.js";

const PROVIDERS = {
  openai: openaiClassify,
  gemini: geminiClassify,
  claude: claudeClassify,
};

export function getProviderFn(name) {
  const fn = PROVIDERS[name];
  if (!fn) throw new Error(`Unknown provider: ${name}`);
  return fn;
}
