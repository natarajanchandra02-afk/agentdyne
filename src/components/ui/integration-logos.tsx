/**
 * Brand logos for MCP integrations — inline SVG, no external dependencies.
 * Each logo matches the real brand's official color palette.
 * Sized at 20×20 by default, scalable via className.
 */

import { cn } from "@/lib/utils"

type LogoProps = { className?: string; size?: number }

/* ─── Databases ──────────────────────────────────────────────────── */

export const SupabaseLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className} fill="none">
    <path d="M54 5L7 58h35v37l41-54H48L54 5z" fill="url(#supa-g)"/>
    <defs>
      <linearGradient id="supa-g" x1="55" y1="5" x2="35" y2="95" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3ECF8E"/>
        <stop offset="1" stopColor="#1E8A5E"/>
      </linearGradient>
    </defs>
  </svg>
)

export const PostgresLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <ellipse cx="50" cy="50" rx="42" ry="42" fill="#336791"/>
    <ellipse cx="50" cy="50" rx="32" ry="32" fill="#fff" fillOpacity=".9"/>
    <path d="M50 22c-5 0-9 2-12 5-3-1-7-1-10 1-3 2-5 5-5 9 0 2 1 4 2 6-2 2-3 5-3 8 0 7 6 13 13 13 2 0 4-1 6-2 2 3 6 5 9 5s7-2 9-5c2 1 4 2 6 2 7 0 13-6 13-13 0-3-1-6-3-8 1-2 2-4 2-6 0-4-2-7-5-9-3-2-7-2-10-1-3-3-7-5-12-5z" fill="#336791"/>
    <path d="M44 46c0-4 3-7 6-7s6 3 6 7-3 8-6 8-6-4-6-8zm-3 0c0 5 4 10 9 10 5 0 9-5 9-10 0-6-4-10-9-10-5 0-9 4-9 10z" fill="#fff"/>
    <circle cx="47" cy="43" r="2" fill="#336791"/>
    <circle cx="55" cy="43" r="2" fill="#336791"/>
  </svg>
)

export const MySQLLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <path d="M10 65c0-20 10-40 25-52 5-4 11-7 17-8 8-1 14 2 18 8l4 6c3 4 6 6 10 5 3-1 5-4 6-8l2-10 8 5c-1 10-5 18-12 22-7 4-14 2-20-5l-4-6c-2-3-4-4-7-3-4 1-7 5-9 10-5 12-5 28 0 40l-2 1C18 86 10 77 10 65z" fill="#4479A1"/>
    <path d="M60 20c4 0 8 1 11 4l5-8c-5-3-10-5-16-5-9 0-17 4-22 11l6 7c3-5 9-9 16-9z" fill="#F29111"/>
    <path d="M72 28c5 7 8 16 8 27 0 22-12 38-28 38-7 0-13-3-17-8l-5 8c5 5 12 8 20 8 20 0 36-18 36-42 0-13-4-24-12-32l-2 1z" fill="#4479A1"/>
  </svg>
)

export const MongoDBLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <path d="M50 8C31 8 16 23 16 42c0 22 28 45 32 48l2 2 2-2c4-3 32-26 32-48C84 23 69 8 50 8z" fill="#4FAA41"/>
    <path d="M50 8v82l2-2c4-3 32-26 32-48C84 23 69 8 50 8z" fill="#3D7E36"/>
    <rect x="47" y="55" width="6" height="30" rx="3" fill="#fff"/>
    <ellipse cx="50" cy="48" rx="8" ry="10" fill="#fff"/>
  </svg>
)

export const RedisLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="16" fill="#DC382D"/>
    <path d="M50 18l8 17h18L62 46l6 19-18-11-18 11 6-19-14-11h18L50 18z" fill="#fff" fillOpacity=".9"/>
    <ellipse cx="50" cy="78" rx="28" ry="8" fill="#fff" fillOpacity=".25"/>
  </svg>
)

export const SQLiteLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="16" fill="#003B57"/>
    <path d="M68 22c-8-6-20-6-28 2-6 6-8 16-5 24 3 9 12 15 22 15 4 0 8-1 11-3v14H30V72h38V58c0-6-2-11-6-14-3-3-7-5-12-5-9 0-16 7-16 16h10c0-3 2-6 6-6s6 3 6 6v20H25V35h13v-5H20v45h60V22h-12z" fill="#62B0CB"/>
  </svg>
)

/* ─── Communication ──────────────────────────────────────────────── */

export const GmailLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="12" fill="#fff"/>
    <path d="M12 28h76v44H12z" fill="#fff" stroke="#e5e7eb" strokeWidth="2"/>
    <path d="M12 28l38 30 38-30" stroke="#EA4335" strokeWidth="5" fill="none" strokeLinecap="round"/>
    <path d="M12 28v44l26-22M88 28v44L62 50" stroke="#34A853" strokeWidth="4" fill="none"/>
    <path d="M12 72l26-22 12 9 12-9 26 22" fill="#4285F4"/>
    <path d="M12 28l38 30 38-30" fill="#EA4335" fillOpacity=".15"/>
  </svg>
)

export const SlackLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <circle cx="33" cy="33" r="12" fill="#E01E5A"/>
    <circle cx="33" cy="33" r="7" fill="#E01E5A"/>
    <rect x="26" y="21" width="14" height="24" rx="7" fill="#E01E5A"/>
    <rect x="21" y="26" width="24" height="14" rx="7" fill="#E01E5A"/>
    <circle cx="67" cy="33" r="12" fill="#36C5F0"/>
    <rect x="60" y="21" width="14" height="24" rx="7" fill="#36C5F0"/>
    <rect x="55" y="26" width="24" height="14" rx="7" fill="#36C5F0"/>
    <circle cx="33" cy="67" r="12" fill="#2EB67D"/>
    <rect x="26" y="55" width="14" height="24" rx="7" fill="#2EB67D"/>
    <rect x="21" y="60" width="24" height="14" rx="7" fill="#2EB67D"/>
    <circle cx="67" cy="67" r="12" fill="#ECB22E"/>
    <rect x="60" y="55" width="14" height="24" rx="7" fill="#ECB22E"/>
    <rect x="55" y="60" width="24" height="14" rx="7" fill="#ECB22E"/>
  </svg>
)

export const TwilioLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <circle cx="50" cy="50" r="45" fill="#F22F46"/>
    <circle cx="36" cy="36" r="9" fill="#fff"/>
    <circle cx="64" cy="36" r="9" fill="#fff"/>
    <circle cx="36" cy="64" r="9" fill="#fff"/>
    <circle cx="64" cy="64" r="9" fill="#fff"/>
  </svg>
)

export const DiscordLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="22" fill="#5865F2"/>
    <path d="M68 28c-5-2-10-4-16-4l-1 2c6 2 11 4 15 7-7-3-14-5-22-5s-15 2-22 5c4-3 10-5 15-7l-1-2c-6 0-11 2-16 4-8 15-11 29-10 43 7 5 14 7 20 8l3-4c-3-1-6-3-9-5 4 3 9 5 16 7 7-2 12-4 16-7-3 2-6 4-9 5l3 4c6-1 13-3 20-8 1-14-2-28-10-43zM38 60c-4 0-7-3-7-8s3-8 7-8 7 3 7 8-3 8-7 8zm24 0c-4 0-7-3-7-8s3-8 7-8 7 3 7 8-3 8-7 8z" fill="#fff"/>
  </svg>
)

export const SendgridLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="12" fill="#1A82E2"/>
    <rect x="18" y="18" width="28" height="28" rx="4" fill="#fff" fillOpacity=".9"/>
    <rect x="54" y="18" width="28" height="28" rx="4" fill="#fff" fillOpacity=".5"/>
    <rect x="18" y="54" width="28" height="28" rx="4" fill="#fff" fillOpacity=".5"/>
    <rect x="54" y="54" width="28" height="28" rx="4" fill="#fff" fillOpacity=".9"/>
  </svg>
)

/* ─── Productivity ───────────────────────────────────────────────── */

export const GoogleCalendarLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect x="8" y="14" width="84" height="78" rx="8" fill="#fff" stroke="#e5e7eb" strokeWidth="2"/>
    <rect x="8" y="14" width="84" height="24" rx="8" fill="#4285F4"/>
    <rect x="8" y="30" width="84" height="8" fill="#4285F4"/>
    <circle cx="30" cy="14" r="6" fill="#EA4335"/>
    <circle cx="70" cy="14" r="6" fill="#EA4335"/>
    <rect x="28" y="24" width="4" height="8" rx="2" fill="#fff"/>
    <rect x="68" y="24" width="4" height="8" rx="2" fill="#fff"/>
    <text x="50" y="75" textAnchor="middle" fontSize="36" fontWeight="700" fill="#1A73E8" fontFamily="sans-serif">31</text>
  </svg>
)

export const NotionLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#fff"/>
    <path d="M24 20h52c4 0 7 3 7 7v46c0 4-3 7-7 7H24c-4 0-7-3-7-7V27c0-4 3-7 7-7z" fill="#fff" stroke="#e5e7eb" strokeWidth="2"/>
    <path d="M32 35h36M32 50h28M32 65h20" stroke="#18181b" strokeWidth="5" strokeLinecap="round"/>
    <path d="M23 20l8 10V18l-8 2z" fill="#18181b"/>
  </svg>
)

export const GoogleDriveLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <path d="M37 16L8 66h28l29-50z" fill="#4285F4"/>
    <path d="M64 16H36L8 66l14 18 42-68z" fill="#4285F4"/>
    <path d="M64 16l28 50H64L36 16z" fill="#FBBC04"/>
    <path d="M8 66l14 18h56l14-18H8z" fill="#34A853"/>
    <path d="M22 84l14-18H64l14 18H22z" fill="#34A853" fillOpacity=".8"/>
  </svg>
)

export const LinearLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="20" fill="#5E6AD2"/>
    <path d="M20 70L60 20M25 82L78 25M38 88L86 38M55 90L90 55" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeOpacity=".7"/>
    <circle cx="25" cy="25" r="12" fill="#fff"/>
    <path d="M20 25h10M25 20v10" stroke="#5E6AD2" strokeWidth="3" strokeLinecap="round"/>
  </svg>
)

export const AsanaLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="20" fill="#F06A6A"/>
    <circle cx="50" cy="38" r="14" fill="#fff"/>
    <circle cx="27" cy="62" r="14" fill="#fff"/>
    <circle cx="73" cy="62" r="14" fill="#fff"/>
  </svg>
)

export const JiraLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#0052CC"/>
    <path d="M50 18L18 50l14 14 18-18 18 18 14-14L50 18z" fill="url(#jira-g)"/>
    <path d="M50 82L82 50 68 36 50 54 32 36 18 50 50 82z" fill="url(#jira-g2)"/>
    <defs>
      <linearGradient id="jira-g" x1="50" y1="18" x2="50" y2="64" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0065FF"/>
        <stop offset="1" stopColor="#0052CC"/>
      </linearGradient>
      <linearGradient id="jira-g2" x1="50" y1="82" x2="50" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="#2684FF"/>
        <stop offset="1" stopColor="#0052CC"/>
      </linearGradient>
    </defs>
  </svg>
)

export const AirtableLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#FCB400"/>
    <rect x="18" y="20" width="64" height="20" rx="6" fill="#fff"/>
    <rect x="18" y="48" width="28" height="32" rx="6" fill="#fff"/>
    <rect x="54" y="48" width="28" height="20" rx="6" fill="#fff" fillOpacity=".6"/>
  </svg>
)

/* ─── Development ────────────────────────────────────────────────── */

export const GitHubLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="20" fill="#24292E"/>
    <path d="M50 15C31 15 15 31 15 50c0 15 10 28 24 33 2 0 3-1 3-2v-7c-10 2-12-5-12-5-2-4-4-5-4-5-3-2 0-2 0-2 4 0 6 4 6 4 3 5 8 4 10 3 0-2 1-4 3-5-8-1-16-4-16-17 0-4 1-7 4-9-1-2-2-6 0-10 0 0 3-1 10 4 3-1 6-1 9-1s6 0 9 1c7-5 10-4 10-4 2 4 1 8 0 10 3 2 4 5 4 9 0 13-8 16-16 17 2 1 3 4 3 7v11c0 1 1 2 3 2C75 78 85 65 85 50c0-19-16-35-35-35z" fill="#fff"/>
  </svg>
)

export const GitLabLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#FC6D26"/>
    <path d="M50 82L20 38l10-25 10 25h20l10-25 10 25L50 82z" fill="#FCA326"/>
    <path d="M50 82L40 38h20L50 82z" fill="#E24329"/>
    <path d="M30 38L20 38l10-25 10 25H30z" fill="#FC6D26" fillOpacity=".7"/>
    <path d="M70 38L80 38l-10-25-10 25H70z" fill="#FC6D26" fillOpacity=".7"/>
  </svg>
)

export const FilesystemLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#6366F1"/>
    <path d="M20 35h25l8 10h27v35H20z" fill="#fff" fillOpacity=".9"/>
    <path d="M20 25h20l5 10H20z" fill="#fff"/>
    <path d="M32 58h36M32 68h24" stroke="#6366F1" strokeWidth="4" strokeLinecap="round"/>
  </svg>
)

export const BrowserbaseLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#1A1A2E"/>
    <circle cx="50" cy="50" r="32" fill="none" stroke="#6366F1" strokeWidth="4"/>
    <ellipse cx="50" cy="50" rx="14" ry="32" fill="none" stroke="#6366F1" strokeWidth="3"/>
    <line x1="18" y1="50" x2="82" y2="50" stroke="#6366F1" strokeWidth="3"/>
    <line x1="50" y1="18" x2="50" y2="82" stroke="#6366F1" strokeWidth="3"/>
    <circle cx="50" cy="50" r="6" fill="#6366F1"/>
  </svg>
)

export const PuppeteerLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#40B5A4"/>
    <circle cx="50" cy="45" r="22" fill="#fff"/>
    <circle cx="42" cy="40" r="5" fill="#40B5A4"/>
    <circle cx="58" cy="40" r="5" fill="#40B5A4"/>
    <path d="M40 55c3 5 8 8 10 8s7-3 10-8" stroke="#40B5A4" strokeWidth="3" fill="none" strokeLinecap="round"/>
    <rect x="32" y="68" width="36" height="8" rx="4" fill="#fff" fillOpacity=".7"/>
  </svg>
)

/* ─── Cloud ──────────────────────────────────────────────────────── */

export const AWSLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#232F3E"/>
    <path d="M25 58c8 5 18 8 25 8 7 0 17-3 25-8" stroke="#FF9900" strokeWidth="5" fill="none" strokeLinecap="round"/>
    <path d="M45 66l-5 8 5 4M55 66l5 8-5 4" stroke="#FF9900" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 48c0-11 9-20 20-20s20 9 20 20" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round"/>
    <path d="M26 48h8M66 48h8" stroke="#fff" strokeWidth="4" strokeLinecap="round"/>
  </svg>
)

export const GCPLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#fff"/>
    <path d="M64 34H36l-14 24 14 24h28l14-24z" fill="#4285F4"/>
    <path d="M50 26c-13 0-24 11-24 24 0 6 2 11 6 16l6-6c-2-3-4-6-4-10 0-9 7-16 16-16V26z" fill="#EA4335"/>
    <path d="M50 74c13 0 24-11 24-24 0-6-2-11-6-16l-6 6c2 3 4 6 4 10 0 9-7 16-16 16v8z" fill="#34A853"/>
    <path d="M50 50m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0" fill="#fff"/>
  </svg>
)

export const CloudflareLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#F38020"/>
    <path d="M68 44c0-1 0-1 0-2C68 33 60 26 50 26c-8 0-14 5-17 12-1 0-2-0-3-0-7 0-12 5-12 12s5 12 12 12h38c5 0 9-4 9-9S73 44 68 44z" fill="#fff"/>
    <path d="M68 44c0-1 0-1 0-2C68 33 60 26 50 26c-8 0-14 5-17 12" stroke="#F38020" strokeWidth="1" fill="none"/>
  </svg>
)

export const VercelLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#000"/>
    <path d="M50 22L82 78H18L50 22z" fill="#fff"/>
  </svg>
)

/* ─── AI ─────────────────────────────────────────────────────────── */

export const AnthropicLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#D4A27F"/>
    <path d="M50 20L72 75H58L54 63H46L42 75H28L50 20z" fill="#1A1A1A"/>
    <path d="M48 52h4l-2-12z" fill="#D4A27F"/>
  </svg>
)

export const OpenAILogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#10A37F"/>
    <path d="M50 22c-4 0-8 1-11 4C34 19 27 18 22 22c-5 4-7 11-5 18-6 3-10 9-10 16s4 13 10 16c-2 7 0 14 5 18 5 4 12 5 18 2 3 3 7 4 10 4 4 0 8-1 10-4 6 3 13 2 18-2 5-4 7-11 5-18 6-3 10-9 10-16s-4-13-10-16c2-7 0-14-5-18-5-4-12-5-18-2-2-3-6-4-10-4z" fill="#fff"/>
    <path d="M50 22c-4 0-8 1-11 4C34 19 27 18 22 22c-5 4-7 11-5 18-6 3-10 9-10 16s4 13 10 16c-2 7 0 14 5 18 5 4 12 5 18 2 3 3 7 4 10 4 4 0 8-1 10-4 6 3 13 2 18-2 5-4 7-11 5-18 6-3 10-9 10-16s-4-13-10-16c2-7 0-14-5-18-5-4-12-5-18-2-2-3-6-4-10-4z" fill="#10A37F" fillOpacity=".2"/>
    <circle cx="50" cy="50" r="16" fill="#10A37F"/>
    <circle cx="50" cy="50" r="8" fill="#fff"/>
  </svg>
)

export const PineconeLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#000"/>
    <path d="M50 15L65 50H50L65 75H35L50 50H35L50 15z" fill="#03D4A0"/>
    <circle cx="50" cy="85" r="6" fill="#03D4A0"/>
  </svg>
)

export const QdrantLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#DC244C"/>
    <path d="M50 18L80 35v30L50 82 20 65V35L50 18z" fill="none" stroke="#fff" strokeWidth="5"/>
    <path d="M50 18L50 82M20 35l30 17 30-17M20 65l30-17 30 17" stroke="#fff" strokeWidth="3" strokeOpacity=".5"/>
    <circle cx="50" cy="50" r="8" fill="#fff"/>
  </svg>
)

/* ─── Finance ────────────────────────────────────────────────────── */

export const StripeLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#635BFF"/>
    <path d="M44 42c0-4 3-6 8-6 6 0 12 2 18 5V24c-6-2-12-3-18-3-14 0-24 7-24 20 0 19 27 16 27 25 0 4-4 6-9 6-7 0-14-3-20-7v18c6 3 13 4 20 4 15 0 25-7 25-21C71 47 44 51 44 42z" fill="#fff"/>
  </svg>
)

export const PlaidLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#000"/>
    <rect x="18" y="18" width="15" height="64" rx="3" fill="#fff"/>
    <rect x="42" y="28" width="15" height="54" rx="3" fill="#34B378"/>
    <rect x="66" y="18" width="15" height="64" rx="3" fill="#fff"/>
  </svg>
)

export const QuickbooksLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#2CA01C"/>
    <circle cx="50" cy="50" r="28" fill="#fff"/>
    <path d="M34 50a16 16 0 1 0 32 0 16 16 0 0 0-32 0z" fill="#2CA01C"/>
    <path d="M42 42h6v26h-6z" fill="#fff"/>
    <path d="M32 34h6v42h-6z" fill="#fff"/>
  </svg>
)

/* ─── Marketing / CRM ────────────────────────────────────────────── */

export const HubspotLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#FF7A59"/>
    <circle cx="62" cy="38" r="12" fill="#fff"/>
    <circle cx="62" cy="38" r="7" fill="#FF7A59"/>
    <rect x="42" y="32" width="14" height="6" rx="3" fill="#fff"/>
    <circle cx="38" cy="62" r="16" fill="#fff"/>
    <circle cx="38" cy="62" r="10" fill="#FF7A59"/>
    <path d="M62 50v12" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
  </svg>
)

export const SalesforceLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#00A1E0"/>
    <path d="M42 30c3-5 8-8 14-8 8 0 15 5 18 13 2-1 5-2 7-2 8 0 14 6 14 14s-6 14-14 14H28c-7 0-12-5-12-12s5-12 12-12c1 0 3 0 4 1C33 33 37 30 42 30z" fill="#fff"/>
  </svg>
)

export const MailchimpLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#FFE01B"/>
    <ellipse cx="50" cy="45" rx="22" ry="26" fill="#241C15"/>
    <ellipse cx="50" cy="42" rx="16" ry="18" fill="#FFE01B"/>
    <circle cx="43" cy="38" r="3" fill="#241C15"/>
    <circle cx="57" cy="38" r="3" fill="#241C15"/>
    <path d="M44 50c2 3 6 4 6 4s4-1 6-4" stroke="#241C15" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <ellipse cx="68" cy="52" rx="6" ry="9" fill="#241C15"/>
    <ellipse cx="67" cy="51" rx="4" ry="7" fill="#FFE01B"/>
  </svg>
)

/* ─── Security ───────────────────────────────────────────────────── */

export const OnePasswordLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="20" fill="#0C7EE8"/>
    <circle cx="50" cy="45" r="18" fill="#fff"/>
    <circle cx="50" cy="45" r="12" fill="#0C7EE8"/>
    <rect x="44" y="58" width="12" height="22" rx="4" fill="#fff"/>
    <path d="M47 45l3-8 3 8-3 3z" fill="#fff"/>
  </svg>
)

export const VaultLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#1D2433"/>
    <path d="M50 15L80 32v36L50 85 20 68V32L50 15z" fill="none" stroke="#FFCD00" strokeWidth="4"/>
    <path d="M50 32l20 11v22L50 76 30 65V43L50 32z" fill="#FFCD00" fillOpacity=".15" stroke="#FFCD00" strokeWidth="3"/>
    <circle cx="50" cy="54" r="8" fill="#FFCD00"/>
    <path d="M50 38v8M38 46l7 6M62 46l-7 6" stroke="#FFCD00" strokeWidth="3" strokeLinecap="round"/>
  </svg>
)

/* ─── Analytics ──────────────────────────────────────────────────── */

export const PosthogLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#1D4AFF"/>
    <path d="M20 65V40l15-15h30l15 15v12l-15 15H35L20 65z" fill="#fff"/>
    <path d="M20 65V40l15-15" stroke="#1D4AFF" strokeWidth="3" fill="none"/>
    <circle cx="50" cy="50" r="10" fill="#F54E00"/>
    <path d="M64 52l16 16M50 62v16M36 52l-16 16" stroke="#fff" strokeWidth="4" strokeLinecap="round"/>
  </svg>
)

export const GoogleAnalyticsLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#fff"/>
    <rect x="18" y="50" width="18" height="32" rx="6" fill="#F9AB00"/>
    <rect x="42" y="30" width="18" height="52" rx="6" fill="#E37400"/>
    <rect x="66" y="18" width="18" height="64" rx="6" fill="#E37400"/>
  </svg>
)

export const MixpanelLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#7856FF"/>
    <path d="M22 72V38l14-14h28l14 14v34L64 86H36L22 72z" fill="#fff" fillOpacity=".9"/>
    <path d="M36 55l10-10 8 8 14-18" stroke="#7856FF" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/* ─── E-Commerce ─────────────────────────────────────────────────── */

export const ShopifyLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#96BF48"/>
    <path d="M65 26c-1 0-2 1-2 2-3 1-5 4-7 8H44l-8 44h42L65 26z" fill="#5E8E3E"/>
    <path d="M56 36l-7 44M69 36l-7 44" stroke="#fff" strokeWidth="3" strokeOpacity=".4"/>
    <path d="M56 36c0-6-4-10-9-10-5 0-9 4-9 10" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"/>
    <circle cx="65" cy="26" r="4" fill="#fff"/>
  </svg>
)

export const WoocommerceLogo = ({ className, size = 20 }: LogoProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
    <rect width="100" height="100" rx="14" fill="#7F54B3"/>
    <path d="M14 28h72c4 0 7 3 7 7v24c0 4-3 7-7 7H62l-10 14-10-14H14c-4 0-7-3-7-7V35c0-4 3-7 7-7z" fill="#fff"/>
    <path d="M22 55l7-20 7 12 7-12 7 20" stroke="#7F54B3" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="70" cy="50" r="7" fill="#7F54B3"/>
    <circle cx="70" cy="50" r="4" fill="#fff"/>
  </svg>
)

/* ─── Master map — keyed by MCP server id ────────────────────────── */

export const BRAND_LOGOS: Record<string, React.FC<LogoProps>> = {
  // Databases
  supabase:         SupabaseLogo,
  postgres:         PostgresLogo,
  mysql:            MySQLLogo,
  mongodb:          MongoDBLogo,
  redis:            RedisLogo,
  sqlite:           SQLiteLogo,
  // Communication
  gmail:            GmailLogo,
  slack:            SlackLogo,
  twilio:           TwilioLogo,
  discord:          DiscordLogo,
  sendgrid:         SendgridLogo,
  // Productivity
  "google-calendar":GoogleCalendarLogo,
  notion:           NotionLogo,
  "google-drive":   GoogleDriveLogo,
  linear:           LinearLogo,
  asana:            AsanaLogo,
  jira:             JiraLogo,
  airtable:         AirtableLogo,
  // Development
  github:           GitHubLogo,
  gitlab:           GitLabLogo,
  filesystem:       FilesystemLogo,
  browserbase:      BrowserbaseLogo,
  puppeteer:        PuppeteerLogo,
  // Cloud
  aws:              AWSLogo,
  gcp:              GCPLogo,
  cloudflare:       CloudflareLogo,
  vercel:           VercelLogo,
  // AI
  anthropic:        AnthropicLogo,
  openai:           OpenAILogo,
  pinecone:         PineconeLogo,
  qdrant:           QdrantLogo,
  // Finance
  stripe:           StripeLogo,
  plaid:            PlaidLogo,
  quickbooks:       QuickbooksLogo,
  // Marketing
  hubspot:          HubspotLogo,
  salesforce:       SalesforceLogo,
  mailchimp:        MailchimpLogo,
  // Security
  "1password":      OnePasswordLogo,
  "hashicorp-vault":VaultLogo,
  // Analytics
  posthog:          PosthogLogo,
  "google-analytics":GoogleAnalyticsLogo,
  mixpanel:         MixpanelLogo,
  // E-commerce
  shopify:          ShopifyLogo,
  woocommerce:      WoocommerceLogo,
}

/**
 * IntegrationLogo — renders the real brand logo for a given MCP server id.
 * Falls back to a coloured category icon if no brand logo exists.
 */
export function IntegrationLogo({
  id,
  size = 20,
  className,
}: {
  id: string
  size?: number
  className?: string
}) {
  const Logo = BRAND_LOGOS[id]
  if (!Logo) return null
  return <Logo size={size} className={className} />
}
