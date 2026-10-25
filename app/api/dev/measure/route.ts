import { errorText } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { measureSchema, parseBody } from "@/lib/input";
import { processRequestText } from "@/lib/process";

// Маршрут замера (только при `npm run dev`) — для scripts/measure-reasoning.mjs.
// Прогоняет текст заявки через ту же обработку, что и продукт, с заданным уровнем рассуждения
// и ничего не сохраняет. В production-сборке отвечает 404.

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response("Not found", { status: 404 });
  }
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, measureSchema);
  if (error) return error;
  try {
    const result = await processRequestText(data.text, { reasoningEffort: data.reasoningEffort });
    return Response.json({ result });
  } catch (e) {
    return Response.json({ error: errorText(e) }, { status: 502 });
  }
}
