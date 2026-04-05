// AgentDyne Logo Component
// Matches the uploaded logo: double-D icon with pink→purple→blue gradient
// Use showText=true to show "AgentDyne" wordmark beside the icon

import { cn } from "@/lib/utils"

interface LogoProps {
  /** Width of the icon mark in px */
  size?: number
  /** Show the "AgentDyne" wordmark next to the icon */
  showText?: boolean
  /** Extra classes on the wrapper */
  className?: string
  /** Light variant — use on dark backgrounds (default). Dark variant for light bgs. */
  variant?: "default" | "white" | "dark"
}

export function AgentDyneLogo({
  size = 32,
  showText = false,
  className,
  variant = "default",
}: LogoProps) {
  const textColor =
    variant === "white" ? "#ffffff" :
    variant === "dark"  ? "#111111" :
    "url(#textGrad)"

  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {/* Icon mark — double-D with gradient */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="AgentDyne"
        role="img"
      >
        <defs>
          <linearGradient id="adGrad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#f472b6" />  {/* pink */}
            <stop offset="33%"  stopColor="#c084fc" />  {/* light purple */}
            <stop offset="66%"  stopColor="#818cf8" />  {/* indigo */}
            <stop offset="100%" stopColor="#38bdf8" />  {/* sky blue */}
          </linearGradient>
          <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="#818cf8" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>

        {/* Left D — outer arc */}
        <path
          d="M10 12 L10 68 L30 68
             C52 68 62 52 62 40
             C62 28 52 12 30 12 Z"
          fill="none"
          stroke="url(#adGrad)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Left D — inner cutout (create D shape) */}
        <path
          d="M22 24 L22 56 L30 56
             C44 56 50 48 50 40
             C50 32 44 24 30 24 Z"
          fill="none"
          stroke="url(#adGrad)"
          strokeWidth="0"
        />

        {/* ── Cleaner approach: two filled D-shapes ── */}
        {/* Reset and use filled paths */}
      </svg>

      {/* Cleaner SVG — replace above */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ marginLeft: `-${size}px` }} // hide the first svg
        className="hidden"
      />

      {/* Final clean SVG */}
      {showText && (
        <span
          style={{
            fontSize: size * 0.56,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            background: variant === "default"
              ? "linear-gradient(90deg, #818cf8, #a855f7)"
              : "none",
            color: variant === "default" ? "transparent" : textColor,
            WebkitBackgroundClip: variant === "default" ? "text" : "unset",
            backgroundClip: variant === "default" ? "text" : "unset",
            WebkitTextFillColor: variant === "default" ? "transparent" : textColor,
          }}
        >
          AgentDyne
        </span>
      )}
    </span>
  )
}

// ── Standalone Icon-only component ───────────────────────────────────────────
export function AgentDyneIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AgentDyne"
      role="img"
    >
      <defs>
        <linearGradient id="adIconGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#f472b6" />
          <stop offset="30%"  stopColor="#c084fc" />
          <stop offset="65%"  stopColor="#818cf8" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      {/* Left D shape */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 14 L10 86 L34 86
           C58 86 72 70 72 50
           C72 30 58 14 34 14 Z
           M22 26 L34 26
           C50 26 60 36 60 50
           C60 64 50 74 34 74
           L22 74 Z"
        fill="url(#adIconGrad)"
      />

      {/* Right D shape — mirrored, slightly offset */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M56 14 L56 86 L80 86
           C104 86 118 70 118 50
           C118 30 104 14 80 14 Z
           M68 26 L80 26
           C96 26 106 36 106 50
           C106 64 96 74 80 74
           L68 74 Z"
        fill="url(#adIconGrad)"
      />
    </svg>
  )
}
