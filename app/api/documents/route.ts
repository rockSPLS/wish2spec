import { connection } from "next/server";
import { embeddingsModeForNotice } from "@/lib/config";
import { indexingErrorResponse } from "@/lib/errors";
import { docxToMarkdown, ExtractError, pdfToText } from "@/lib/extract";
import { rejectForeignRequest } from "@/lib/guard";
import {
  badRequest,
  BODY_LIMITS,
  deleteDocumentSchema,
  parseBody,
  uploadDocumentsSchema,
  type UploadedDocument,
} from "@/lib/input";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import { indexDocument } from "@/lib/search";
import {
  deleteAllDocuments,
  deleteDocument,
  readDocuments,
  saveDocuments,
  summarize,
  type StoredDocument,
} from "@/lib/store";

// «Документация системы»: список документов, загрузка (с заменой по имени), удаление одного или всех.
// PDF и DOCX приходят файлом и здесь превращаются в текст (lib/extract.ts)

export async function GET(request: Request) {
  // Без этого Next.js при сборке попробовал бы выполнить обработчик заранее
  await connection();
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  // Режим эмбеддингов — для предупреждения под шагом «2. Входящие заявки»: что уходит в сервис
  return Response.json({ documents: summarize(await readDocuments()), embeddingsMode: embeddingsModeForNotice() });
}

// Текст документа и как его резать: DOCX — по заголовкам, как Markdown; PDF — по абзацам, как .txt
async function documentText(doc: UploadedDocument): Promise<{ text: string; format: "md" | "txt" }> {
  if ("text" in doc) return { text: doc.text, format: doc.format };
  const buffer = Buffer.from(doc.data, "base64");
  if (doc.format === "docx") return { text: await docxToMarkdown(doc.name, buffer), format: "md" };
  return { text: await pdfToText(doc.name, new Uint8Array(buffer)), format: "txt" };
}

export async function POST(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, uploadDocumentsSchema, BODY_LIMITS.documents);
  if (error) return error;

  const names = new Set(data.documents.map((d) => d.name));
  if (names.size !== data.documents.length) {
    return badRequest("В одной загрузке два документа с одинаковым названием.");
  }
  const existing = (await readDocuments()).filter((d) => !names.has(d.name));
  if (existing.length + names.size > LIMITS.documentsTotal) {
    return badRequest(LIMIT_MESSAGES.documentsTotal(existing.length + names.size));
  }

  try {
    const indexed: StoredDocument[] = [];
    for (const doc of data.documents) {
      const { text, format } = await documentText(doc);
      // У PDF и DOCX размер текста становится известен только после разбора
      if (text.length > LIMITS.documentChars) return badRequest(LIMIT_MESSAGES.documentTooLong(doc.name));
      const stored = await indexDocument(doc.name, text, format, doc.format);
      if (stored.chunks.length === 0) return badRequest(`В документе «${doc.name}» нет текста.`);
      indexed.push(stored);
    }
    const documents = await saveDocuments(indexed);
    return Response.json({ documents: summarize(documents) });
  } catch (e) {
    if (e instanceof ExtractError) return badRequest(e.message);
    return indexingErrorResponse(e);
  }
}

export async function DELETE(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, deleteDocumentSchema);
  if (error) return error;
  // «Удалить все документы» — документы и индекс; готовые результаты заявок не меняются
  if ("all" in data) return Response.json({ documents: summarize(await deleteAllDocuments()) });
  const { documents, found } = await deleteDocument(data.name);
  if (!found) return Response.json({ error: "Документ не найден." }, { status: 404 });
  return Response.json({ documents: summarize(documents) });
}
