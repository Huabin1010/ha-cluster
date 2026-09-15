"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { fieldChromeClass } from "@/lib/field-chrome";
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
          fieldChromeClass,
          "text-foreground placeholder:text-muted-foreground",
          error &&
            "border-destructive/50 hover:border-destructive/50 focus-visible:border-destructive focus-visible:ring-destructive/50",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--input-fill) disabled:hover:border-(--input-border)",
          "transition-all duration-80",
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
