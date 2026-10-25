import { errorText } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { parseBody, processRequestSchema } from "@/lib/input";
import { processRequestText } from "@/lib/process";
import { finishProcessing, readRequests, startProcessing, updateRequest } from "@/lib/store";

// Обработка одной входящей заявки. Страница отправляет заявки сюда по очереди, по одной,
// и сразу показывает готовые. Результат или ошибка сохраняются в data/requests.json.

export async function POST(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, processRequestSchema);
  if (error) return error;

  const incoming = (await readRequests()).find((r) => r.id === data.id);
  if (!incoming) return Response.json({ error: "Заявка не найдена." }, { status: 404 });
  if (incoming.status === "done") return Response.json({ request: incoming });
  if (!startProcessing(incoming.id)) {
    return Response.json(
      { error: "Заявка уже обрабатывается — например, в другой вкладке. Обновите страницу через минуту." },
      { status: 409 },
    );
  }

  try {
    const result = await processRequestText(incoming.text);
    const updated = await updateRequest(incoming.id, { status: "done", result, error: null });
    return Response.json({ request: updated });
  } catch (e) {
    const message = errorText(e);
    const updated = await updateRequest(incoming.id, { status: "error", result: null, error: message });
    return Response.json({ request: updated, error: message }, { status: 502 });
  } finally {
    finishProcessing(incoming.id);
  }
}
