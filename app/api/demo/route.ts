import { readDemoData } from "@/lib/demo";
import { indexingErrorResponse } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { demoDataSchema, parseBody } from "@/lib/input";
import { readDocuments, readRequests, saveDemoData, summarize } from "@/lib/store";

// «Загрузить демо-данные»: пять документов и 12 заявок из demo/, без обработки.
// Только когда нет ни документов, ни заявок — иначе отказ, и ничего не меняется.
// Работает и в npm start: это функция продукта, а не маршрут разработки

const ALREADY_LOADED = "Документы или заявки уже есть — демо-данные не загружены. Обновите страницу.";

const alreadyLoaded = () => Response.json({ error: ALREADY_LOADED }, { status: 409 });

export async function POST(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { error } = await parseBody(request, demoDataSchema);
  if (error) return error;

  // Сразу, чтобы не индексировать зря; ещё раз — при записи (saveDemoData)
  if ((await readDocuments()).length > 0 || (await readRequests()).length > 0) return alreadyLoaded();

  let saved: Awaited<ReturnType<typeof saveDemoData>>;
  try {
    const demo = await readDemoData();
    saved = await saveDemoData(demo.documents, demo.texts);
  } catch (e) {
    // Чтение demo/, индексация или запись в data/ — общий ответ с советом нажать кнопку ещё раз
    return indexingErrorResponse(e, "demo");
  }
  if (!saved) return alreadyLoaded();
  return Response.json({ documents: summarize(saved.documents), requests: saved.requests });
}
