import "server-only";
import { z } from "zod";

// Проверка всего, что приходит на сервер. Лимиты с запасом; точные лимиты
// и понятные сообщения при их превышении — в версии 0.2.

export const LIMITS = {
  documentNameChars: 200,
  documentChars: 500_000, // примерно 250 страниц текста
  documentsPerUpload: 20,
  documentsTotal: 200,
  requestChars: 5_000,
  requestsPerAdd: 300,
  requestsTotal: 5_000,
};

const text = (max: number) =>
  z
    .string()
    .max(max, { error: `не длиннее ${max} символов` })
    .refine((s) => s.trim().length > 0, { error: "пустой текст" });

export const uploadDocumentsSchema = z.object({
  documents: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { error: "нет названия" })
          .max(LIMITS.documentNameChars, { error: `название не длиннее ${LIMITS.documentNameChars} символов` }),
        format: z.enum(["md", "txt"]),
        text: text(LIMITS.documentChars),
      }),
    )
    .min(1, { error: "нет документов" })
    .max(LIMITS.documentsPerUpload, { error: `не больше ${LIMITS.documentsPerUpload} документов за раз` }),
});

export const deleteDocumentSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.documentNameChars),
});

export const addRequestsSchema = z.object({
  texts: z
    .array(text(LIMITS.requestChars).transform((s) => s.trim()))
    .min(1, { error: "нет заявок" })
    .max(LIMITS.requestsPerAdd, { error: `не больше ${LIMITS.requestsPerAdd} заявок за раз` }),
});

export const processRequestSchema = z.object({
  id: z.string().min(1).max(100),
});

// Только для маршрута замера (npm run dev)
export const measureSchema = z.object({
  text: text(LIMITS.requestChars),
  reasoningEffort: z.string().trim().min(1).max(20),
});

// Тело запроса: JSON по схеме. Ошибка — ответ 400 со списком проблем.
// Content-Type обязан быть application/json: такой запрос с чужой страницы браузер не отправит
// без разрешения CORS — вторая защита на случай браузера без заголовка Sec-Fetch-Site (lib/guard.ts)
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T; error?: never } | { data?: never; error: Response }> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { error: Response.json({ error: "Тело запроса должно быть в формате application/json." }, { status: 415 }) };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: badRequest("Тело запроса — не JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    return { error: badRequest(`Неверные данные: ${problems.slice(0, 5).join(". ")}.`) };
  }
  return { data: parsed.data };
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}
