// Текст ошибки для ответа сервера и строки заявки. Ошибка сервиса показывается как есть;
// понятный текст вместо неё — в версии 0.3
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
