import { connection } from "next/server";
import { rejectForeignRequest } from "@/lib/guard";
import { addRequestsSchema, badRequest, BODY_LIMITS, parseBody } from "@/lib/input";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import { appendRequests, readRequests } from "@/lib/store";

// «Входящие заявки»: список заявок с результатами и добавление новых в конец списка.
// Текст разбивается на заявки на странице (lib/split-requests.ts) — сюда приходит готовый список

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
