import "server-only";
import { cosineSimilarity } from "ai";
import { chunkContent, chunkDocument, splitRequestForSearch, type DocumentFormat } from "./chunking";
import { getConfig } from "./config";
import { embedTexts } from "./embeddings";
import type { IndexedChunk, StoredDocument, StoredFormat } from "./store";

// Индексация документов и поиск фрагментов, близких к заявке

// Сколько ближайших фрагментов передаётся модели — верхняя граница: фрагменты ниже порога
// отбрасываются. Обычно у заявки 4–5 полезных фрагментов (справка, похожая задача, глоссарий,
// прежнее ТЗ), шестой — запас. Почему не настройка — в журнале решений
export const TOP_K = 6;

// Порог «связей не найдено»: фрагмент с близостью ниже не передаётся модели.
// Подобран на 12 демо-заявках: ниже всех нужных фрагментов (самый низкий — 0,799) с запасом.
// Нужные и лишние фрагменты по близости e5 не разделяются, поэтому порог отсекает только текст,
// совсем далёкий от документов. Замер — в DEV_NOTES (v0.2), решение — в журнале решений.
// Только для локальной модели e5: у модели эмбеддингов из сервиса (режим api) близость лежит
// в другом диапазоне, и порог отсёк бы всё — там фрагменты не отбрасываются, как в v0.1
export const MIN_SCORE = 0.79;

// Фрагменты считаются пачками: на процессоре так быстрее, чем по одному, а память не переполняется
const EMBED_BATCH = 16;

export async function indexDocument(
  name: string,
  text: string,
  format: DocumentFormat,
  sourceFormat: StoredFormat = format,
): Promise<StoredDocument> {
  const chunks = chunkDocument(name, text, format);
  const indexed: IndexedChunk[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map(chunkContent), "passage");
    batch.forEach((chunk, j) => indexed.push({ ...chunk, embedding: vectors[j] }));
  }
  return { name, format: sourceFormat, addedAt: new Date().toISOString(), chunks: indexed };
}

export type Found = { documentName: string; chunk: IndexedChunk; score: number };

export type SearchResult = {
  kept: Found[]; // не ниже порога — передаются модели
  discarded: Found[]; // из шестёрки ближайших, но ниже порога
  parts: number; // на сколько частей заявка делилась для поиска
};

// Длинная заявка ищется по частям: у каждого фрагмента берётся лучшая оценка по всем частям,
// дальше — как для короткой. Модели потом уходит полный текст заявки
export async function findClosest(query: string, documents: StoredDocument[]): Promise<SearchResult> {
  const parts = splitRequestForSearch(query);
  const vectors = await embedTexts(parts, "query");
  const top = documents
    .flatMap((d) =>
      d.chunks.map((chunk) => ({
        documentName: d.name,
        chunk,
        score: Math.max(...vectors.map((v) => cosineSimilarity(v, chunk.embedding))),
      })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
  const minScore = getConfig().embeddings.mode === "local" ? MIN_SCORE : -Infinity;
  return {
    kept: top.filter((f) => f.score >= minScore),
    discarded: top.filter((f) => f.score < minScore),
    parts: parts.length,
  };
}
