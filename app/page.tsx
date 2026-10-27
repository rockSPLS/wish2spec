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
      {/* Описание — справа от логотипа за тонкой чертой, в две строки на высоту логотипа (от ~1100 px);
          уже — сжимается до трёх строк (flex-1), а не переносится под логотип. На узком экране (до lg) —
          под логотипом во всю ширину (order-last). Переключатель темы — справа, по центру высоты логотипа:
          от lg всё в строке по центру — когда описание в три строки выше логотипа, логотип тоже по центру */}
      <header className="flex flex-wrap items-start gap-x-5 gap-y-3 lg:items-center">
        {/* SVG — только через <img>: у светлого и тёмного файлов одинаковые id градиентов.
            Оптимизация next/image для SVG не нужна. На узком экране картинка уменьшается по ширине (flex-1) */}
        <h1 className="min-w-0 flex-1 lg:flex-none">
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
        {/* Слоган нарисован в картинке; для экранного диктора — текстом */}
        <p className="sr-only">{SITE_SLOGAN}</p>
        <p className="order-last w-full text-sm text-muted lg:order-none lg:w-auto lg:min-w-0 lg:max-w-2xl lg:flex-1 lg:self-center lg:border-l lg:border-line-strong lg:py-1 lg:pl-5">
          {SITE_DESCRIPTION}
        </p>
        <div className="ml-auto shrink-0 self-center">
          <ThemeToggle />
        </div>
      </header>
      <Workspace />
    </main>
  );
}
