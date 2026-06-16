"use client"

/**
 * Integrations — /integrations
 * Bug fixes:
 *  ✅ loading=false when user is null (no infinite spinner)
 *  ✅ supabase created once via useRef
 *  ✅ useEffect dep array uses user?.id not user
 *  ✅ toggle handles null user gracefully
 *  ✅ search clear button only shown when search has value
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Search, CheckCircle, ExternalLink, Clock, Shield,
  Plus, Settings, AlertCircle, Globe, Activity,
  Link2, X, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

/* ── Brand SVG logos ─────────────────────────────────────────────── */
const BrandLogo = ({ id, size=26 }:{ id:string; size?:number }) => {
  const s = size
  const logos: Record<string, React.ReactNode> = {
    github: <svg viewBox="0 0 24 24" width={s} height={s} fill="#24292f"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>,
    slack: <svg viewBox="0 0 24 24" width={s} height={s}><path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/><path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/><path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/><path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>,
    notion: <svg viewBox="0 0 24 24" width={s} height={s} fill="#000"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/></svg>,
    supabase: <svg viewBox="0 0 24 24" width={s} height={s}><path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.99 12.015.99 12.008.99 12H12V1.036zM.764 12.05C.99 12.015.99 12.008.99 12L.99 12H0v10c0 .552.447 1 1 1h9.956L11 12l-.1-.95z" fill="#3ECF8E"/><path d="M12.1 22.964c.015.986 1.26 1.41 1.874.637L23.236 11.95C23.01 11.985 23.01 11.992 23.01 12H12V22.964zM23.236 11.95C23.01 11.985 23.01 11.992 23.01 12L23.01 12H24V2c0-.552-.447-1-1-1h-9.956L13 12l.1.95z" fill="#3ECF8E" opacity=".5"/></svg>,
    stripe: <svg viewBox="0 0 24 24" width={s} height={s} fill="#635bff"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"/></svg>,
    postgresql: <svg viewBox="0 0 24 24" width={s} height={s} fill="#336791"><path d="M23.5645 14.6005c-.1168-.1062-.2781-.175-.3963-.2163-.0812-.0276-.2012-.064-.3374-.1054-1.3208-.3908-2.1702-.9302-2.5336-1.5773-.0607-.104-.1138-.2113-.1615-.3233.3485-.2148.6645-.4635.9402-.7403 1.1148-1.1046 1.7222-2.5728 1.7222-4.1543 0-1.1513-.332-2.2433-.9609-3.1507L21.9 4.5c-.0276-.088-.0672-.172-.12-.2459C21.7 4.178 21.637 4.12 21.568 4.07c-.0696-.0508-.1464-.0896-.2264-.1146C21.3904 4 21.3048 4 21.2168 4H20.5c-.0208 0-.041.002-.0615.006C20.0673 3.6067 19.668 3.2368 19.2185 3c.186-.5752.2553-1.1799.2045-1.7675-.0488-.5656-.2143-1.0748-.4912-1.4943L18.9.5C18.8068.37 18.6948.2695 18.5668.1891 18.4392.1084 18.2956.0497 18.1437.0181 17.9924-.0139 17.836-.014 17.6852.0175c-.1516.0316-.296.092-.4276.178L17.106.3C16.7948.4948 16.5225.7579 16.3044 1.0844c-.2168.3248-.3649.6952-.4392 1.0985-.3116-.1115-.6396-.1895-.9776-.2324-.3316-.0425-.6665-.0636-.9984-.0636-1.0016 0-1.988.1716-2.9282.5125-.8773.3183-1.652.7847-2.2936 1.3773C8.6276 4.3619 8.2368 5 8.0161 5.6808c-2.1504.4896-3.6848 1.9155-4.484 3.3767C2.9856 10.1904 2.7924 11.5024 3.1052 12.8c.124.5064.3232.9857.5888 1.428-.344.1224-.7032.3332-.9948.6752-.2104.2449-.3704.5379-.4516.8515-.0212.0823-.0368.1651-.0468.248C1.2392 17.1984 1 19.2412 1 19.9996c0 2.1848 1.1848 3.9608 3.424 5.1244C6.0316 26.2376 8.452 27 11.5 27c2.988 0 5.9352-.9524 7.8912-2.5744 1.0752-.8992 1.8064-1.9712 2.0904-3.0436.068-.2596.1072-.5228.1072-.7852V19.8c.0656-.0872.1192-.1832.1608-.284.196-.4732.1128-1.032-.2452-1.464C21.3504 17.926 21.2424 17.8208 21.0888 17.728c.0252-.122.044-.244.044-.3688 0-.5408-.2368-1.0272-.6248-1.3648.5264-.4832.9236-1.08 1.1232-1.7532.0796-.2724.1344-.5556.1344-.8508 0-.1312-.0084-.2588-.028-.384C21.9348 14.9748 22.624 15 23.196 15c.2328 0 .44-.0512.6-.1604.26-.1736.3992-.448.3992-.724C24.1952 13.788 23.9748 13.1596 23.5645 14.6005z"/></svg>,
    redis: <svg viewBox="0 0 24 24" width={s} height={s} fill="#DC382D"><path d="M10.612 21.337c-3.28.616-9.623-.054-11.405-1.877C0.812 18.06.812 3.002 1.21 1.58.814.608 3.25.05 6.13 1.21l.025.01c2.88 1.16 5.745 2.85 7.77 4.887 1.637 1.64 2.51 4.16 2.51 4.16s.07.43-.6.57c-.67.14-7.195 1.5-8.205 1.73-.68.155-1.3.29-1.96.29-.26 0-.51-.022-.77-.073-.8-.15-1.47-.5-2.02-.94-.1-.08-.19-.17-.28-.26v.01c.2 1.43 1.1 2.53 2.37 3.2 1.31.69 2.97.86 4.51.56l.66-.14c2.5-.52 5.46-1.14 6.37-1.31.9-.17 1.67-.46 2.13-1.22.12.27.22.56.28.88.42 2.15-.96 4.37-4.09 5.69-.64.26-1.33.46-2.07.58-.74.12-1.52.17-2.31.17-.75 0-1.5-.05-2.22-.16l-.01-.02zm-6.51-8.92c-.5-.37-.9-.8-1.2-1.27.56.63 1.26 1.12 2.03 1.4.77.28 1.62.37 2.46.22.83-.15 1.6-.51 2.2-1.06.37-.34.67-.73.88-1.17l-6.37 1.88z"/></svg>,
    mongodb: <svg viewBox="0 0 24 24" width={s} height={s}><path d="M17.193 9.555c-1.264-5.58-4.252-7.414-4.573-8.115-.28-.394-.53-.954-.735-1.44-.036.495-.055.685-.523 1.184-.723.566-4.438 3.682-4.74 10.02-.282 5.912 4.27 9.435 4.888 9.884l.07.05A73.49 73.49 0 0111.91 24h.481c.114-1.032.284-2.056.51-3.07.417-.296.604-.463.85-.693a11.342 11.342 0 003.639-8.464c.01-.814-.103-1.662-.197-2.218zm-5.336 8.195s0-8.291.275-8.29c.213 0 .49 10.695.49 10.695-.381-.045-.765-1.76-.765-2.405z" fill="#47A248"/></svg>,
    discord: <svg viewBox="0 0 24 24" width={s} height={s} fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.074.11 18.09.12 18.1a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>,
    gmail: <svg viewBox="0 0 24 24" width={s} height={s}><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/></svg>,
    sendgrid: <svg viewBox="0 0 24 24" width={s} height={s} fill="#1A82E2"><path d="M8 0H0v8h8V0zM16 8H8v8h8V8zM8 8v8H0V8h8zM16 0H8v8h8V0zM24 0h-8v8h8V0zM24 8h-8v8h8V8zM16 16H8v8h8v-8z"/></svg>,
    "google-drive": <svg viewBox="0 0 24 24" width={s} height={s}><path d="M4.433 22.396l2.235-3.87H22.01l-2.235 3.87H4.433zM9.017 7.463L2.15 19.26l-2.06-3.566L5.947 5.9l3.07 1.563zM22.137 19.26H8.404l-3.07-5.313 6.865-11.798 3.071 5.314-4.04 6.97h10.906z" fill="#4285F4"/></svg>,
    anthropic: <svg viewBox="0 0 24 24" width={s} height={s} fill="#CC785C"><path d="M14.67 3H9.33L3 21h4.67l1.33-4h6l1.33 4H21L14.67 3zm-4 10l2-6 2 6h-4z"/></svg>,
    openai: <svg viewBox="0 0 24 24" width={s} height={s} fill="#10A37F"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.368 2.02-1.164a.08.08 0 0 1 .071 0l4.83 2.786a4.494 4.494 0 0 1-.676 8.108v-5.678a.79.79 0 0 0-.402-.684zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>,
    gemini: <svg viewBox="0 0 24 24" width={s} height={s} fill="#4285F4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>,
    hubspot: <svg viewBox="0 0 24 24" width={s} height={s} fill="#FF7A59"><path d="M18.164 7.93V5.084a2.198 2.198 0 10-1.999 0V7.93a6.244 6.244 0 00-2.998 11.02l-1.943 1.943a.855.855 0 00.897.614.85.85 0 00.52-.618l1.943-1.943a6.243 6.243 0 008.8-8.184zM17.164 17.5a3.746 3.746 0 110-7.493 3.746 3.746 0 010 7.493z"/></svg>,
    salesforce: <svg viewBox="0 0 24 24" width={s} height={s} fill="#00A1E0"><path d="M10.007 2.139a6.44 6.44 0 0 1 4.6 1.91 8.018 8.018 0 0 1 2.887-.53c4.45 0 8.06 3.61 8.06 8.06 0 4.45-3.61 8.06-8.06 8.06a8.07 8.07 0 0 1-2.344-.348A5.857 5.857 0 0 1 10.95 20.3a5.9 5.9 0 0 1-4.714-2.353 7.25 7.25 0 0 1-1.286.115C2.21 18.062 0 15.851 0 13.112a4.95 4.95 0 0 1 1.927-3.921 6.437 6.437 0 0 1 8.08-7.052z"/></svg>,
    vercel: <svg viewBox="0 0 24 24" width={s} height={s} fill="#000"><path d="M24 22.525H0l12-21.05 12 21.05z"/></svg>,
    cloudflare: <svg viewBox="0 0 24 24" width={s} height={s} fill="#F38020"><path d="M16.72 15.498l.247-.851c.298-1.044.164-2.008-.375-2.717-.501-.66-1.296-1.048-2.218-1.088l-7.854-.107a.187.187 0 0 1-.169-.108.194.194 0 0 1 .034-.208c.071-.083.178-.1.273-.099l7.923.107c1.872.084 3.857-.657 4.675-2.038A4.95 4.95 0 0 0 19.578 6a.185.185 0 0 0-.166-.153A7.71 7.71 0 0 0 19.194 3C17.553 1.197 15.128 0 12.422 0 9.8 0 7.438 1.127 5.803 2.927a.193.193 0 0 1-.185.058 3.906 3.906 0 0 0-.646-.053C2.217 2.932.488 4.581.488 6.628c0 .247.026.49.075.725a.186.186 0 0 1-.122.213 3.88 3.88 0 0 0-2.65 3.673c0 2.153 1.742 3.9 3.889 3.9h14.668a.19.19 0 0 0 .183-.14l.19-.502z"/></svg>,
    jira: <svg viewBox="0 0 24 24" width={s} height={s} fill="#0052CC"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84zM6.77 6.8c0 2.4 1.97 4.35 4.35 4.35h1.78v1.71c0 2.4 1.94 4.34 4.35 4.35V7.63a.84.84 0 0 0-.84-.83zM2 11.6c0 2.4 1.97 4.35 4.35 4.35h1.78v1.71c0 2.4 1.94 4.34 4.35 4.34v-9.56a.84.84 0 0 0-.84-.84z"/></svg>,
    linear: <svg viewBox="0 0 24 24" width={s} height={s} fill="#5E6AD2"><path d="M.998 12.002C.998 5.37 5.37.998 12 .998c6.632 0 11.002 4.37 11.002 11.004 0 6.632-4.37 11.002-11.002 11.002C5.37 23.004.998 18.634.998 12.002zM5.87 18.13c3.47 3.47 9.14 3.47 12.61 0a8.93 8.93 0 0 0 0-12.61c-3.47-3.47-9.14-3.47-12.61 0a8.93 8.93 0 0 0 0 12.61z"/></svg>,
    "aws-s3": <svg viewBox="0 0 24 24" width={s} height={s} fill="#FF9900"><path d="M6.763 6.04L3.2 7.2v9.6l3.563 1.16.375-5.96zM17.237 6.04l.375 5.96.375-5.96 3.563-1.16v9.6l-3.563 1.16zM12 4.8l-4.763 1.56v11.28L12 19.2l4.763-1.56V6.36z"/></svg>,
    mysql: <svg viewBox="0 0 24 24" width={s} height={s} fill="#4479A1"><path d="M16.405 5.501c-.115 0-.193.014-.274.033v.013h.014c.054.104.146.18.214.274.054.107.1.214.154.32l.014-.015c.094-.066.14-.172.14-.333-.04-.047-.046-.094-.08-.14-.04-.067-.126-.1-.18-.153zM5.77 18.695h-.927a50.854 50.854 0 00-.27-4.41h-.008l-1.41 4.41H2.45l-1.4-4.41h-.01a72.892 72.892 0 00-.195 4.41H0c.055-1.966.192-3.81.41-5.53h1.15l1.335 4.064h.008l1.347-4.064h1.095c.242 2.015.384 3.86.428 5.53zm4.017-4.08c-.378 2.045-.876 3.533-1.492 4.46-.482.716-1.01 1.073-1.583 1.073-.153 0-.34-.046-.566-.138v-.494c.11.017.24.026.386.026.268 0 .483-.075.647-.222.197-.18.295-.382.295-.605 0-.155-.077-.47-.23-.944L6.23 14.615h.91l.727 2.36c.164.536.233.91.205 1.123.4-1.064.678-2.227.835-3.483zm12.325 4.08h-2.63v-5.53h.885v4.85h1.745zm-3.32.135l-1.016-.5c.09-.076.177-.158.255-.25.433-.506.648-1.258.648-2.253 0-1.83-.718-2.746-2.155-2.746-.704 0-1.254.232-1.65.697-.43.508-.646 1.256-.646 2.245 0 .972.19 1.686.574 2.14.35.41.877.615 1.583.615.264 0 .506-.033.725-.098l1.325.772.357-.622zM15.5 17.588c-.262.59-.69.886-1.284.886-.827 0-1.24-.682-1.24-2.046 0-1.35.42-2.024 1.26-2.024.834 0 1.25.69 1.25 2.07-.01.406-.002.726-.014.924-.01.15-.006.17-.008.19z"/></svg>,
  }
  const logo = logos[id]
  if (!logo) return (
    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-400 rounded-lg"
      style={{ background:"#f4f4f5" }}>
      {id.slice(0,2).toUpperCase()}
    </div>
  )
  return <div style={{ width:s,height:s,flexShrink:0 }}>{logo}</div>
}

/* ── Catalogue ───────────────────────────────────────────────────── */
type Category = "databases"|"communication"|"productivity"|"development"|"cloud"|"ai"|"finance"|"analytics"|"files"

interface Integration {
  id:string; name:string; description:string; category:Category
  bgColor:string; setupMinutes:number; verified:boolean
  capabilities:string[]; docsUrl:string; tags:string[]; isMCP?:boolean
}

const INTEGRATIONS: Integration[] = [
  {id:"supabase",    name:"Supabase",      category:"databases",     bgColor:"#e8fdf5",verified:true, setupMinutes:3, capabilities:["read","write","realtime","rpc"],          docsUrl:"https://supabase.com/docs",           tags:["postgres","realtime"],isMCP:true, description:"Postgres database with realtime subscriptions, auth, storage and edge functions."},
  {id:"postgresql",  name:"PostgreSQL",    category:"databases",     bgColor:"#e8f0f9",verified:true, setupMinutes:5, capabilities:["query","insert","update","delete"],       docsUrl:"https://postgresql.org/docs",         tags:["sql","database"],              description:"World's most advanced open-source relational database."},
  {id:"mongodb",     name:"MongoDB",       category:"databases",     bgColor:"#edf7ee",verified:true, setupMinutes:4, capabilities:["find","insert","update","aggregate"],     docsUrl:"https://mongodb.com/docs",            tags:["nosql","database"],            description:"Document database built for the scale of modern applications."},
  {id:"redis",       name:"Redis",         category:"databases",     bgColor:"#fef0f0",verified:true, setupMinutes:3, capabilities:["get","set","pub/sub","cache"],            docsUrl:"https://redis.io/docs",               tags:["cache","queue"],               description:"In-memory data store used as a database, cache, and message broker."},
  {id:"mysql",       name:"MySQL",         category:"databases",     bgColor:"#e8f0f9",verified:false,setupMinutes:5, capabilities:["query","stored procs","triggers"],        docsUrl:"https://dev.mysql.com/doc",           tags:["sql","database"],              description:"The world's most popular open-source relational database."},
  {id:"slack",       name:"Slack",         category:"communication", bgColor:"#f9f0fb",verified:true, setupMinutes:2, capabilities:["send message","channels","threads"],      docsUrl:"https://api.slack.com",               tags:["messaging","team"], isMCP:true,description:"Business messaging that connects teams and automates workflows."},
  {id:"discord",     name:"Discord",       category:"communication", bgColor:"#f0f1fe",verified:true, setupMinutes:3, capabilities:["send","webhooks","threads"],              docsUrl:"https://discord.com/developers",      tags:["community","messaging"],       description:"VoIP and instant messaging platform for communities and teams."},
  {id:"gmail",       name:"Gmail",         category:"communication", bgColor:"#fef0f0",verified:true, setupMinutes:2, capabilities:["send","read","labels","drafts"],          docsUrl:"https://developers.google.com/gmail", tags:["email","google"],  isMCP:true,description:"Google's email service with powerful filtering, labels, and search."},
  {id:"sendgrid",    name:"SendGrid",      category:"communication", bgColor:"#e8f2fe",verified:true, setupMinutes:5, capabilities:["send","templates","analytics"],           docsUrl:"https://docs.sendgrid.com",           tags:["email","transactional"],       description:"Cloud-based SMTP provider for transactional email at scale."},
  {id:"github",      name:"GitHub",        category:"development",   bgColor:"#f4f4f5",verified:true, setupMinutes:2, capabilities:["repos","issues","PRs","actions"],         docsUrl:"https://docs.github.com",             tags:["git","code"],       isMCP:true,description:"Where the world builds software — host and collaborate on code."},
  {id:"notion",      name:"Notion",        category:"productivity",  bgColor:"#f4f4f5",verified:true, setupMinutes:3, capabilities:["pages","databases","blocks","search"],    docsUrl:"https://developers.notion.com",       tags:["docs","wiki"],      isMCP:true,description:"All-in-one workspace for notes, docs, databases, and projects."},
  {id:"jira",        name:"Jira",          category:"productivity",  bgColor:"#e8effc",verified:true, setupMinutes:5, capabilities:["issues","sprints","boards","comments"],   docsUrl:"https://developer.atlassian.com",     tags:["project","agile"],             description:"Issue and project tracking for Agile software teams."},
  {id:"linear",      name:"Linear",        category:"productivity",  bgColor:"#f0f0fe",verified:true, setupMinutes:2, capabilities:["issues","cycles","projects","roadmap"],   docsUrl:"https://linear.app/docs",             tags:["project","issues"],            description:"Purpose-built issue tracking for modern software teams."},
  {id:"google-drive",name:"Google Drive",  category:"files",         bgColor:"#e8f0fe",verified:true, setupMinutes:2, capabilities:["read","write","share","search"],          docsUrl:"https://developers.google.com/drive", tags:["storage","files"],  isMCP:true,description:"Cloud storage that lets you store and access files anywhere."},
  {id:"aws-s3",      name:"AWS S3",        category:"cloud",         bgColor:"#fff8ee",verified:true, setupMinutes:8, capabilities:["upload","download","list","presign"],     docsUrl:"https://docs.aws.amazon.com/s3",      tags:["storage","aws"],               description:"Object storage built to retrieve any amount of data from anywhere."},
  {id:"cloudflare",  name:"Cloudflare",    category:"cloud",         bgColor:"#fff4e8",verified:true, setupMinutes:5, capabilities:["workers","kv","r2","pages"],              docsUrl:"https://developers.cloudflare.com",   tags:["cdn","edge"],                  description:"Fast, scalable edge network for apps, APIs, and static sites."},
  {id:"vercel",      name:"Vercel",        category:"cloud",         bgColor:"#f4f4f5",verified:true, setupMinutes:3, capabilities:["deployments","domains","env","logs"],     docsUrl:"https://vercel.com/docs",             tags:["hosting","nextjs"],            description:"Platform for frontend developers — deploy instantly, scale globally."},
  {id:"anthropic",   name:"Anthropic",     category:"ai",            bgColor:"#fdf2ee",verified:true, setupMinutes:2, capabilities:["claude","messages","streaming","tools"],  docsUrl:"https://docs.anthropic.com",          tags:["llm","claude"],                description:"AI safety company — build with Claude for any use case."},
  {id:"openai",      name:"OpenAI",        category:"ai",            bgColor:"#e8f8f4",verified:true, setupMinutes:2, capabilities:["chat","embeddings","dall-e","whisper"],   docsUrl:"https://platform.openai.com/docs",    tags:["llm","gpt"],                   description:"Access GPT-4, DALL·E, Whisper and more via a unified API."},
  {id:"gemini",      name:"Google Gemini", category:"ai",            bgColor:"#e8f0fe",verified:true, setupMinutes:2, capabilities:["chat","multimodal","code","search"],      docsUrl:"https://ai.google.dev",               tags:["llm","google"],                description:"Google's most capable AI model — multimodal, fast, efficient."},
  {id:"stripe",      name:"Stripe",        category:"finance",       bgColor:"#f0f0ff",verified:true, setupMinutes:5, capabilities:["payments","invoices","subscriptions"],    docsUrl:"https://stripe.com/docs",             tags:["payments","billing"],isMCP:true,description:"Complete payments infrastructure — accept and automate billing."},
  {id:"hubspot",     name:"HubSpot",       category:"analytics",     bgColor:"#fff3f0",verified:true, setupMinutes:5, capabilities:["contacts","deals","campaigns","reports"], docsUrl:"https://developers.hubspot.com",      tags:["crm","marketing"],             description:"CRM platform connecting marketing, sales, and customer service."},
  {id:"salesforce",  name:"Salesforce",    category:"analytics",     bgColor:"#e8f5fd",verified:false,setupMinutes:10,capabilities:["leads","opportunities","reports","flows"],docsUrl:"https://developer.salesforce.com",    tags:["crm","enterprise"],            description:"World's #1 CRM — connect with customers in new ways."},
]

const CATEGORIES = [
  {id:"all",           label:"All"},
  {id:"databases",     label:"Databases"},
  {id:"communication", label:"Comms"},
  {id:"development",   label:"Dev Tools"},
  {id:"productivity",  label:"Productivity"},
  {id:"cloud",         label:"Cloud"},
  {id:"ai",            label:"AI / LLMs"},
  {id:"finance",       label:"Finance"},
  {id:"analytics",     label:"Analytics"},
  {id:"files",         label:"Files"},
]

/* ── Main ────────────────────────────────────────────────────────── */

export default function IntegrationsClient() {
  const { user } = useUser()

  // Bug fix: create supabase once via ref
  const sbRef = useRef<ReturnType<typeof createClient>|null>(null)
  if (!sbRef.current) sbRef.current = createClient()
  const supabase = sbRef.current

  const [search,     setSearch]     = useState("")
  const [category,   setCategory]   = useState<string>("all")
  const [activeTab,  setActiveTab]  = useState<"all"|"connected"|"mcp">("all")
  const [connected,  setConnected]  = useState<Set<string>>(new Set())
  const [connecting, setConnecting] = useState<string|null>(null)
  const [loading,    setLoading]    = useState(true)
  const [usageData,  setUsageData]  = useState<Record<string,number>>({})

  useEffect(()=>{
    // Bug fix: if no user, stop loading immediately — don't spin forever
    if (!user) { setLoading(false); return }
    supabase.from("user_integrations")
      .select("integration_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .then(({ data })=>{
        setConnected(new Set((data??[]).map((r:any)=>r.integration_id)))
        setLoading(false)
      })
      .catch(()=>setLoading(false))
    supabase.from("integration_usage")
      .select("integration_id,calls")
      .eq("user_id", user.id)
      .then(({ data })=>{
        const map:Record<string,number>={}
        ;(data??[]).forEach((r:any)=>{ map[r.integration_id]=r.calls })
        setUsageData(map)
      })
      .catch(()=>{})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.id])

  const toggle = useCallback(async (integ:Integration)=>{
    if (!user) { toast.error("Sign in to connect integrations"); return }
    setConnecting(integ.id)
    try {
      if (connected.has(integ.id)) {
        await supabase.rpc("disconnect_user_integration",{ p_user_id:user.id, p_integration_id:integ.id })
        setConnected(prev=>{ const n=new Set(prev); n.delete(integ.id); return n })
        toast.success(`${integ.name} disconnected`)
      } else {
        await supabase.rpc("upsert_user_integration",{
          p_user_id:user.id, p_integration_id:integ.id,
          p_name:integ.name, p_category:integ.category, p_config:{}
        })
        setConnected(prev=>new Set([...prev,integ.id]))
        toast.success(`${integ.name} connected!`)
      }
    } catch(err:any) {
      toast.error(err.message??"Failed to update integration")
    } finally {
      setConnecting(null)
    }
  },[user,connected,supabase])

  const filtered = INTEGRATIONS.filter(s=>{
    if (activeTab==="connected"&&!connected.has(s.id)) return false
    if (activeTab==="mcp"      &&!s.isMCP)             return false
    if (category!=="all"       &&s.category!==category) return false
    if (search) {
      const q=search.toLowerCase()
      return s.name.toLowerCase().includes(q)||s.description.toLowerCase().includes(q)||s.tags.some(t=>t.includes(q))
    }
    return true
  })

  const connectedCount = connected.size
  const mcpCount       = INTEGRATIONS.filter(s=>s.isMCP).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Link2 className="h-6 w-6 text-indigo-500"/>
            Integrations
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Connect your agents to {INTEGRATIONS.length} services — databases, APIs, cloud, and more.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400 bg-white border border-zinc-100 px-3 py-2 rounded-xl">
          <Shield className="h-3.5 w-3.5 text-green-500"/>Credentials encrypted at rest
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {label:"Total",    value:INTEGRATIONS.length, color:"text-indigo-600", emoji:"🔌"},
          {label:"Connected",value:connectedCount,       color:"text-green-600",  emoji:"✅"},
          {label:"MCP",      value:mcpCount,             color:"text-violet-600", emoji:"⚡"},
          {label:"≤3 min setup",value:INTEGRATIONS.filter(s=>s.setupMinutes<=3).length,color:"text-amber-600",emoji:"🚀"},
        ].map(s=>(
          <div key={s.label} className="bg-white border border-zinc-100 rounded-2xl p-4"
            style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{s.emoji}</span>
              <p className={cn("text-2xl font-bold tabular-nums",s.color)}>{s.value}</p>
            </div>
            <p className="text-xs text-zinc-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center bg-zinc-50 border border-zinc-100 rounded-xl p-1 gap-0.5">
          {[{id:"all",label:`All (${INTEGRATIONS.length})`},{id:"connected",label:`Connected (${connectedCount})`},{id:"mcp",label:`MCP (${mcpCount})`}].map(tab=>(
            <button key={tab.id} type="button" onClick={()=>setActiveTab(tab.id as any)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                activeTab===tab.id?"bg-white text-zinc-900 shadow-sm border border-zinc-100":"text-zinc-500 hover:text-zinc-700")}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400"/>
          <input type="text" placeholder="Search integrations…" value={search}
            onChange={e=>setSearch(e.target.value)}
            className="w-full pl-9 pr-9 h-9 rounded-xl border border-zinc-200 bg-white text-sm focus:outline-none focus:border-zinc-400 transition-all"/>
          {/* Bug fix: only show clear button when search has value */}
          {search&&(
            <button onClick={()=>setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5">
              <X className="h-3.5 w-3.5 text-zinc-400"/>
            </button>
          )}
        </div>
      </div>

      {/* Category chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORIES.map(({id,label})=>(
          <button key={id} type="button" onClick={()=>setCategory(id)}
            className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
              category===id
                ?id==="all"?"bg-zinc-900 text-white border-zinc-900":"bg-indigo-500 text-white border-indigo-500"
                :"bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400")}>
            {label}
          </button>
        ))}
      </div>

      <p className="text-xs text-zinc-400">
        {filtered.length} integration{filtered.length!==1?"s":""}
        {connectedCount>0&&` · ${connectedCount} connected`}
      </p>

      {/* Grid */}
      {loading?(
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300"/>
        </div>
      ):(
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((integ,i)=>{
              const isConnected=connected.has(integ.id)
              const isConnecting=connecting===integ.id
              const usage=usageData[integ.id]??0
              return (
                <motion.div key={integ.id} layout
                  initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:0.95}}
                  transition={{delay:Math.min(i*0.02,0.25)}}>
                  <div className={cn("bg-white border rounded-2xl p-5 flex flex-col h-full transition-all",
                    isConnected?"border-green-200":"border-zinc-100 hover:border-zinc-200 hover:shadow-md")}
                    style={{boxShadow:isConnected?"0 0 0 3px rgba(34,197,94,0.08)":"0 1px 3px rgba(0,0,0,0.04)"}}>
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{background:integ.bgColor}}>
                        <BrandLogo id={integ.id} size={24}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <h3 className="font-semibold text-sm text-zinc-900 truncate">{integ.name}</h3>
                          {integ.verified&&<CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0"/>}
                          {integ.isMCP&&<Badge className="text-[9px] h-4 px-1.5 bg-violet-50 text-violet-600 border-violet-200 font-bold">MCP</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5"/>{integ.setupMinutes}min
                          </span>
                          {isConnected&&<span className="text-[10px] font-bold bg-green-50 text-green-600 border border-green-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                            <CheckCircle className="h-2.5 w-2.5"/>Connected
                          </span>}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed flex-1 mb-3">{integ.description}</p>
                    {/* Capabilities */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {integ.capabilities.slice(0,3).map(cap=>(
                        <span key={cap} className="text-[10px] font-mono bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-500">{cap}</span>
                      ))}
                      {integ.capabilities.length>3&&<span className="text-[10px] bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-400">+{integ.capabilities.length-3}</span>}
                    </div>
                    {/* Usage */}
                    {isConnected&&usage>0&&(
                      <div className="flex items-center gap-1.5 mb-3 text-[11px] text-zinc-400">
                        <Activity className="h-3 w-3"/><span className="tabular-nums font-medium">{usage.toLocaleString()} calls this month</span>
                      </div>
                    )}
                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-3 border-t border-zinc-50">
                      <button type="button" onClick={()=>toggle(integ)} disabled={isConnecting}
                        className={cn("flex-1 h-8 text-xs rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all",
                          isConnecting?"bg-zinc-100 text-zinc-400 cursor-wait"
                            :isConnected?"bg-red-50 text-red-600 hover:bg-red-100 border border-red-100"
                            :"bg-zinc-900 text-white hover:bg-zinc-700")}>
                        {isConnecting?<><Loader2 className="h-3 w-3 animate-spin"/>Connecting…</>
                          :isConnected?<><Settings className="h-3 w-3"/>Disconnect</>
                          :<><Plus className="h-3 w-3"/>Connect</>}
                      </button>
                      <a href={integ.docsUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-xl border-zinc-200 hover:border-zinc-400">
                          <ExternalLink className="h-3.5 w-3.5"/>
                        </Button>
                      </a>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {!loading&&filtered.length===0&&(
        <div className="text-center py-16 bg-white border border-zinc-100 rounded-2xl">
          <AlertCircle className="h-8 w-8 text-zinc-200 mx-auto mb-3"/>
          <p className="text-zinc-400 font-medium">No integrations found</p>
          <p className="text-zinc-300 text-sm mt-1">
            {activeTab==="connected"?"Connect your first integration above.":"Try a different keyword."}
          </p>
          {activeTab==="connected"&&(
            <button onClick={()=>setActiveTab("all")} className="mt-3 text-xs font-semibold text-indigo-500 hover:underline">
              Browse all integrations →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
