import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { getConfig } from "./config";

// Подключение к OpenAI-совместимому сервису (Vercel AI Gateway, OpenRouter, OpenAI и т. п.).
// Адрес, ключ и модель — из настроек; эмбеддинги по ключу идут через тот же сервис.

// Имя провайдера — ещё и ключ его параметров в providerOptions
const PROVIDER_NAME = "llm";

function provider() {
  const { llm } = getConfig();
  return createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: llm.baseUrl,
    apiKey: llm.apiKey,
  });
}

export function chatModel() {
  const { llm } = getConfig();
  const model = provider().chatModel(llm.model);
  if (!llm.reasoningEffort) return model;
  // reasoning_effort добавляется ко всем вызовам модели, чтобы не передавать его в каждом месте
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: {
        providerOptions: { [PROVIDER_NAME]: { reasoningEffort: llm.reasoningEffort } },
      },
    }),
  });
}

export function apiEmbeddingModel(modelId: string) {
  return provider().embeddingModel(modelId);
}
