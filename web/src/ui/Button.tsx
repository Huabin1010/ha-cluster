import { ButtonHTMLAttributes } from "react";
import { Button as ShadcnButton, type ButtonProps as ShadcnButtonProps } from "../components/ui/button";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | ShadcnButtonProps["variant"];
  size?: ShadcnButtonProps["size"];
};

export function Button({ variant = "primary", className = "", type = "button", ...rest }: Props) {
  const mapped = variant === "primary" ? "default" : variant;
  return <ShadcnButton type={type} variant={mapped} className={className} {...rest} />;
}
