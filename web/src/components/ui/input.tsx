"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useSize, type SizeVariant } from "@/lib/size-context";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Size override for the input. Follows SizeProvider (default 36px, compact 28px). */
  size?: SizeVariant;
  /** Whether the field is in an error state. */
  error?: boolean | string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", size, error, ...props }, ref) => {
    const shape = useShape();
    const sizeClasses = useSize(size);

    return (
      <input
        type={type}
        ref={ref}
        aria-invalid={!!error || undefined}
        className={cn(
          // Base & layout
          "flex w-full items-center outline-none",
          sizeClasses.control,
          sizeClasses.text,
          sizeClasses.px,
          shape.input,
          // Surface, border & typography
          "border border-border bg-transparent text-foreground placeholder:text-muted-foreground",
          "hover:bg-hover/30 hover:border-border/80",
          // Focus ring hygiene: single-layer harmonious focus, zero border-ring desync
          "focus-visible:outline-none focus-visible:border-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          // Error state
          error &&
            "border-destructive/50 hover:border-destructive/50 focus-visible:border-destructive focus-visible:ring-destructive/50",
          // Disabled state
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-border",
          // Micro-interaction timing
          "transition-all duration-80",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
