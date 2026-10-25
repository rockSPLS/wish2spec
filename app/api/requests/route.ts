import { connection } from "next/server";
import { rejectForeignRequest } from "@/lib/guard";
import { addRequestsSchema, badRequest, LIMITS, parseBody } from "@/lib/input";
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
  const { data, error } = await parseBody(request, addRequestsSchema);
  if (error) return error;
  if ((await readRequests()).length + data.texts.length > LIMITS.requestsTotal) {
    return badRequest(`Заявок может быть не больше ${LIMITS.requestsTotal}.`);
  }
  return Response.json({ requests: await appendRequests(data.texts) });
}
