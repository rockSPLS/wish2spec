import { connection } from "next/server";
import { cosineSimilarity, generateText } from "ai";
import { ConfigError, getConfig } from "@/lib/config";
import { embedTexts } from "@/lib/embeddings";
import { chatModel } from "@/lib/llm";

// Маршрут проверки подключений (только при `npm run dev`): http://localhost:3003/api/dev/check
// Отправляет модели короткий русский запрос и считает эмбеддинги трёх фраз
// в выбранном режиме (local или api). В production-сборке отвечает 404.

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function forbidden(text: string): Response {
  return new Response(text, {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  // Без этого Next.js при сборке попробовал бы выполнить обработчик заранее
  await connection();
  if (process.env.NODE_ENV !== "development") {
    return new Response("Not found", { status: 404 });
  }

  // Только по адресу этого компьютера: чужой домен, который подменой DNS указывает
  // на 127.0.0.1 (DNS rebinding), браузер счёл бы «своим» сайтом. Порт любой.
  const hostname = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return forbidden("Проверка работает только по адресу localhost или 127.0.0.1.");
  }

  // Запросы с чужих сайтов (например, картинкой на посторонней странице) не выполняем:
  // иначе любая открытая в браузере страница могла бы тратить ключ. Адрес, введённый
  // вручную, браузер помечает Sec-Fetch-Site: none; программы вне браузера (curl, скрипты Node)
  // этот заголовок не отправляют и проходят.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "none" && site !== "same-origin") {
    return forbidden("Запрос пришёл с другого сайта. Скопируйте адрес в адресную строку браузера.");
  }

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
