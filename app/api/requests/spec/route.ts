import { REQUEST_BUSY, userErrorText } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { badRequest, parseBody, specRequestSchema } from "@/lib/input";
import { prepareSpec } from "@/lib/process";
import { changeRequest, finishProcessing, readRequests, startProcessing } from "@/lib/store";

// «Подготовить основу ТЗ» для заявки с любым вердиктом (lib/process.ts, prepareSpec).
// Ошибка сервиса не меняет результат заявки — она показывается рядом с кнопкой

export async function POST(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, specRequestSchema);
  if (error) return error;

  const incoming = (await readRequests()).find((r) => r.id === data.id);
  if (!incoming) return Response.json({ error: "Заявка не найдена." }, { status: 404 });
  const result = incoming.result;
  if (!result) return badRequest("Заявка ещё не обработана.");
  if (result.spec || incoming.edits?.spec) return Response.json({ request: incoming });
  // Та же защита, что у обработки: пока готовится основа ТЗ, заявку не обработать заново, и наоборот
  if (!startProcessing(incoming.id)) {
    return Response.json({ error: REQUEST_BUSY }, { status: 409 });
  }

  try {
    const { spec, usage } = await prepareSpec(incoming.text, result);
    const updated = await changeRequest(incoming.id, (r) => {
      // Результат могли заменить, пока модель отвечала (например, «Вернуть прежний вариант» из другой
      // вкладки), — тогда основа ТЗ к нему не относится
      if (r.result?.processedAt !== result.processedAt) return;
      r.result.spec = spec;
      r.result.usage = { ...r.result.usage, spec: usage };
    });
    return Response.json({ request: updated });
  } catch (e) {
    return Response.json({ error: userErrorText(e, "spec") }, { status: 502 });
  } finally {
    finishProcessing(incoming.id);
  }
}
