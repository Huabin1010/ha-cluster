import { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({ variant = "primary", className = "", type = "button", ...rest }: Props) {
  const variantClass = variant === "ghost" ? "ghost" : "";
  return <button type={type} className={`${variantClass} ${className}`.trim()} {...rest} />;
}
