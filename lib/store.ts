import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Chunk, DocumentFormat } from "./chunking";
import type { DocumentSummary, IncomingRequest } from "./types";

// Хранение в JSON-файлах в data/ (папка не попадает в репозиторий):
// data/index.json — документы, их фрагменты и эмбеддинги; data/requests.json — заявки и результаты.

const DATA_DIR = path.join(process.cwd(), "data");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const REQUESTS_FILE = path.join(DATA_DIR, "requests.json");

export type IndexedChunk = Chunk & { embedding: number[] };

export type StoredDocument = {
  name: string;
  format: DocumentFormat;
  addedAt: string;
  chunks: IndexedChunk[];
};

type IndexFile = { documents: StoredDocument[] };
type RequestsFile = { requests: IncomingRequest[] };

async function readJson<T>(file: string, empty: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw error;
  }
}

// Запись через временный файл и переименование: если процесс прервётся посреди записи,
// прежний файл останется целым
async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, file);
}

// Изменения файлов выполняются по одному: два запроса подряд не перезапишут друг друга
// (в пределах одного запущенного сервера — см. «Один аналитик за раз» в журнале решений).
// Очередь и список заявок в обработке лежат в globalThis, а не в переменной модуля: Next.js может
// загрузить этот модуль отдельно для разных маршрутов, и тогда у каждого была бы своя очередь
type StoreState = { queue: Promise<unknown>; processing: Set<string> };
const state = ((globalThis as { __wish2specStore?: StoreState }).__wish2specStore ??= {
  queue: Promise.resolve(),
  processing: new Set(),
});

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = state.queue.then(task, task);
  state.queue = run.catch(() => undefined);
  return run;
}

// Заявка, которая уже обрабатывается (например, из второй вкладки или после перезагрузки
// страницы), второй раз не отправляется в модель. true — заявку удалось занять
export function startProcessing(id: string): boolean {
  if (state.processing.has(id)) return false;
  state.processing.add(id);
  return true;
}

export function finishProcessing(id: string): void {
  state.processing.delete(id);
}

// Векторы округляются до 6 знаков: файл индекса в разы меньше, на порядок близости это не влияет
function roundVector(vector: number[]): number[] {
  return vector.map((x) => Math.round(x * 1e6) / 1e6);
}

// --- Документы ---

export async function readDocuments(): Promise<StoredDocument[]> {
  return (await readJson<IndexFile>(INDEX_FILE, { documents: [] })).documents;
}

export function summarize(documents: StoredDocument[]): DocumentSummary[] {
  return documents.map((d) => ({ name: d.name, chunkCount: d.chunks.length, addedAt: d.addedAt }));
}

// Документ с тем же именем заменяется
export function saveDocuments(added: StoredDocument[]): Promise<StoredDocument[]> {
  return serialized(async () => {
    const names = new Set(added.map((d) => d.name));
    const documents = (await readDocuments()).filter((d) => !names.has(d.name));
    documents.push(
      ...added.map((d) => ({
        ...d,
        chunks: d.chunks.map((c) => ({ ...c, embedding: roundVector(c.embedding) })),
      })),
    );
    await writeJson(INDEX_FILE, { documents } satisfies IndexFile);
    return documents;
  });
}

export function deleteDocument(name: string): Promise<{ documents: StoredDocument[]; found: boolean }> {
  return serialized(async () => {
    const all = await readDocuments();
    const documents = all.filter((d) => d.name !== name);
    if (documents.length !== all.length) await writeJson(INDEX_FILE, { documents } satisfies IndexFile);
    return { documents, found: documents.length !== all.length };
  });
}

// --- Входящие заявки ---

export async function readRequests(): Promise<IncomingRequest[]> {
  return (await readJson<RequestsFile>(REQUESTS_FILE, { requests: [] })).requests;
}

// Новые заявки добавляются в конец списка, номера продолжают нумерацию
export function appendRequests(texts: string[]): Promise<IncomingRequest[]> {
  return serialized(async () => {
    const requests = await readRequests();
    let number = requests.reduce((max, r) => Math.max(max, r.number), 0);
    const addedAt = new Date().toISOString();
    for (const text of texts) {
      number += 1;
      requests.push({ id: randomUUID(), number, text, addedAt, status: "pending", result: null, error: null });
    }
    await writeJson(REQUESTS_FILE, { requests } satisfies RequestsFile);
    return requests;
  });
}

export function updateRequest(
  id: string,
  change: Pick<IncomingRequest, "status" | "result" | "error">,
): Promise<IncomingRequest | null> {
  return serialized(async () => {
    const requests = await readRequests();
    const request = requests.find((r) => r.id === id);
    if (!request) return null;
    Object.assign(request, change);
    await writeJson(REQUESTS_FILE, { requests } satisfies RequestsFile);
    return request;
  });
}
