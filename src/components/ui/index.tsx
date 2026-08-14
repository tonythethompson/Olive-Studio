import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

// Radix Tabs
export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-slate-900 p-1 text-slate-400",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    value={value}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-slate-950 transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-slate-800 data-[state=active]:text-slate-50 data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, value, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    value={value}
    className={cn(
      "mt-4 ring-offset-slate-950 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

// Radix Slider
export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-slate-800">
      <SliderPrimitive.Range className="absolute h-full bg-electric-blue" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-electric-blue bg-slate-950 ring-offset-slate-950 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

// Generic Card
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded border border-slate-800 bg-slate-900/40 text-slate-100", className)}>
      {children}
    </div>
  );
}
/**
 * Renders a card header with a title, optional description, badge, and tooltip.
 *
 * @param title - The card title
 * @param description - Supporting text displayed below the title
 * @param badge - Optional content displayed beside the title and description
 * @param tooltip - Optional explanatory text shown when hovering over the info icon
 */
export function CardHeader({
  title,
  description,
  badge,
  tooltip,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-5 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-slate-100 flex items-center gap-2">
            {title}
            {tooltip && (
              <span title={tooltip} className="cursor-help">
                <Info className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              </span>
            )}
          </div>
          {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
        </div>
        {badge}
      </div>
    </div>
  );
}
export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("p-5 pt-0", className)}>{children}</div>;
}

// Input Forms
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm ring-offset-slate-950 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => {
    return (
      <select
        className={cn(
          "flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm ring-offset-slate-950 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 appearance-none",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Select.displayName = "Select";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-slate-200",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";

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
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";
