"use client";

import { Moon, Sun } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { resolveTheme, THEME_KEY, type Theme } from "@/lib/theme";

// Переключатель светлой и тёмной темы в шапке. Тема — атрибут data-theme на <html>
// (до первой отрисовки его ставит скрипт в app/layout.tsx), выбор запоминается в localStorage

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// Тему переключили в другой вкладке — применяем её и здесь
function onStorage(event: StorageEvent) {
  if (event.key === THEME_KEY && (event.newValue === "dark" || event.newValue === "light")) {
    document.documentElement.dataset.theme = event.newValue;
  }
}

// Подписка на изменения атрибута: кнопка всегда показывает актуальную тему
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("storage", onStorage);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStorage);
  };
}

function toggleTheme() {
  const next: Theme = readTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // localStorage недоступен (например, приватный режим) — тема просто не запомнится
  }
}

export function ThemeToggle() {
  // На сервере темы не знаем — светлая, как в разметке <html>
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => "light");

  // В режиме разработки React (Strict Mode) при повторном монтировании сбрасывает атрибуты <html>
  // к разметке и стирает тему, которую поставил скрипт. Ставим её ещё раз до отрисовки;
  // в npm start это ничего не меняет
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolveTheme();
  }, []);

  // Подпись говорит, что сделает нажатие
  const label = theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-md p-2 text-muted hover:bg-card hover:text-foreground motion-safe:transition-colors"
    >
      {/* Значок — по атрибуту темы через CSS: он верный ещё до того, как React «оживит» кнопку */}
      <Moon size={20} aria-hidden="true" className="dark:hidden" />
      <Sun size={20} aria-hidden="true" className="hidden dark:block" />
    </button>
  );
}
