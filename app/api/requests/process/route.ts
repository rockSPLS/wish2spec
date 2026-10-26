import { userErrorText } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { badRequest, parseBody, processRequestSchema } from "@/lib/input";
import { NO_DOCUMENTS, processRequestText } from "@/lib/process";
import {
  finishProcessing,
  readDocuments,
  readRequests,
  startNewVersion,
  startProcessing,
  updateRequest,
} from "@/lib/store";

// Обработка одной входящей заявки. Страница отправляет заявки сюда по очереди, по одной,
// и сразу показывает готовые. Результат или ошибка сохраняются в data/requests.json.
// «Обработать заново» (again или исправленный текст): перед обработкой текущий результат
// вместе с правками аналитика сохраняется как прежняя версия (lib/store.ts, startNewVersion)

export async function POST(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, processRequestSchema);
  if (error) return error;

  const incoming = (await readRequests()).find((r) => r.id === data.id);
  if (!incoming) return Response.json({ error: "Заявка не найдена." }, { status: 404 });
  const again = data.again === true || data.text !== undefined;
  if (incoming.status === "done" && !again) return Response.json({ request: incoming });
  // Без документов обработка заведомо не пройдёт — прежний вариант не трогаем
  if (again && (await readDocuments()).length === 0) return badRequest(NO_DOCUMENTS);
  if (!startProcessing(incoming.id)) {
    return Response.json(
      { error: "Заявка уже обрабатывается — например, в другой вкладке. Обновите страницу через минуту." },
      { status: 409 },
    );
  }

  try {
    const current = again ? await startNewVersion(incoming.id, data.text) : incoming;
    if (!current) return Response.json({ error: "Заявка не найдена." }, { status: 404 });
    try {
      const result = await processRequestText(current.text);
      const updated = await updateRequest(current.id, { status: "done", result, error: null });
      return Response.json({ request: updated });
    } catch (e) {
      // В строке и карточке — понятный текст; текст ошибки и код ответа — в терминале запуска
      const message = userErrorText(e);
      const updated = await updateRequest(current.id, { status: "error", result: null, error: message });
      return Response.json({ request: updated, error: message }, { status: 502 });
    }
  } finally {
    finishProcessing(incoming.id);
  }
}
