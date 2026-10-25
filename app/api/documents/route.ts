import { connection } from "next/server";
import { errorText } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { badRequest, deleteDocumentSchema, LIMITS, parseBody, uploadDocumentsSchema } from "@/lib/input";
import { indexDocument } from "@/lib/search";
import { deleteDocument, readDocuments, saveDocuments, summarize } from "@/lib/store";

// «Документация системы»: список документов, загрузка (с заменой по имени), удаление

export async function GET(request: Request) {
  // Без этого Next.js при сборке попробовал бы выполнить обработчик заранее
  await connection();
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  return Response.json({ documents: summarize(await readDocuments()) });
}

export async function POST(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, uploadDocumentsSchema);
  if (error) return error;

  const names = new Set(data.documents.map((d) => d.name));
  if (names.size !== data.documents.length) {
    return badRequest("В одной загрузке два документа с одинаковым названием.");
  }
  const existing = (await readDocuments()).filter((d) => !names.has(d.name));
  if (existing.length + names.size > LIMITS.documentsTotal) {
    return badRequest(`Документов может быть не больше ${LIMITS.documentsTotal}.`);
  }

  try {
    const indexed = [];
    for (const doc of data.documents) {
      const stored = await indexDocument(doc.name, doc.text, doc.format);
      if (stored.chunks.length === 0) return badRequest(`В документе «${doc.name}» нет текста.`);
      indexed.push(stored);
    }
    const documents = await saveDocuments(indexed);
    return Response.json({ documents: summarize(documents) });
  } catch (e) {
    return Response.json({ error: `Не удалось проиндексировать документы: ${errorText(e)}` }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, deleteDocumentSchema);
  if (error) return error;
  const { documents, found } = await deleteDocument(data.name);
  if (!found) return Response.json({ error: "Документ не найден." }, { status: 404 });
  return Response.json({ documents: summarize(documents) });
}
