import Link from "next/link"
import Image from "next/image"
import { Twitter, Github, Linkedin, Globe } from "lucide-react"

const LINKS = {
  Product: [
    { label: "Marketplace",    href: "/marketplace" },
    { label: "Integrations",   href: "/integrations" },
    { label: "Builder Studio", href: "/builder" },
    { label: "Pricing",        href: "/pricing" },
    { label: "Changelog",      href: "/changelog" },
  ],
  Developers: [
    { label: "Documentation",  href: "/docs" },
    { label: "API Reference",  href: "/docs#agents-api" },
    { label: "SDKs",           href: "/docs#sdks" },
    { label: "MCP Servers",    href: "/integrations" },
    { label: "Status",         href: "https://status.agentdyne.com" },
  ],
  Company: [
    { label: "About",          href: "/about" },
    { label: "Blog",           href: "/blog" },
    { label: "Careers",        href: "/careers" },
    { label: "Contact",        href: "/contact" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service",href: "/terms" },
    { label: "Cookie Policy",  href: "/privacy#cookies" },
    { label: "Security",       href: "/contact" },
  ],
}

const SOCIALS = [
  { icon: Twitter,  href: "https://twitter.com/agentdyne",           label: "Twitter / X" },
  { icon: Github,   href: "https://github.com/agentdyne",            label: "GitHub" },
  { icon: Linkedin, href: "https://linkedin.com/company/agentdyne",  label: "LinkedIn" },
  { icon: Globe,    href: "https://discord.gg/agentdyne",            label: "Discord" },
]

export function Footer() {
  return (
    <footer className="bg-muted/10 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">

          {/* Brand — logo only, no text */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-block mb-5 group">
              <Image
                src="/logo.png"
                alt="AgentDyne"
                width={140}
                height={40}
                className="h-9 w-auto object-contain transition-opacity group-hover:opacity-80"
              />
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed mb-5">
              The world's premier marketplace for production-ready AI microagents. Discover, deploy, and earn.
            </p>
            <div className="flex items-center gap-3">
              {SOCIALS.map(({ icon: Icon, href, label }) => (
                <Link key={label} href={href} target="_blank" rel="noopener noreferrer"
                  aria-label={label}
                  className="w-8 h-8 rounded-lg bg-muted/50 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all">
                  <Icon className="h-3.5 w-3.5" />
                </Link>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">{category}</h3>
              <ul className="space-y-2.5">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AgentDyne, Inc. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="status-dot-green" />
              All systems operational
            </div>
            <span>v1.5.0</span>
            <Link href="/changelog" className="hover:text-foreground transition-colors">Changelog</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
