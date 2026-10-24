import "server-only";
import path from "node:path";
import { embedMany } from "ai";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { getConfig } from "./config";
import { apiEmbeddingModel } from "./llm";

// Эмбеддинги — векторы смысла текста: по ним ищутся фрагменты документов, близкие к пожеланию.
// Режим local — модель работает на этом компьютере, тексты никуда не отправляются.
// Режим api — тексты уходят в сервис из настроек (запасной путь, если модель не скачивается).

// Многоязычная модель с русским; веса ONNX — конверсия intfloat/multilingual-e5-small (лицензия MIT)
export const LOCAL_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";

// Модели e5 обучены с префиксами: «query: » — запрос (пожелание), «passage: » — фрагмент документа
export type EmbeddingKind = "query" | "passage";

let localPipeline: Promise<FeatureExtractionPipeline> | null = null;

function getLocalPipeline(): Promise<FeatureExtractionPipeline> {
  localPipeline ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    // Модель скачивается один раз в data/models/ (папка в .gitignore), а не в node_modules,
    // где она пропала бы при переустановке пакетов
    env.cacheDir = path.join(process.cwd(), "data", "models");
    // q8 — квантованные веса (~118 МБ вместо ~470 МБ у fp32)
    return pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL, { dtype: "q8" });
  })().catch((error: unknown) => {
    // Неудачную загрузку не запоминаем — следующий вызов попробует снова
    localPipeline = null;
    throw error;
  });
  return localPipeline;
}

export async function embedTexts(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
  const { embeddings } = getConfig();
  if (embeddings.mode === "api") {
    const result = await embedMany({ model: apiEmbeddingModel(embeddings.model), values: texts });
    return result.embeddings;
  }
  const extractor = await getLocalPipeline();
  const output = await extractor(
    texts.map((t) => `${kind}: ${t}`),
    { pooling: "mean", normalize: true },
  );
  return output.tolist() as number[][];
}
