"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean | string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    const shape = useShape();

    return (
      <textarea
        ref={ref}
        aria-invalid={!!error || undefined}
        className={cn(
          "flex min-h-[80px] w-full px-3 py-2 text-[13px] leading-relaxed outline-none",
          shape.input,
          "border border-border bg-transparent text-foreground placeholder:text-muted-foreground",
          "hover:bg-hover/30 hover:border-border/80",
          "focus-visible:outline-none focus-visible:border-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          error &&
            "border-destructive/50 hover:border-destructive/50 focus-visible:border-destructive focus-visible:ring-destructive/50",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-border",
          "transition-all duration-80",
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
