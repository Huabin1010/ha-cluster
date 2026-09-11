import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
