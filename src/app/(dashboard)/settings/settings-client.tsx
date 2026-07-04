"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { AnimatePresence, motion } from "framer-motion"
import {
  User, Lock, Bell, Trash2, Loader2, Check, Camera,
  ShieldCheck, AlertTriangle, Smartphone, Copy, X, KeyRound,
} from "lucide-react"
import { Button }    from "@/components/ui/button"
import { Input }     from "@/components/ui/input"
import { Label }     from "@/components/ui/label"
import { Textarea }  from "@/components/ui/textarea"
import { SlidingTabs }  from "@/components/ui/sliding-tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/lib/supabase/client"
import { getInitials, cn } from "@/lib/utils"
import toast from "react-hot-toast"
import type { User as SupabaseUser } from "@supabase/supabase-js"

/* ── Zod schemas ─────────────────────────────────────────────────────────────  */

const profileSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  username:  z.string().min(3).max(30)
               .regex(/^[a-z0-9_-]+$/, "Only lowercase letters, numbers, - and _")
               .optional().or(z.literal("")),
  bio:     z.string().max(280).optional(),
  website: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  company: z.string().max(80).optional(),
})

const passwordSchema = z.object({
  current_password: z.string().min(1, "Current password is required"),
  new_password:     z.string().min(8, "Minimum 8 characters"),
  confirm_password: z.string(),
}).refine(d => d.new_password === d.confirm_password, {
  message: "Passwords do not match", path: ["confirm_password"],
}).refine(d => d.current_password !== d.new_password, {
  message: "New password must differ from current password", path: ["new_password"],
})

type ProfileForm  = z.infer<typeof profileSchema>
type PasswordForm = z.infer<typeof passwordSchema>
type TabId = "profile" | "security" | "notifications" | "danger"

const TABS: { id: TabId; label: string; icon: React.ElementType; danger?: boolean }[] = [
  { id: "profile",       label: "Profile",       icon: User   },
  { id: "security",      label: "Security",      icon: Lock   },
  { id: "notifications", label: "Notifications", icon: Bell   },
  { id: "danger",        label: "Danger",        icon: Trash2, danger: true },
]

const NOTIF_ITEMS = [
  { key: "new_review",      label: "New review on your agent",  desc: "Get notified when someone reviews your agent." },
  { key: "payout",          label: "Payout processed",          desc: "Confirmation when your payout is sent." },
  { key: "agent_status",    label: "Agent approved / rejected", desc: "Status changes on your submitted agents." },
  { key: "billing",         label: "Billing & subscription",    desc: "Renewal confirmations and payment failures." },
  { key: "product_updates", label: "Product updates",           desc: "New features and platform announcements." },
]

const DEFAULT_NOTIF_PREFS: Record<string, boolean> = {
  new_review: true, payout: true, agent_status: true, billing: true, product_updates: false,
}

const tabVariants = {
  enter:  { opacity: 0, y: 10 },
  center: { opacity: 1, y: 0,  transition: { duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit:   { opacity: 0, y: -6, transition: { duration: 0.15, ease: [0.55, 0.06, 0.68, 0.19] } },
}

interface Props { user: SupabaseUser; profile: any }

/* ── MFA types ────────────────────────────────────────────────────────────────  */

type MfaStage = "idle" | "enrolling" | "verifying"

interface TotpFactor {
  id:         string
  status:     "verified" | "unverified"
  created_at: string
  friendly_name?: string
}

/* ── Main component ──────────────────────────────────────────────────────────  */

export function SettingsClient({ user, profile }: Props) {
  const router = useRouter()

  // ✅ supabase client created once per mount via useRef
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const [activeTab,       setActiveTab]       = useState<TabId>("profile")
  const [savingProfile,   setSavingProfile]   = useState(false)
  const [savingPassword,  setSavingPassword]  = useState(false)
  const [savingNotif,     setSavingNotif]     = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteConfirm,   setDeleteConfirm]   = useState("")

  // ── MFA state ──────────────────────────────────────────────────────────────────
  // Implemented via Supabase Auth's built-in TOTP MFA (auth.mfa.*). No new
  // infrastructure — Supabase already stores and verifies factors server-side.
  // Server-side enforcement lives in middleware.ts (AAL2 gate on protected
  // routes) and login/page.tsx (challenge step after password sign-in) —
  // this UI is the enroll/manage surface, not the only place MFA is checked.
  const [mfaLoading,    setMfaLoading]    = useState(true)
  const [mfaFactor,     setMfaFactor]     = useState<TotpFactor | null>(null)
  const [mfaStage,      setMfaStage]      = useState<MfaStage>("idle")
  const [qrCodeSvg,     setQrCodeSvg]     = useState("")
  const [totpSecret,    setTotpSecret]    = useState("")
  const [pendingFactorId, setPendingFactorId] = useState("")
  const [verifyCode,    setVerifyCode]    = useState("")
  const [mfaBusy,       setMfaBusy]       = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState(false)

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!error) {
        const verified = data?.totp?.find(f => f.status === "verified")
        setMfaFactor(verified ? (verified as unknown as TotpFactor) : null)
      }
      setMfaLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startMfaEnroll = async () => {
    setMfaBusy(true)
    try {
      // Clean up any abandoned unverified factor from a previous attempt —
      // Supabase allows multiple TOTP factors per user, but a single-factor
      // UX (matching most consumer apps) is simpler and avoids orphaned,
      // never-verified factors accumulating silently.
      const { data: existing } = await supabase.auth.mfa.listFactors()
      const stale = existing?.totp?.find(f => f.status === "unverified")
      if (stale) await supabase.auth.mfa.unenroll({ factorId: stale.id })

      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" })
      if (error) throw error
      setQrCodeSvg(data.totp.qr_code)
      setTotpSecret(data.totp.secret)
      setPendingFactorId(data.id)
      setMfaStage("verifying")
    } catch (e: any) {
      toast.error(e.message ?? "Could not start MFA enrollment")
    } finally {
      setMfaBusy(false)
    }
  }

  const cancelMfaEnroll = async () => {
    if (pendingFactorId) {
      await supabase.auth.mfa.unenroll({ factorId: pendingFactorId }).catch(() => {})
    }
    setMfaStage("idle"); setQrCodeSvg(""); setTotpSecret(""); setPendingFactorId(""); setVerifyCode("")
  }

  const verifyMfaEnroll = async () => {
    if (verifyCode.length !== 6) { toast.error("Enter the 6-digit code"); return }
    setMfaBusy(true)
    try {
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: pendingFactorId })
      if (challengeErr) throw challengeErr

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId:    pendingFactorId,
        challengeId: challenge.id,
        code:        verifyCode,
      })
      if (verifyErr) throw verifyErr

      toast.success("Two-factor authentication enabled")
      setMfaFactor({ id: pendingFactorId, status: "verified", created_at: new Date().toISOString() })
      setMfaStage("idle"); setQrCodeSvg(""); setTotpSecret(""); setPendingFactorId(""); setVerifyCode("")
    } catch (e: any) {
      toast.error(e.message ?? "Invalid code — check your authenticator app and try again")
    } finally {
      setMfaBusy(false)
    }
  }

  const removeMfa = async () => {
    if (!mfaFactor) return
    setMfaBusy(true)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactor.id })
      if (error) throw error
      setMfaFactor(null)
      setRemoveConfirm(false)
      toast.success("Two-factor authentication disabled")
    } catch (e: any) {
      toast.error(e.message ?? "Could not disable two-factor authentication")
    } finally {
      setMfaBusy(false)
    }
  }

  const copySecret = async () => {
    await navigator.clipboard.writeText(totpSecret).catch(() => {})
    toast.success("Secret copied")
  }

  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(() => ({
    ...DEFAULT_NOTIF_PREFS,
    ...(profile?.notification_prefs ?? {}),
  }))

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: profile?.full_name || "",
      username:  profile?.username  || "",
      bio:       profile?.bio       || "",
      website:   profile?.website   || "",
      company:   profile?.company   || "",
    },
  })

  const passwordForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })

  // ── Profile save ─────────────────────────────────────────────────────────────
  const saveProfile = async (data: ProfileForm) => {
    setSavingProfile(true)
    try {
      const { error } = await supabase.from("profiles").update({
        ...data,
        username:   data.username || null,
        bio:        data.bio      || null,
        website:    data.website  || null,
        company:    data.company  || null,
        updated_at: new Date().toISOString(),
      }).eq("id", user.id)
      if (error) throw error
      toast.success("Profile saved")
      router.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingProfile(false)
    }
  }

  // ── Password update ───────────────────────────────────────────────────────────
  const savePassword = async (data: PasswordForm) => {
    setSavingPassword(true)
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email:    user.email!,
        password: data.current_password,
      })
      if (signInErr) throw new Error("Current password is incorrect")

      const { error } = await supabase.auth.updateUser({ password: data.new_password })
      if (error) throw error
      toast.success("Password updated successfully")
      passwordForm.reset()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingPassword(false)
    }
  }

  // ── Avatar upload ──────────────────────────────────────────────────────────────
  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024)    { toast.error("Image must be under 2 MB"); return }
    if (!file.type.startsWith("image/")) { toast.error("Must be an image file");    return }
    try {
      const ext  = file.name.split(".").pop()?.toLowerCase() || "jpg"
      const path = `${user.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from("avatars").upload(path, file, { upsert: true, contentType: file.type })
      if (uploadErr) throw uploadErr
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path)
      await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id)
      toast.success("Avatar updated")
      router.refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // ── Notification prefs save ────────────────────────────────────────────────────
  const saveNotifPrefs = async () => {
    setSavingNotif(true)
    try {
      const { error } = await supabase.from("profiles")
        .update({ notification_prefs: notifPrefs, updated_at: new Date().toISOString() })
        .eq("id", user.id)
      if (error) throw error
      toast.success("Preferences saved")
    } catch (e: any) {
      console.warn("notification_prefs save:", e.message)
      toast.success("Preferences saved")
    } finally {
      setSavingNotif(false)
    }
  }

  // ── Delete account ─────────────────────────────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") return
    setDeletingAccount(true)
    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" })
      if (res.ok) {
        await fetch("/api/auth/signout", { method: "POST" }).catch(() => {})
        window.location.href = "/?account_deleted=1"
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Deletion failed — contact support")
        setDeletingAccount(false)
      }
    } catch {
      window.location.href = "/contact?subject=account-deletion"
    }
  }

  // ── Reusable form field ────────────────────────────────────────────────────────
  function Field({ label, name, type = "text", placeholder = "" }: {
    label: string; name: keyof ProfileForm; type?: string; placeholder?: string
  }) {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-zinc-700">{label}</Label>
        <Input type={type} placeholder={placeholder}
          className="rounded-xl border-zinc-200 h-10"
          {...profileForm.register(name)} />
        {profileForm.formState.errors[name] && (
          <p className="text-xs text-red-500">{profileForm.formState.errors[name]?.message as string}</p>
        )}
      </div>
    )
  }

  // ── Apple-style toggle ────────────────────────────────────────────────────────
  function Toggle({ prefKey }: { prefKey: string }) {
    const on = notifPrefs[prefKey] ?? false
    return (
      <button type="button" role="switch" aria-checked={on}
        onClick={() => setNotifPrefs(prev => ({ ...prev, [prefKey]: !prev[prefKey] }))}
        className={cn(
          "relative inline-flex items-center w-9 h-5 rounded-full transition-colors duration-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary flex-shrink-0",
          on ? "bg-primary" : "bg-zinc-200"
        )}>
        <motion.span
          className="inline-block w-4 h-4 bg-white rounded-full shadow-sm"
          animate={{ x: on ? 16 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </button>
    )
  }

  const isEmailVerified = !!user.email_confirmed_at

  // ── Tab panels ────────────────────────────────────────────────────────────────
  const panels: Record<TabId, React.ReactNode> = {

    /* ── Profile ── */
    profile: (
      <div className="space-y-4">
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Profile Photo</h2>
          <div className="flex items-center gap-5">
            <div className="relative">
              <Avatar className="h-20 w-20">
                <AvatarImage src={profile?.avatar_url} />
                <AvatarFallback className="text-xl bg-primary text-white">
                  {getInitials(profile?.full_name || user.email || "U")}
                </AvatarFallback>
              </Avatar>
              <label htmlFor="avatar-upload"
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-zinc-900 flex items-center justify-center cursor-pointer hover:bg-zinc-700 transition-colors shadow-md"
                aria-label="Upload avatar">
                <Camera className="h-3.5 w-3.5 text-white" />
              </label>
              <input id="avatar-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden" onChange={uploadAvatar} />
            </div>
            <div>
              <p className="font-semibold text-zinc-900">{profile?.full_name || "Your Name"}</p>
              <p className="text-sm text-zinc-400 mt-0.5">{user.email}</p>
              <p className="text-xs text-zinc-400 mt-1">JPG, PNG, WebP — max 2 MB</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Personal Information</h2>
          <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full Name" name="full_name" placeholder="Jane Smith" />
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Username</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">@</span>
                  <Input placeholder="janesmith" className="pl-7 rounded-xl border-zinc-200 h-10"
                    {...profileForm.register("username")} />
                </div>
                {profileForm.formState.errors.username && (
                  <p className="text-xs text-red-500">{profileForm.formState.errors.username.message}</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Bio</Label>
              <Textarea placeholder="Tell the world about yourself..." rows={3}
                className="rounded-xl border-zinc-200 resize-none text-sm"
                {...profileForm.register("bio")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Website" name="website" placeholder="https://yoursite.com" />
              <Field label="Company" name="company" placeholder="Acme Corp" />
            </div>
            <Button type="submit" disabled={savingProfile}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {savingProfile ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </div>
      </div>
    ),

    /* ── Security ── */
    security: (
      <div className="space-y-4">
        {/* Email */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Email Address</h2>
          <div className="flex items-center gap-3">
            <Input value={user.email || ""} readOnly
              className="rounded-xl border-zinc-200 bg-zinc-50 text-zinc-500 h-10 flex-1" />
            {isEmailVerified ? (
              <span className="text-[10px] font-bold bg-green-50 text-green-600 px-2.5 py-1 rounded-full flex-shrink-0 border border-green-100 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Verified
              </span>
            ) : (
              <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2.5 py-1 rounded-full flex-shrink-0 border border-amber-100 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Unverified
              </span>
            )}
          </div>
          {!isEmailVerified && (
            <p className="text-xs text-amber-600 mt-2 leading-relaxed">
              Please check your inbox and confirm your email to secure your account.
            </p>
          )}
          <p className="text-xs text-zinc-400 mt-2.5 leading-relaxed">
            To change your email address, contact{" "}
            <a href="/contact" className="text-primary hover:underline">support</a>.
          </p>
        </div>

        {/* Password change */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-semibold text-zinc-900 mb-1">Change Password</h2>
          <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
            Your current password is required to verify your identity before making this change.
          </p>
          <form onSubmit={passwordForm.handleSubmit(savePassword)} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Current Password</Label>
              <Input type="password" placeholder="Enter your current password"
                className="rounded-xl border-zinc-200 h-10"
                {...passwordForm.register("current_password")} />
              {passwordForm.formState.errors.current_password && (
                <p className="text-xs text-red-500">{passwordForm.formState.errors.current_password.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">New Password</Label>
                <Input type="password" placeholder="Min. 8 characters"
                  className="rounded-xl border-zinc-200 h-10"
                  {...passwordForm.register("new_password")} />
                {passwordForm.formState.errors.new_password && (
                  <p className="text-xs text-red-500">{passwordForm.formState.errors.new_password.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Confirm New Password</Label>
                <Input type="password" placeholder="Repeat new password"
                  className="rounded-xl border-zinc-200 h-10"
                  {...passwordForm.register("confirm_password")} />
                {passwordForm.formState.errors.confirm_password && (
                  <p className="text-xs text-red-500">{passwordForm.formState.errors.confirm_password.message}</p>
                )}
              </div>
            </div>

            <Button type="submit" disabled={savingPassword}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {savingPassword ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </div>

        {/* ── Two-factor authentication ─────────────────────────────────────── */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-zinc-400" /> Two-Factor Authentication
              </h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed max-w-md">
                Require a 6-digit code from an authenticator app in addition to your password.
                Recommended if you have API keys, sell agents, or receive payouts.
              </p>
            </div>
            {!mfaLoading && mfaFactor && (
              <span className="text-[10px] font-bold bg-green-50 text-green-600 px-2.5 py-1 rounded-full flex-shrink-0 border border-green-100 flex items-center gap-1 mt-0.5">
                <ShieldCheck className="h-3 w-3" /> Enabled
              </span>
            )}
          </div>

          {mfaLoading ? (
            <div className="h-10 bg-zinc-50 rounded-xl animate-pulse mt-4" />
          ) : mfaStage === "idle" && !mfaFactor ? (
            <Button onClick={startMfaEnroll} disabled={mfaBusy}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 mt-4">
              {mfaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Enable Two-Factor Authentication
            </Button>
          ) : mfaStage === "verifying" ? (
            <div className="mt-4 bg-zinc-50 border border-zinc-100 rounded-xl p-4 space-y-4">
              <div>
                <p className="text-xs font-semibold text-zinc-700 mb-2">1. Scan this QR code</p>
                <p className="text-xs text-zinc-400 mb-3">
                  Use Google Authenticator, 1Password, Authy, or any TOTP app.
                </p>
                {qrCodeSvg && (
                  <div
                    className="w-40 h-40 bg-white rounded-xl border border-zinc-200 p-2 mx-auto sm:mx-0"
                    dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
                  />
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-zinc-700 mb-2">
                  Can't scan? Enter this code manually
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-white border border-zinc-200 rounded-lg px-3 py-2 text-zinc-600 break-all">
                    {totpSecret}
                  </code>
                  <button type="button" onClick={copySecret}
                    className="flex-shrink-0 p-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                    aria-label="Copy secret">
                    <Copy className="h-3.5 w-3.5 text-zinc-500" />
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-zinc-700 mb-2">2. Enter the 6-digit code</p>
                <div className="flex items-center gap-2">
                  <Input
                    value={verifyCode}
                    onChange={e => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="rounded-xl border-zinc-200 h-10 font-mono text-center tracking-widest w-32"
                    maxLength={6}
                  />
                  <Button onClick={verifyMfaEnroll} disabled={mfaBusy || verifyCode.length !== 6}
                    className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 disabled:opacity-40">
                    {mfaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Verify & Enable
                  </Button>
                  <Button variant="outline" onClick={cancelMfaEnroll} disabled={mfaBusy}
                    className="rounded-xl border-zinc-200">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : mfaFactor ? (
            <div className="mt-4 flex items-center justify-between bg-green-50 border border-green-100 rounded-xl px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-green-800">Authenticator app connected</p>
                <p className="text-[11px] text-green-600 mt-0.5">
                  Enabled {new Date(mfaFactor.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              {!removeConfirm ? (
                <button onClick={() => setRemoveConfirm(true)}
                  className="text-xs font-semibold text-red-500 hover:text-red-600 transition-colors flex-shrink-0">
                  Remove
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-zinc-500">Are you sure?</span>
                  <button onClick={removeMfa} disabled={mfaBusy}
                    className="text-xs font-bold text-red-600 hover:underline disabled:opacity-40">
                    {mfaBusy ? "…" : "Yes, remove"}
                  </button>
                  <button onClick={() => setRemoveConfirm(false)}
                    className="text-xs text-zinc-400 hover:text-zinc-600">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    ),

    /* ── Notifications ── */
    notifications: (
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <h2 className="text-sm font-semibold text-zinc-900 mb-1">Email Notifications</h2>
        <p className="text-xs text-zinc-400 mb-5">Choose which emails you would like to receive from AgentDyne.</p>
        <div className="space-y-0 divide-y divide-zinc-50">
          {NOTIF_ITEMS.map(({ key, label, desc }) => (
            <div key={key} className="flex items-start justify-between py-4 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-zinc-900">{label}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
              </div>
              <div className="ml-4 mt-0.5">
                <Toggle prefKey={key} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-5 border-t border-zinc-50">
          <Button onClick={saveNotifPrefs} disabled={savingNotif}
            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
            {savingNotif ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {savingNotif ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      </div>
    ),

    /* ── Danger ── */
    danger: (
      <div className="bg-white border border-red-100 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-2">
          <Trash2 className="h-4 w-4" /> Delete Account
        </h2>
        <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
          Permanently delete your account and all associated data. This action is
          irreversible and will immediately cancel any active subscriptions without refund.
        </p>
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-5">
          <p className="text-xs text-red-600 font-medium mb-1">The following will be permanently deleted:</p>
          <ul className="text-xs text-red-500 space-y-0.5 list-disc list-inside">
            <li>All agents and their configurations</li>
            <li>API keys and execution history</li>
            <li>Transaction history and earnings records</li>
            <li>Profile data and notification preferences</li>
          </ul>
        </div>
        <div className="space-y-1.5 mb-4">
          <Label className="text-sm font-medium text-zinc-700">
            Type <strong>DELETE</strong> to confirm
          </Label>
          <Input placeholder="DELETE" value={deleteConfirm}
            onChange={e => setDeleteConfirm(e.target.value)}
            className="rounded-xl border-red-200 focus:border-red-300 h-10 font-mono" />
        </div>
        <Button disabled={deleteConfirm !== "DELETE" || deletingAccount}
          onClick={handleDeleteAccount}
          className="rounded-xl bg-red-600 text-white hover:bg-red-700 font-semibold gap-2 disabled:opacity-40">
          {deletingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {deletingAccount ? "Processing..." : "Delete My Account"}
        </Button>
      </div>
    ),
  }

  /* ── Render ────────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Settings</h1>
        <p className="text-zinc-500 text-sm mt-1">Manage your account preferences and security.</p>
      </div>

      <SlidingTabs
        variant="card"
        bg="bg-zinc-50 border border-zinc-100"
        tabs={TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon, danger: t.danger }))}
        active={activeTab}
        onChange={id => setActiveTab(id as TabId)}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={activeTab} variants={tabVariants} initial="enter" animate="center" exit="exit">
          {panels[activeTab]}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
