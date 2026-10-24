// Временная страница каркаса: настоящий интерфейс появится в версии 0.1
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Wish2Spec</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        От пожелания — к требованиям
      </p>
    </main>
  );
}
