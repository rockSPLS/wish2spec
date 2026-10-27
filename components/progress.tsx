import { LoaderCircle } from "lucide-react";
import { ICON } from "./ui";

// Строка «идёт процесс» со значком загрузки: «Обрабатывается…», «Готовлю основу ТЗ…», «Индексирую документы…».
// Значок крутится, только если в системе не включено «уменьшить движение»

export function Spinner() {
  return <LoaderCircle {...ICON} className="shrink-0 motion-safe:animate-spin" />;
}

export function Progress({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted" role="status">
      <span className="mt-0.5">
        <Spinner />
      </span>
      <span>{children}</span>
    </p>
  );
}
