/**
 * Field — the canonical labelled text input for VS Research Labs forms.
 *
 * Cream-editorial register: uppercase wide-tracked label, soft cream input
 * surface (bg-base-700), hairline ink border that darkens on focus, and an
 * inline uppercase error line. Matches the input styling already used on the
 * Contact + Admin forms so every form on the site reads as one system.
 */

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  type?: string;
  /** Optional trailing adornment (e.g. a show/hide password toggle). */
  trailing?: React.ReactNode;
}

export function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  required,
  autoComplete,
  placeholder,
  type = 'text',
  trailing,
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] uppercase tracking-[0.22em] text-ink/55 mb-[var(--space-2)]"
      >
        {label}
        {required && <span className="text-ink/40 normal-case tracking-normal"> — required</span>}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={!!error || undefined}
          className={[
            'w-full px-[14px] py-[11px] bg-base-700 border rounded-[10px] text-[14px] text-ink placeholder-ink/30 shadow-[inset_0_1px_2px_rgba(26,23,20,0.035)] focus:outline-none transition-[border-color,box-shadow] duration-150',
            trailing ? 'pr-[var(--space-12)]' : '',
            error
              ? 'border-red-500/55 focus:border-red-500/80 focus:ring-2 focus:ring-red-500/15'
              : 'border-ink/12 hover:border-ink/20 focus:border-gold/70 focus:ring-2 focus:ring-gold/15',
          ].join(' ')}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-[var(--space-3)]">
            {trailing}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
