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
    // Ответ по JSON-схеме передаётся сервису как response_format: json_schema (strict).
    // Без этого AI SDK отправил бы только json_object, и схему модель бы не увидела
    supportsStructuredOutputs: true,
  });
}

// Уровень рассуждения: переданное значение, а если его нет — LLM_REASONING_EFFORT из настроек.
// Значение передаёт только маршрут замера (scripts/measure-reasoning.mjs сравнивает уровни,
// не трогая .env.local); продукт ничего не передаёт и работает по настройкам
export function resolveReasoningEffort(override?: string): string | undefined {
  return override ?? getConfig().llm.reasoningEffort;
}

export function chatModel(options: { reasoningEffort?: string } = {}) {
  const { llm } = getConfig();
  const model = provider().chatModel(llm.model);
  const reasoningEffort = resolveReasoningEffort(options.reasoningEffort);
  if (!reasoningEffort) return model;
  // reasoning_effort добавляется ко всем вызовам модели, чтобы не передавать его в каждом месте
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: {
        providerOptions: { [PROVIDER_NAME]: { reasoningEffort } },
      },
    }),
  });
}

export function apiEmbeddingModel(modelId: string) {
  return provider().embeddingModel(modelId);
}
