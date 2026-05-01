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
    { label: "Privacy Policy",  href: "/privacy" },
    { label: "Terms of Service",href: "/terms" },
    { label: "Security",        href: "/contact" },
  ],
}

const SOCIALS = [
  { icon: Twitter,  href: "https://twitter.com/agentdyne",          label: "X / Twitter" },
  { icon: Github,   href: "https://github.com/agentdyne",           label: "GitHub" },
  { icon: Linkedin, href: "https://linkedin.com/company/agentdyne", label: "LinkedIn" },
  { icon: Globe,    href: "https://discord.gg/agentdyne",           label: "Discord" },
]

export function Footer() {
  return (
    <footer className="bg-zinc-50 border-t border-zinc-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">

          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-block mb-5">
              <Image
                src="/logo.png"
                alt="AgentDyne"
                width={130}
                height={36}
                className="h-8 w-auto object-contain opacity-90 hover:opacity-100 transition-opacity"
              />
            </Link>
            <p className="text-xs text-zinc-500 leading-relaxed mb-5">
              The world's premier marketplace for production-ready AI microagents.
            </p>
            <div className="flex items-center gap-2.5">
              {SOCIALS.map(({ icon: Icon, href, label }) => (
                <Link
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-8 h-8 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:border-zinc-400 transition-all"
                >
                  <Icon className="h-3.5 w-3.5" />
                </Link>
              ))}
            </div>
          </div>

          {Object.entries(LINKS).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-zinc-900 uppercase tracking-wider mb-4">
                {category}
              </h3>
              <ul className="space-y-2.5">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-100 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/" className="inline-block">
            <Image
              src="/logo.png"
              alt="AgentDyne"
              width={110}
              height={30}
              className="h-7 w-auto object-contain"
              style={{ filter: "brightness(0) opacity(0.75)" }}
            />
          </Link>
          <p className="text-xs text-zinc-400">
            © {new Date().getFullYear()} AgentDyne, Inc. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5">
              <div className="dot-green" />
              All systems operational
            </div>
            <span>v1.5.0</span>
            <Link href="/changelog" className="hover:text-zinc-700 transition-colors">
              Changelog
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
