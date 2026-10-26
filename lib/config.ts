import "server-only";
import { z } from "zod";

// Настройки сервисов: языковая модель и способ получения эмбеддингов.
// Читаются из .env.local (образец — .env.example). Значений по умолчанию в коде нет:
// каждый запускающий подставляет свой сервис, ключ и модель.

const required = () =>
  z.string({ error: "не задана" }).trim().min(1, { error: "не задана" });

const llmSchema = z.object({
  LLM_BASE_URL: required().pipe(
    z.url({ protocol: /^https?$/, error: "должна быть адресом вида https://…" }),
  ),
  LLM_API_KEY: required(),
  LLM_MODEL: required(),
  // Необязательная: сколько модели «рассуждать» перед ответом. Значения зависят от модели,
  // поэтому передаются в сервис как есть; пустая — параметр не отправляется
  LLM_REASONING_EFFORT: z.string().trim().optional(),
});

// local — эмбеддинги считаются на этом компьютере, api — через сервис из LLM_BASE_URL
const embeddingsSchema = z.discriminatedUnion(
  "EMBEDDINGS_MODE",
  [
    z.object({ EMBEDDINGS_MODE: z.literal("local") }),
    z.object({ EMBEDDINGS_MODE: z.literal("api"), EMBEDDINGS_API_MODEL: required() }),
  ],
  { error: "должна быть local или api" },
);

export type AppConfig = {
  llm: { baseUrl: string; apiKey: string; model: string; reasoningEffort?: string };
  embeddings: { mode: "local" } | { mode: "api"; model: string };
};

// Ошибка настроек: в тексте только имена переменных и что с ними не так, без значений
export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(
      "Проверьте настройки в .env.local (образец — .env.example):\n" +
        problems.map((p) => `- ${p}`).join("\n"),
    );
    this.name = "ConfigError";
  }
}

function describe(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

// Режим эмбеддингов для текста предупреждения на странице. Без проверки остальных настроек:
// страница открывается и тогда, когда .env.local заполнен не до конца
export function embeddingsModeForNotice(): "local" | "api" {
  return process.env.EMBEDDINGS_MODE?.trim() === "api" ? "api" : "local";
}

export function getConfig(): AppConfig {
  // Две части проверяются отдельно, чтобы сразу показать все проблемы, а не первую
  const llm = llmSchema.safeParse(process.env);
  const embeddings = embeddingsSchema.safeParse(process.env);
  if (!llm.success || !embeddings.success) {
    throw new ConfigError([
      ...(llm.success ? [] : describe(llm.error)),
      ...(embeddings.success ? [] : describe(embeddings.error)),
    ]);
  }
  return {
    llm: {
      baseUrl: llm.data.LLM_BASE_URL,
      apiKey: llm.data.LLM_API_KEY,
      model: llm.data.LLM_MODEL,
      reasoningEffort: llm.data.LLM_REASONING_EFFORT || undefined,
    },
    embeddings:
      embeddings.data.EMBEDDINGS_MODE === "api"
        ? { mode: "api", model: embeddings.data.EMBEDDINGS_API_MODEL }
        : { mode: "local" },
  };
}
