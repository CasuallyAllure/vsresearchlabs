/**
 * Field — the canonical labelled text input for VS Research Labs forms.
 *
 * Cream-editorial register: uppercase wide-tracked label, soft cream input
 * surface (bg-base-700), hairline ink border that darkens on focus, and an
 * inline uppercase error line. Matches the input styling already used on the
 * Contact + Admin forms so every form on the site reads as one system.
 */

/**
 * Canonical field surface classes (2026 register — see docs/DESIGN_2026_BLUEPRINT.md).
 * Exported so forms that can't use the <Field> component (selects, bespoke
 * composites, admin editors) still share the exact same input grammar.
 */
export const FIELD_SURFACE =
  'w-full px-[14px] py-[11px] bg-base-700 border rounded-field text-[14px] text-ink placeholder-ink/30 shadow-[inset_0_1px_2px_rgba(26,23,20,0.035)] focus:outline-none transition-[border-color,box-shadow] duration-150';
/** Thin variant — genuinely slim editorial input for dense forms (SignUpForm).
 *  Shorter (py-[5px] ≈ 30px tall), crisper 10px radius, lighter placeholder. */
export const FIELD_SURFACE_DENSE =
  'w-full px-[13px] py-[5px] bg-base-700 border rounded-[10px] text-[13.5px] text-ink placeholder-ink/30 placeholder:uppercase placeholder:text-[10.5px] placeholder:tracking-[0.14em] shadow-[inset_0_1px_2px_rgba(26,23,20,0.03)] focus:outline-none transition-[border-color,box-shadow] duration-150';
export const FIELD_DEFAULT =
  'border-ink/12 hover:border-ink/20 focus:border-gold/70 focus:ring-2 focus:ring-gold/15';
export const FIELD_ERROR =
  'border-[color:var(--color-status-error)] focus:border-[color:var(--color-status-error)] focus:ring-2 focus:ring-[color:var(--color-status-errorMuted)]';
export const FIELD_LABEL =
  'block text-[11px] uppercase tracking-[0.22em] text-ink/55 mb-[var(--space-2)]';
export const FIELD_LABEL_DENSE =
  'block text-[10px] uppercase tracking-[0.16em] text-ink/45 mb-[5px]';

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
  /** Compact variant — thinner padding/type for dense forms (e.g. SignUpForm). Default surface is unchanged. */
  dense?: boolean;
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
  dense,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className={dense ? FIELD_LABEL_DENSE : FIELD_LABEL}>
        {label}
        {required && !dense && <span className="text-ink/40 normal-case tracking-normal"> — required</span>}
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
            dense ? FIELD_SURFACE_DENSE : FIELD_SURFACE,
            trailing ? 'pr-[var(--space-12)]' : '',
            error ? FIELD_ERROR : FIELD_DEFAULT,
          ].join(' ')}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-[var(--space-3)]">
            {trailing}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-status-error)]">
          {error}
        </p>
      )}
    </div>
  );
}

interface TextAreaFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  required?: boolean;
  placeholder?: string;
  rows?: number;
}

/** Multiline sibling of Field — identical surface, label, and error grammar. */
export function TextAreaField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  required,
  placeholder,
  rows = 5,
}: TextAreaFieldProps) {
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <span className="text-ink/40 normal-case tracking-normal"> — required</span>}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        required={required}
        placeholder={placeholder}
        rows={rows}
        aria-invalid={!!error || undefined}
        className={[FIELD_SURFACE, 'resize-y', error ? FIELD_ERROR : FIELD_DEFAULT].join(' ')}
      />
      {error && (
        <p role="alert" className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-status-error)]">
          {error}
        </p>
      )}
    </div>
  );
}
