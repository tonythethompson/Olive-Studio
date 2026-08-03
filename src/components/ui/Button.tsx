import * as React from "react";
import { cn } from "@/lib/utils";

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "outline" | "ghost" | "success" | "danger";
  }
>(({ className, variant = "default", ...props }, ref) => {
  const variants = {
    default: "bg-electric-blue text-slate-950 hover:bg-electric-blue-dark shadow",
    outline: "border border-slate-700 bg-transparent hover:bg-slate-800 text-slate-300",
    ghost: "hover:bg-slate-800 hover:text-slate-50 text-slate-400",
    success: "bg-emerald-accent text-white hover:bg-emerald-dark shadow",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow",
  };
  return (
    <button ref={ref} type="button" className={cn(
      "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2",
      variants[variant], className,
    )} {...props} />
  );
});
Button.displayName = "Button";
