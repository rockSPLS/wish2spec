"use client";

import { useState } from "react";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import { VERDICTS, type Verdict } from "@/lib/types";
import { verdictLabel } from "@/lib/verdicts";
import { BUTTON, BUTTON_SECONDARY, ERROR, HINT, INPUT } from "./ui";

// Формы правки в карточке заявки: вердикт, основа ТЗ, текст заявки.
// Каждая сохраняет через onSave и показывает ошибку сервера у своих кнопок

type Save<T> = (value: T) => Promise<string | null>;

function Buttons({
  saveLabel,
  disabled,
  onSave,
  onCancel,
}: {
  saveLabel: string;
  disabled: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BUTTON} disabled={disabled} onClick={onSave}>
        {saveLabel}
      </button>
      <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

// «Изменить вердикт»: один из пяти; для «похоже на задачу» — номер задачи
export function VerdictEditor({
  verdict,
  taskNumber,
  disabled,
  onSave,
  onCancel,
}: {
  verdict: Verdict;
  taskNumber: number | null;
  disabled: boolean;
  onSave: Save<{ verdict: Verdict; taskNumber: number | null }>;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<Verdict>(verdict);
  const [number, setNumber] = useState(taskNumber === null ? "" : String(taskNumber));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = /^\d+$/.test(number.trim()) ? Number(number.trim()) : NaN;
  const numberOk = choice !== "similar" || (parsed >= 1 && parsed <= LIMITS.taskNumber);

  async function save() {
    setSaving(true);
    const problem = await onSave({ verdict: choice, taskNumber: choice === "similar" ? parsed : null });
    setSaving(false);
    if (problem) setError(problem);
    else onCancel();
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Вердикт</legend>
        {VERDICTS.map((v) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input type="radio" name="verdict" value={v} checked={choice === v} onChange={() => setChoice(v)} />
            {verdictLabel(v, null)}
          </label>
        ))}
      </fieldset>
      {choice === "similar" && (
        <label className="flex flex-col gap-1 text-sm">
          Номер задачи
          <input
            className={INPUT.replace("w-full", "w-40")}
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          {number.trim() !== "" && !numberOk && <span className={ERROR}>{LIMIT_MESSAGES.taskNumber()}</span>}
        </label>
      )}
      <Buttons saveLabel="Сохранить" disabled={disabled || saving || !numberOk} onSave={() => void save()} onCancel={onCancel} />
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// «Править» у основы ТЗ: текст в Markdown, как его потом скопируют
export function SpecEditor({
  text,
  disabled,
  onSave,
  onCancel,
}: {
  text: string;
  disabled: boolean;
  onSave: Save<string>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const problem =
    value.length > LIMITS.specChars ? LIMIT_MESSAGES.specTooLong() : !value.trim() ? LIMIT_MESSAGES.specEmpty() : null;

  async function save() {
    setSaving(true);
    const serverProblem = await onSave(value);
    setSaving(false);
    if (serverProblem) setError(serverProblem);
    else onCancel();
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className={`${INPUT} min-h-96 font-mono`}
        aria-label="Текст основы ТЗ в Markdown"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {problem && <p className={ERROR}>{problem}</p>}
      <Buttons saveLabel="Сохранить" disabled={disabled || saving || !!problem} onSave={() => void save()} onCancel={onCancel} />
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// «Править» у текста заявки: исправленный текст сразу уходит на обработку («Обработать заново»).
// Текст формы и ошибку хранит карточка: пока идёт отправка, карточка перестраивается, а если
// обработку не удалось начать, исправленный текст не должен пропасть
export function RequestTextEditor({
  value,
  onChange,
  error,
  hasResult,
  disabled,
  onProcess,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  hasResult: boolean;
  disabled: boolean;
  onProcess: () => void;
  onCancel: () => void;
}) {
  const problem =
    value.length > LIMITS.requestChars
      ? LIMIT_MESSAGES.requestTextTooLong()
      : !value.trim()
        ? LIMIT_MESSAGES.requestTextEmpty()
        : null;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className={`${INPUT} min-h-40`}
        aria-label="Текст заявки"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hasResult && (
        <p className={HINT}>Текущий результат вместе с правками сохранится как прежний вариант — его можно будет вернуть.</p>
      )}
      {problem && <p className={ERROR}>{problem}</p>}
      <Buttons saveLabel="Обработать заново" disabled={disabled || !!problem} onSave={onProcess} onCancel={onCancel} />
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
