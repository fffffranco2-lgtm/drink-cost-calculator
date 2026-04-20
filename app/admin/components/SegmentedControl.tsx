export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: string; // Material Symbols name
};

type Props<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: 10,
        border: "1px solid var(--line)",
        backgroundColor: "var(--background)",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
              fontFamily: "inherit",
              lineHeight: 1,
              transition: "background-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
              backgroundColor: active ? "var(--surface)" : "transparent",
              color: active ? "var(--accent-strong)" : "var(--muted)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              userSelect: "none",
            }}
          >
            {opt.icon && (
              <span
                className="material-symbols-rounded"
                style={{ fontSize: 15, fontVariationSettings: '"FILL" 0, "wght" 500, "GRAD" 0, "opsz" 20' }}
              >
                {opt.icon}
              </span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
