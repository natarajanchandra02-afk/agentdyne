import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:     "border-transparent bg-primary/10 text-primary",
        secondary:   "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        outline:     "border-border text-foreground bg-transparent",
        success:     "border-transparent bg-green-500/10 text-green-500",
        warning:     "border-transparent bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
        info:        "border-transparent bg-blue-500/10 text-blue-500",
        purple:      "border-transparent bg-purple-500/10 text-purple-500",
        glass:       "border-white/10 bg-white/5 text-foreground backdrop-blur-sm",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
