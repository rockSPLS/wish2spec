import "server-only";
import { z } from "zod";
import { formatNumber, LIMIT_MESSAGES, LIMITS } from "./limits";

// Проверка всего, что приходит на сервер. Лимиты и тексты сообщений — в lib/limits.ts:
// страница проверяет то же самое до отправки, здесь — вторая проверка на случай, если её обошли.
// В схемах вместо текста ошибки — ключ (например, request-too-long): номер заявки или название
// документа parseBody подставляет по пути ошибки (texts.2 → «Заявка 3»).

const nonEmpty = (s: string) => s.trim().length > 0;

const requestText = z
  .string()
  .max(LIMITS.requestChars, { error: "request-too-long" })
  .refine(nonEmpty, { error: "request-empty" });

const documentName = z
  .string()
  .trim()
  .min(1, { error: "нет названия" })
  .max(LIMITS.documentNameChars, { error: "document-name-too-long" });

// .md, .txt и вставленный текст приходят текстом
const textDocument = z.object({
  name: documentName,
  format: z.enum(["md", "txt"]),
  text: z.string().max(LIMITS.documentChars, { error: "document-too-long" }).refine(nonEmpty, { error: "document-empty" }),
});

// PDF и DOCX приходят файлом в base64 внутри JSON — так остаётся правило «только application/json»
// (см. parseBody). Base64 — 4 символа на каждые 3 байта
const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;
const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.match(/=*$/)?.[0].length ?? 0);

const fileDocument = z.object({
  name: documentName,
  format: z.enum(["pdf", "docx"]),
  data: z
    .string()
    .max(base64Length(LIMITS.fileBytes), { error: "file-too-big" })
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, { error: "file-broken" })
    .refine((s) => s.length > 0, { error: "file-broken" }),
});

export const uploadDocumentsSchema = z.object({
  documents: z
    .array(z.discriminatedUnion("format", [textDocument, fileDocument]))
    .min(1, { error: "нет документов" })
    .max(LIMITS.documentsPerUpload, { error: "too-many-documents" })
    .refine(
      (docs) => docs.reduce((sum, d) => sum + ("data" in d ? base64Bytes(d.data) : 0), 0) <= LIMITS.uploadFileBytes,
      { error: "upload-too-big" },
    ),
});

export type UploadedDocument = z.infer<typeof uploadDocumentsSchema>["documents"][number];

export const deleteDocumentSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.documentNameChars),
});

export const addRequestsSchema = z.object({
  texts: z
    .array(requestText.transform((s) => s.trim()))
    .min(1, { error: "нет заявок" })
    .max(LIMITS.requestsPerAdd, { error: "too-many-requests" }),
});

export const processRequestSchema = z.object({
  id: z.string().min(1).max(100),
});

// Только для маршрута замера (npm run dev)
export const measureSchema = z.object({
  text: requestText,
  reasoningEffort: z.string().trim().min(1).max(20),
});

// Наибольший размер тела запроса: защита от огромной загрузки на компьютере с небольшой памятью.
// Для документов — худший допустимый случай: 20 текстов по 500 000 символов кириллицы (около 20 МБ)
// и файлы на 25 МБ в base64 (около 33 МБ)
export const BODY_LIMITS = {
  default: 1024 * 1024,
  requests: 8 * 1024 * 1024,
  documents: 64 * 1024 * 1024,
};

// Тело читается частями, и чтение прерывается, как только набралось больше предела: заголовку
// Content-Length верить нельзя — программа вне браузера может его не отправить. null — тело больше предела
async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Ключ ошибки схемы → текст для аналитика
function issueText(issue: z.core.$ZodIssue, body: unknown): string {
  const [, index] = issue.path;
  const n = typeof index === "number" ? index + 1 : null;
  const record = (body ?? {}) as { documents?: { name?: unknown }[]; texts?: unknown[] };
  const docName = () => {
    const name = n === null ? undefined : record.documents?.[n - 1]?.name;
    return typeof name === "string" && name.trim() ? name.trim() : `№${n}`;
  };
  switch (issue.message) {
    case "request-too-long":
      return n === null
        ? `Заявка длиннее ${formatNumber(LIMITS.requestChars)} символов — сократите её.`
        : LIMIT_MESSAGES.requestTooLong(n);
    case "request-empty":
      return n === null ? "Заявка пустая." : LIMIT_MESSAGES.requestEmpty(n);
    case "too-many-requests":
      return LIMIT_MESSAGES.tooManyRequests(record.texts?.length ?? 0);
    case "document-name-too-long":
      return LIMIT_MESSAGES.documentNameTooLong(n ?? 1);
    case "document-too-long":
      return LIMIT_MESSAGES.documentTooLong(docName());
    case "document-empty":
      return `В документе «${docName()}» нет текста.`;
    case "file-too-big":
      return LIMIT_MESSAGES.fileTooBig(docName());
    case "file-broken":
      return `Файл «${docName()}» пришёл повреждённым — загрузите его снова.`;
    case "too-many-documents":
      return LIMIT_MESSAGES.tooManyDocuments(record.documents?.length ?? 0);
    case "upload-too-big":
      return LIMIT_MESSAGES.uploadTooBig();
    default:
      return issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
  }
}

// Тело запроса: JSON по схеме. Ошибка — ответ 400 с понятным текстом.
// Content-Type обязан быть application/json: такой запрос с чужой страницы браузер не отправит
// без разрешения CORS — вторая защита на случай браузера без заголовка Sec-Fetch-Site (lib/guard.ts)
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number = BODY_LIMITS.default,
): Promise<{ data: T; error?: never } | { data?: never; error: Response }> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { error: Response.json({ error: "Тело запроса должно быть в формате application/json." }, { status: 415 }) };
  }
  const tooBig = {
    error: Response.json(
      { error: `Слишком большой запрос: больше ${Math.round(maxBytes / (1024 * 1024))} МБ. Загрузите данные в несколько приёмов.` },
      { status: 413 },
    ),
  };
  // Заголовок проверяется сразу, чтобы не читать заведомо большое тело; само тело — всё равно со счётчиком
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooBig;
  let body: unknown;
  try {
    const raw = await readBodyLimited(request, maxBytes);
    if (raw === null) return tooBig;
    body = JSON.parse(raw);
  } catch {
    return { error: badRequest("Тело запроса — не JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const problems = [...new Set(parsed.error.issues.map((i) => issueText(i, body)))];
    const text = problems.slice(0, 5).join("\n");
    return { error: badRequest(/[.!?]$/.test(text) ? text : `Неверные данные: ${text}.`) };
  }
  return { data: parsed.data };
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}
