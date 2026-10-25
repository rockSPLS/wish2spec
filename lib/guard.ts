import "server-only";

// Защита маршрутов, которые вызывают модель или читают и пишут данные в data/.
// Сервер слушает только 127.0.0.1, но браузер на этом же компьютере может отправить
// запрос на localhost:3003 со страницы любого сайта — и тратить ключ или читать документы.

type Messages = { host: string; crossSite: string };

const DEFAULT_MESSAGES: Messages = {
  host: "Wish2Spec работает только по адресу localhost или 127.0.0.1.",
  crossSite: "Запрос пришёл с другого сайта. Откройте Wish2Spec по адресу localhost.",
};

function forbidden(text: string): Response {
  return new Response(text, {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Возвращает ответ 403, если запрос пришёл не со своей страницы; иначе null
export function rejectForeignRequest(request: Request, messages: Messages = DEFAULT_MESSAGES): Response | null {
  // Только по адресу этого компьютера: чужой домен, который подменой DNS указывает
  // на 127.0.0.1 (DNS rebinding), браузер счёл бы «своим» сайтом. Порт любой.
  const hostname = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return forbidden(messages.host);
  }

  // Запросы с чужих сайтов (картинкой, формой или fetch с посторонней страницы) не выполняем.
  // Адрес, введённый вручную, браузер помечает Sec-Fetch-Site: none, запросы своей страницы —
  // same-origin; программы вне браузера (curl, скрипты Node) этот заголовок не отправляют и проходят.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "none" && site !== "same-origin") {
    return forbidden(messages.crossSite);
  }
  return null;
}
