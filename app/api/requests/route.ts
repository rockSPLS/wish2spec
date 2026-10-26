import { connection } from "next/server";
import { REQUEST_BUSY } from "@/lib/errors";
import { rejectForeignRequest } from "@/lib/guard";
import { addRequestsSchema, badRequest, BODY_LIMITS, deleteRequestsSchema, editRequestSchema, parseBody } from "@/lib/input";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import { specMarkdown } from "@/lib/markdown";
import {
  appendRequests,
  changeRequest,
  deleteRequests,
  isProcessing,
  readRequests,
  swapWithPrevious,
} from "@/lib/store";
import type { AnalystEdits, IncomingRequest } from "@/lib/types";

// «Входящие заявки»: список заявок с результатами, добавление новых в конец списка,
// правки аналитика и удаление. Текст разбивается на заявки на странице (lib/split-requests.ts) —
// сюда приходит готовый список

// Заявку прочитали вне очереди записи: пока шла проверка, её могли изменить (например,
// «Вернуть прежний вариант» из другой вкладки) — тогда правка относилась бы к другому результату
// Заявку удалили между чтением и записью (например, из другой вкладки)
const notFound = () => Response.json({ error: "Заявка не найдена." }, { status: 404 });

const CHANGED = "Заявка изменилась, пока сохранялась правка. Обновите страницу и повторите правку.";
const sameVersion = (a: IncomingRequest, b: IncomingRequest) =>
  a.text === b.text && a.result?.processedAt === b.result?.processedAt;

export async function GET(request: Request) {
  // Без этого Next.js при сборке попробовал бы выполнить обработчик заранее
  await connection();
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  return Response.json({ requests: await readRequests() });
}

export async function POST(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, addRequestsSchema, BODY_LIMITS.requests);
  if (error) return error;
  const total = (await readRequests()).length + data.texts.length;
  if (total > LIMITS.requestsTotal) return badRequest(LIMIT_MESSAGES.requestsTotal(total));
  return Response.json({ requests: await appendRequests(data.texts) });
}

// Одна правка заменяется или снимается (value — undefined). Правок не осталось — поля нет вовсе:
// так у заявки без правок данные те же, что до версии 0.3
function withEdit<K extends keyof AnalystEdits>(
  edits: AnalystEdits | undefined,
  key: K,
  value: AnalystEdits[K],
): AnalystEdits | undefined {
  const next: AnalystEdits = { ...edits, [key]: value };
  if (value === undefined) delete next[key];
  return next.verdict || next.spec ? next : undefined;
}

// Правки аналитика. Совпала правка с ответом модели — правка снимается, пометки «изменено вручную» нет
export async function PATCH(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, editRequestSchema);
  if (error) return error;

  const incoming = (await readRequests()).find((r) => r.id === data.id);
  if (!incoming) return notFound();
  if (isProcessing(incoming.id)) return Response.json({ error: REQUEST_BUSY }, { status: 409 });

  if (data.action === "restore") {
    if (!incoming.previous) return badRequest("Прежнего варианта у заявки нет.");
    const swapped = await swapWithPrevious(incoming.id);
    return swapped ? Response.json({ request: swapped }) : notFound();
  }

  const result = incoming.result;
  if (!result) return badRequest("Заявка ещё не обработана.");
  const editedAt = new Date().toISOString();

  if (data.action === "verdict") {
    const sameAsModel = data.verdict === result.verdict && data.taskNumber === result.taskNumber;
    const edit = sameAsModel ? undefined : { verdict: data.verdict, taskNumber: data.taskNumber, editedAt };
    let stale = false;
    const updated = await changeRequest(incoming.id, (r) => {
      stale = !sameVersion(r, incoming);
      if (!stale) r.edits = withEdit(r.edits, "verdict", edit);
    });
    if (!updated) return notFound();
    if (stale) return Response.json({ error: CHANGED }, { status: 409 });
    return Response.json({ request: updated });
  }

  // Основа ТЗ: сравнивается с текстом, собранным из ответа модели
  const generated = result.spec ? specMarkdown(incoming.text, result.spec, result) : null;
  if (!generated && !incoming.edits?.spec) return badRequest("Основы ТЗ у заявки ещё нет.");
  const text = data.text.replace(/\r\n/g, "\n").trim();
  let stale = false;
  const updated = await changeRequest(incoming.id, (r) => {
    stale = !sameVersion(r, incoming);
    if (!stale) r.edits = withEdit(r.edits, "spec", text === generated ? undefined : { text, editedAt });
  });
  if (!updated) return notFound();
  if (stale) return Response.json({ error: CHANGED }, { status: 409 });
  return Response.json({ request: updated });
}

// «Удалить» у заявки и «Очистить список». Заявку в обработке не удаляем — 409
export async function DELETE(request: Request) {
  const rejected = rejectForeignRequest(request);
  if (rejected) return rejected;
  const { data, error } = await parseBody(request, deleteRequestsSchema);
  if (error) return error;

  const one = "id" in data;
  if (one && !(await readRequests()).some((r) => r.id === data.id)) {
    return Response.json({ error: "Заявка не найдена." }, { status: 404 });
  }
  const { requests, busy } = await deleteRequests(one ? [data.id] : null);
  if (busy) {
    const message = one ? REQUEST_BUSY : "Сейчас обрабатываются заявки. Очистите список, когда обработка закончится.";
    return Response.json({ error: message }, { status: 409 });
  }
  return Response.json({ requests });
}
