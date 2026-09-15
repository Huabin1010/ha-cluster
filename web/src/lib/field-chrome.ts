/**
 * Shared resting chrome for form fields.
 *
 * `--border` matches dialog / elevated surfaces in dark mode, so a 1px
 * `border-border` edge disappears until focus. These classes use the stronger
 * `--input-*` tokens (see styles.css) plus a light inset highlight so the
 * trough reads as a field even when idle.
 *
 * Class names are full literals so Tailwind's scanner emits the utilities.
 */
export const fieldChromeRestClass = [
  "border border-(--input-border)",
  "bg-(--input-fill)",
  "shadow-(--input-inset)",
  "hover:bg-hover/30 hover:border-(--input-border-hover)",
].join(" ");

/** Single-layer focus: border + 1px ring together; drop the inset so edges do not double. */
export const fieldChromeFocusClass = [
  "focus-visible:outline-none",
  "focus-visible:border-[color:var(--focus-ring,#6B97FF)]",
  "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
  "focus-visible:shadow-none",
].join(" ");

export const fieldChromeClass = `${fieldChromeRestClass} ${fieldChromeFocusClass}`;
