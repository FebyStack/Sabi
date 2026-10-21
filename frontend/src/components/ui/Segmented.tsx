export function Segmented<T extends string>({ label, value, options, onChange, disabled }:
  { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-2 bg-surface-1 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} onClick={() => o.value !== value && onChange(o.value)}
          className={`min-h-11 flex-1 rounded-1 px-3 text-sm transition-colors duration-(--duration-fast) disabled:opacity-40 ${o.value === value ? "bg-accent text-accent-ink" : "text-ink-muted"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
