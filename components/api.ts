// Запросы страницы к своему серверу. Ошибка — Error с текстом от сервера

// fetch не дошёл до сервера: сервер остановлен или перезапускается
const SERVER_DOWN = "Сервер Wish2Spec не отвечает. Проверьте, что он запущен, и попробуйте ещё раз.";
const SERVER_FAILED = "Сервер Wish2Spec ответил ошибкой. Текст ошибки — в терминале запуска.";

export async function callApi<T>(url: string, init?: { method: string; body: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init ? { "Content-Type": "application/json" } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error(SERVER_DOWN);
  }
  const type = response.headers.get("content-type") ?? "";
  const data: unknown = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    // Свои ошибки сервер отдаёт в JSON. Не-JSON с кодом 500 и выше — непойманная ошибка Next.js,
    // её текст аналитику ничего не скажет. Текстовые ответы 4xx (например, 403 защиты маршрутов) — как есть
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : response.status >= 500
          ? SERVER_FAILED
          : String(data) || `Ошибка сервера ${response.status}`;
    throw Object.assign(new Error(message), { data });
  }
  return data as T;
}

// Склонение: 1 фрагмент, 2 фрагмента, 5 фрагментов
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
