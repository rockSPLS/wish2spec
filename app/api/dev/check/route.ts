import { connection } from "next/server";
import { cosineSimilarity, generateText } from "ai";
import { ConfigError, getConfig } from "@/lib/config";
import { embedTexts } from "@/lib/embeddings";
import { errorText } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { chatModel } from "@/lib/llm";

// Маршрут проверки подключений (только при `npm run dev`): http://localhost:3003/api/dev/check
// Отправляет модели короткий русский запрос и считает эмбеддинги трёх фраз
// в выбранном режиме (local или api). В production-сборке отвечает 404.

export async function GET(request: Request) {
  // Без этого Next.js при сборке попробовал бы выполнить обработчик заранее
  await connection();
  if (process.env.NODE_ENV !== "development") {
    return new Response("Not found", { status: 404 });
  }

  // Запросы с чужих сайтов и по чужому адресу не выполняем — см. lib/guard.ts
  const rejected = rejectForeignRequest(request, {
    host: "Проверка работает только по адресу localhost или 127.0.0.1.",
    crossSite: "Запрос пришёл с другого сайта. Скопируйте адрес в адресную строку браузера.",
  });
  if (rejected) return rejected;

  let config;
  try {
    config = getConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      return Response.json({ ok: false, config: error.message }, { status: 500 });
    }
    throw error;
  }

  const model = config.llm.model;
  const reasoningEffort = config.llm.reasoningEffort ?? "не задано";
  let llm;
  try {
    const start = performance.now();
    const { text } = await generateText({
      model: chatModel(),
      prompt: "Ответь одним предложением по-русски: зачем аналитику техническое задание?",
    });
    llm = { ok: true, model, reasoningEffort, ms: Math.round(performance.now() - start), text };
  } catch (error) {
    llm = { ok: false, model, reasoningEffort, error: errorText(error) };
  }

  let embeddings;
  try {
    const phrases = [
      "напоминание о неоплаченном счёте",
      "уведомление о задолженности",
      "смена пароля",
    ];
    const start = performance.now();
    const [a, b, c] = await embedTexts(phrases, "query");
    embeddings = {
      ok: true,
      mode: config.embeddings.mode,
      ms: Math.round(performance.now() - start),
      dimensions: a.length,
      similar: cosineSimilarity(a, b),
      different: cosineSimilarity(a, c),
    };
  } catch (error) {
    embeddings = { ok: false, mode: config.embeddings.mode, error: errorText(error) };
  }

  const ok = llm.ok && embeddings.ok;
  return Response.json({ ok, llm, embeddings }, { status: ok ? 200 : 502 });
}
