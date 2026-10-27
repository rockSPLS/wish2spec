import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentFormat } from "./chunking";
import { indexDocument } from "./search";
import { splitRequests } from "./split-requests";
import type { StoredDocument } from "./store";

// «Загрузить демо-данные»: документы вымышленной студии йоги и входящие заявки из demo/.
// Список файлов задан здесь — путь от страницы не принимается. Те же пять документов перечислены
// в README («Как попробовать»); «Ожидаемые вердикты.json» — для замеров, в демо-данные не входит

const DEMO_DIR = path.join(process.cwd(), "demo");

const DEMO_DOCUMENTS: { file: string; format: DocumentFormat }[] = [
  { file: "Справка по модулям.md", format: "md" },
  { file: "ТЗ Лист ожидания на занятие.md", format: "md" },
  { file: "ТЗ Онлайн-оплата абонемента.md", format: "md" },
  { file: "Список задач.md", format: "md" },
  { file: "Глоссарий.txt", format: "txt" },
];

const DEMO_REQUESTS_FILE = "Входящие заявки.txt";

// Документы индексируются и заявки разбиваются тем же кодом, что при обычной загрузке.
// Название документа — имя файла без расширения, как при загрузке файла на странице
export async function readDemoData(): Promise<{ documents: StoredDocument[]; texts: string[] }> {
  const documents: StoredDocument[] = [];
  for (const { file, format } of DEMO_DOCUMENTS) {
    const text = await readFile(path.join(DEMO_DIR, file), "utf8");
    documents.push(await indexDocument(path.parse(file).name, text, format));
  }
  const texts = splitRequests(await readFile(path.join(DEMO_DIR, DEMO_REQUESTS_FILE), "utf8"));
  return { documents, texts };
}
