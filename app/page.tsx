import { Workspace } from "@/components/workspace";
import { SITE_DESCRIPTION, SITE_NAME, SITE_SLOGAN } from "@/lib/site";

// Единственная страница: шапка и три шага — документация, входящие заявки, результат обработки
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{SITE_NAME}</h1>
        <p className="text-lg text-zinc-700 dark:text-zinc-300">{SITE_SLOGAN}</p>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{SITE_DESCRIPTION}</p>
      </header>
      <Workspace />
    </main>
  );
}
