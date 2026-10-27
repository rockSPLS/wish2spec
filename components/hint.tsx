"use client";

import { cloneElement, useId } from "react";

// Всплывающая подсказка у неактивной кнопки: что сделать, чтобы кнопка заработала.
// Показывается при наведении на обёртку: у неактивной кнопки браузер не всегда передаёт события мыши,
// а наведение на обёртку CSS видит всегда. Стандартная подсказка title появляется с задержкой и не во всех
// браузерах у неактивных кнопок. Экранный диктор читает текст через aria-describedby.
// Обёртка есть всегда, даже без подсказки: иначе кнопка пересоздавалась бы, когда подсказка появляется.
// Курсор со знаком вопроса — в app/globals.css ([data-hint])

export function Hint({
  hint,
  align = "start",
  className = "",
  children,
}: {
  // Подсказка; не задана — кнопка активна или объяснять нечего
  hint?: string;
  // end — подсказка выровнена по правому краю кнопки: для кнопок у правого края блока
  align?: "start" | "end";
  className?: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  return (
    <span data-hint={hint ? "" : undefined} className={`group relative inline-flex ${className}`}>
      {hint ? cloneElement(children, { "aria-describedby": id }) : children}
      {hint && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute top-full z-20 mt-1.5 hidden w-max max-w-72 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-normal text-page shadow-md group-hover:block ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {hint}
        </span>
      )}
    </span>
  );
}
