// Общие классы оформления. Дизайн будет в версии 0.4, пока — простые и одинаковые элементы

export const SECTION =
  "flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";

export const STEP_TITLE = "text-lg font-semibold";

export const HINT = "text-sm text-zinc-600 dark:text-zinc-400";

export const ERROR = "text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap break-words";

export const BUTTON =
  "inline-flex items-center justify-center rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

export const BUTTON_SECONDARY =
  "inline-flex items-center justify-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";

// Кнопка выбора файла — подпись вокруг скрытого поля; рамка фокуса — для работы с клавиатуры
export const FILE_BUTTON = `${BUTTON} w-fit cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2`;

export const INPUT =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
