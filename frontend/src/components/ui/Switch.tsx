export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className="grid min-h-11 min-w-11 shrink-0 place-items-center disabled:opacity-40">
      <span className={`flex h-6 w-10 items-center rounded-4 p-0.5 transition-colors duration-(--duration-fast) ${checked ? "bg-accent" : "bg-surface-2"}`}>
        <span className={`size-5 rounded-4 bg-ink transition-transform duration-(--duration-fast) ${checked ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}
