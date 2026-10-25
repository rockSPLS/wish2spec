import "server-only";
import { cosineSimilarity } from "ai";
import { chunkContent, chunkDocument, type DocumentFormat } from "./chunking";
import { embedTexts } from "./embeddings";
import type { IndexedChunk, StoredDocument } from "./store";

// Индексация документов и поиск фрагментов, близких к заявке

// Сколько ближайших фрагментов передаётся модели. Обычно у заявки 4–5 полезных фрагментов
// (справка, похожая задача, глоссарий, прежнее ТЗ), шестой — запас. Почему не настройка —
// в журнале решений
export const TOP_K = 6;

// Фрагменты считаются пачками: на процессоре так быстрее, чем по одному, а память не переполняется
const EMBED_BATCH = 16;

export async function indexDocument(
  name: string,
  text: string,
  format: DocumentFormat,
): Promise<StoredDocument> {
  const chunks = chunkDocument(name, text, format);
  const indexed: IndexedChunk[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map(chunkContent), "passage");
    batch.forEach((chunk, j) => indexed.push({ ...chunk, embedding: vectors[j] }));
  }
  return { name, format, addedAt: new Date().toISOString(), chunks: indexed };
}

export type Found = { documentName: string; chunk: IndexedChunk; score: number };

export async function findClosest(query: string, documents: StoredDocument[]): Promise<Found[]> {
  const [vector] = await embedTexts([query], "query");
  return documents
    .flatMap((d) =>
      d.chunks.map((chunk) => ({ documentName: d.name, chunk, score: cosineSimilarity(vector, chunk.embedding) })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}
