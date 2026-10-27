// Тема оформления: ключ в localStorage и скрипт, который ставит тему до первой отрисовки,
// чтобы страница не мигала светлой (руководство Next.js «Preventing flash before hydration»).
// Тема — сохранённый выбор, а если его нет (первый заход) — настройка системы

export type Theme = "light" | "dark";

export const THEME_KEY = "wish2spec:theme";

// Тот же порядок, что в themeScript; localStorage может быть недоступен (приватный режим) —
// тогда тема просто не запоминается
export function resolveTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // нет localStorage — по настройке системы
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const themeScript = `(function(){var t;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}if(t!=="dark"&&t!=="light")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)})()`;
