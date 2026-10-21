import type { ButtonHTMLAttributes } from "react";

const VARIANT = {
  primary: "bg-accent text-accent-ink font-medium",
  secondary: "bg-surface-2 text-ink",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
  danger: "bg-danger text-ink font-medium",
} as const;
const SIZE = { md: "px-4 text-base", sm: "min-w-11 px-3 text-sm" } as const;

// Every size keeps a 44 px touch target; icon-only buttons pass aria-label.
export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }:
  { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`min-h-11 rounded-2 transition-colors duration-(--duration-fast) disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`} {...rest} />
  );
}
