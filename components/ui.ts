// Общие классы оформления. Курсоры кнопок — в app/globals.css: «рука», у неактивных — стрелка или знак вопроса.
// Цвета — переменные из app/globals.css (bg-card, text-muted, bg-brand…),
// поэтому в светлой и тёмной теме классы одни и те же.
// Переходы — только при наведении и коротко; при «уменьшить движение» отключены (motion-safe:)

// Шаг — карточка на сером фоне страницы
export const SECTION = "flex flex-col gap-3 rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5";

export const STEP_TITLE = "flex items-center gap-2.5 text-lg font-semibold";

// Номер шага в кружке фирменного цвета
export const STEP_NUMBER =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand";

export const HINT = "text-sm text-muted";

// Всплывающая подсказка (components/hint.tsx) у кнопок, неактивных на время обработки
export const BUSY_HINT = "Дождитесь конца обработки.";

export const ERROR = "text-sm text-danger whitespace-pre-wrap break-words";

// Значок слева от текста кнопки
export const ICON = { size: 16, "aria-hidden": true } as const;

// Неактивная главная кнопка выглядит так же, как неактивная второстепенная, — бледный контур без заливки:
// бледно-зелёная походила на ярлык «Уже есть», серая заливка — на ярлык «Вне разработки».
// Прозрачная рамка у активной — чтобы при смене состояния кнопка не меняла размер
export const BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent bg-brand px-3 py-1.5 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:border-line-strong disabled:bg-card disabled:text-foreground disabled:opacity-40 disabled:hover:bg-card motion-safe:transition-colors";

export const BUTTON_SECONDARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-line-strong bg-card px-3 py-1.5 text-sm font-medium hover:bg-subtle disabled:opacity-40 disabled:hover:bg-card motion-safe:transition-colors";

// Кнопка-ссылка: «Править», «Изменить вердикт», «Показать все»
export const LINK_BUTTON =
  "inline-flex items-center gap-1 text-sm text-link hover:underline disabled:opacity-40 disabled:no-underline";

// «Удалить», «Очистить список», «Удалить все документы»
export const DANGER_LINK =
  "inline-flex items-center gap-1 text-sm text-danger hover:underline disabled:opacity-40 disabled:no-underline";

// Кнопка выбора файла — подпись вокруг скрытого поля; рамка фокуса — для работы с клавиатуры
const FOCUS_WITHIN = "w-fit cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus";
export const FILE_BUTTON = `${BUTTON} ${FOCUS_WITHIN}`;
export const FILE_BUTTON_SECONDARY = `${BUTTON_SECONDARY} ${FOCUS_WITHIN}`;
// Кнопка выбора файла, пока идёт загрузка, — как неактивная кнопка: бледный контур, мышь не ловит
export const FILE_BUTTON_BUSY = `${BUTTON_SECONDARY} w-fit pointer-events-none opacity-40`;

export const INPUT =
  "w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm placeholder:text-muted disabled:opacity-60";

// Вложенная панель внутри шага: список заявок, карточка выбранной заявки
export const PANEL = "rounded-lg border border-line";
