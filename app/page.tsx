import { ThemeToggle } from "@/components/theme-toggle";
import { Workspace } from "@/components/workspace";
import { SITE_DESCRIPTION, SITE_NAME, SITE_SLOGAN } from "@/lib/site";

// Картинка шапки (public/header-*.svg): знак, название и слоган одним блоком. Размер — натуральный,
// на узком экране картинка уменьшается по ширине. Если файлы заменят, поменять размер — только здесь
const HEADER_LOGO = { width: 347, height: 61 };

// Единственная страница: шапка и три шага — документация, входящие заявки, результат обработки
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          {/* SVG — только через <img>: у светлого и тёмного файлов одинаковые id градиентов.
              Оптимизация next/image для SVG не нужна */}
          <h1 className="min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/header-light.svg"
              alt={SITE_NAME}
              {...HEADER_LOGO}
              className="block h-auto max-w-full dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/header-dark.svg"
              alt={SITE_NAME}
              {...HEADER_LOGO}
              className="hidden h-auto max-w-full dark:block"
            />
          </h1>
          <ThemeToggle />
        </div>
        {/* Слоган нарисован в картинке; для экранного диктора — текстом */}
        <p className="sr-only">{SITE_SLOGAN}</p>
        <p className="max-w-3xl text-sm text-muted">{SITE_DESCRIPTION}</p>
      </header>
      <Workspace />
    </main>
  );
}
