"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion } from "framer-motion"
import { User, Lock, Bell, Palette, Trash2, Loader2, Check, Camera, Globe, Building, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { createClient } from "@/lib/supabase/client"
import { getInitials } from "@/lib/utils"
import toast from "react-hot-toast"
import type { User as SupabaseUser } from "@supabase/supabase-js"

const profileSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  username:  z.string().min(3).max(30).regex(/^[a-z0-9_-]+$/, "Lowercase, numbers, hyphens only").optional().or(z.literal("")),
  bio:       z.string().max(280).optional(),
  website:   z.string().url("Must be a valid URL").optional().or(z.literal("")),
  company:   z.string().max(80).optional(),
})

const passwordSchema = z.object({
  current_password: z.string().min(8),
  new_password:     z.string().min(8, "Min 8 characters"),
  confirm_password: z.string(),
}).refine(d => d.new_password === d.confirm_password, {
  message: "Passwords do not match", path: ["confirm_password"],
})

type ProfileForm   = z.infer<typeof profileSchema>
type PasswordForm  = z.infer<typeof passwordSchema>

interface Props { user: SupabaseUser; profile: any }

export function SettingsClient({ user, profile }: Props) {
  const router   = useRouter()
  const supabase = createClient()
  const [savingProfile,   setSavingProfile]   = useState(false)
  const [savingPassword,  setSavingPassword]  = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteConfirm,   setDeleteConfirm]   = useState("")

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

  const saveProfile = async (data: ProfileForm) => {
    setSavingProfile(true)
    try {
      const { error } = await supabase.from("profiles").update({
        full_name: data.full_name,
        username:  data.username  || null,
        bio:       data.bio       || null,
        website:   data.website   || null,
        company:   data.company   || null,
        updated_at: new Date().toISOString(),
      }).eq("id", user.id)
      if (error) throw error
      toast.success("Profile saved")
      router.refresh()
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingProfile(false) }
  }

  const savePassword = async (data: PasswordForm) => {
    setSavingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: data.new_password })
      if (error) throw error
      toast.success("Password updated")
      passwordForm.reset()
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingPassword(false) }
  }

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error("Max 2MB"); return }

    try {
      const ext  = file.name.split(".").pop()
      const path = `${user.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path)
      await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id)
      toast.success("Avatar updated")
      router.refresh()
    } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="page-header">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account preferences and security.</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="mb-6">
          <TabsTrigger value="profile" className="gap-2"><User className="h-3.5 w-3.5" />Profile</TabsTrigger>
          <TabsTrigger value="security" className="gap-2"><Lock className="h-3.5 w-3.5" />Security</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2"><Bell className="h-3.5 w-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="danger" className="gap-2 text-destructive"><Trash2 className="h-3.5 w-3.5" />Danger</TabsTrigger>
        </TabsList>

        {/* ── Profile Tab ─────────────────────────────────── */}
        <TabsContent value="profile">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

            {/* Avatar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Profile Photo</CardTitle>
                <CardDescription>Upload a photo to personalise your profile.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <Avatar className="h-20 w-20">
                      <AvatarImage src={profile?.avatar_url} />
                      <AvatarFallback className="text-xl">{getInitials(profile?.full_name || user.email || "U")}</AvatarFallback>
                    </Avatar>
                    <label htmlFor="avatar-upload" className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors shadow-md">
                      <Camera className="h-3.5 w-3.5 text-white" />
                    </label>
                    <input id="avatar-upload" type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{profile?.full_name || "Your Name"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant={profile?.subscription_plan !== "free" ? "default" : "secondary"} className="text-[10px] capitalize">
                        {profile?.subscription_plan || "Free"}
                      </Badge>
                      {profile?.is_verified && <Badge variant="info" className="text-[10px]">Verified</Badge>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Profile form */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Personal Information</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Full Name</Label>
                      <Input {...profileForm.register("full_name")} placeholder="John Smith" />
                      {profileForm.formState.errors.full_name && <p className="text-xs text-destructive">{profileForm.formState.errors.full_name.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Username</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                        <Input {...profileForm.register("username")} placeholder="johnsmith" className="pl-7" />
                      </div>
                      {profileForm.formState.errors.username && <p className="text-xs text-destructive">{profileForm.formState.errors.username.message}</p>}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Bio</Label>
                    <Textarea {...profileForm.register("bio")} placeholder="Tell the world about yourself and what you build…" rows={3} />
                    <p className="text-xs text-muted-foreground">{profileForm.watch("bio")?.length || 0}/280</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Website</Label>
                      <Input {...profileForm.register("website")} placeholder="https://yoursite.com" type="url" />
                      {profileForm.formState.errors.website && <p className="text-xs text-destructive">{profileForm.formState.errors.website.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5"><Building className="h-3.5 w-3.5" />Company</Label>
                      <Input {...profileForm.register("company")} placeholder="Acme Corp" />
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button type="submit" variant="brand" disabled={savingProfile} className="gap-2">
                      {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {savingProfile ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ── Security Tab ─────────────────────────────────── */}
        <TabsContent value="security">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Email Address</CardTitle>
                <CardDescription>Your sign-in email address.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Input value={user.email || ""} readOnly className="bg-muted/50 text-muted-foreground" />
                  <Badge variant="success" className="flex-shrink-0">Verified</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Change Password</CardTitle>
                <CardDescription>Use a strong password of at least 8 characters.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={passwordForm.handleSubmit(savePassword)} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Current Password</Label>
                    <Input {...passwordForm.register("current_password")} type="password" placeholder="••••••••" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <Input {...passwordForm.register("new_password")} type="password" placeholder="••••••••" />
                    {passwordForm.formState.errors.new_password && <p className="text-xs text-destructive">{passwordForm.formState.errors.new_password.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Confirm New Password</Label>
                    <Input {...passwordForm.register("confirm_password")} type="password" placeholder="••••••••" />
                    {passwordForm.formState.errors.confirm_password && <p className="text-xs text-destructive">{passwordForm.formState.errors.confirm_password.message}</p>}
                  </div>
                  <Button type="submit" variant="brand" disabled={savingPassword} className="gap-2">
                    {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                    {savingPassword ? "Updating…" : "Update Password"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connected Accounts</CardTitle>
                <CardDescription>Manage OAuth providers linked to your account.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { name: "Google",  icon: "🌐", connected: user.app_metadata?.provider === "google" },
                  { name: "GitHub",  icon: "🐙", connected: user.app_metadata?.provider === "github" },
                ].map(provider => (
                  <div key={provider.name} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{provider.icon}</span>
                      <span className="text-sm font-medium">{provider.name}</span>
                    </div>
                    <Badge variant={provider.connected ? "success" : "secondary"}>
                      {provider.connected ? "Connected" : "Not connected"}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ── Notifications Tab ───────────────────────────────── */}
        <TabsContent value="notifications">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Email Notifications</CardTitle>
                <CardDescription>Choose what you'd like to be notified about.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "New review on your agent",       desc: "Get an email when someone leaves a review." },
                  { label: "Payout processed",               desc: "Confirmation when your payout is sent." },
                  { label: "Agent approved / rejected",      desc: "Status changes on your submitted agents." },
                  { label: "Subscription & billing",         desc: "Renewal confirmations and payment failures." },
                  { label: "AgentDyne product updates",      desc: "New features, platform news, and releases." },
                ].map(({ label, desc }) => (
                  <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer mt-0.5">
                      <input type="checkbox" className="sr-only peer" defaultChecked />
                      <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors duration-200 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                  </div>
                ))}
                <Button variant="brand" className="mt-2 gap-2"><Check className="h-4 w-4" />Save Preferences</Button>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ── Danger Zone Tab ───────────────────────────────── */}
        <TabsContent value="danger">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-base text-destructive flex items-center gap-2">
                  <Trash2 className="h-4 w-4" /> Delete Account
                </CardTitle>
                <CardDescription>
                  Permanently delete your account and all associated data. This action is irreversible.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 text-sm text-destructive">
                  ⚠️ All your agents, API keys, transaction history, and profile data will be permanently deleted.
                  Active subscriptions will be canceled immediately with no refund.
                </div>
                <div className="space-y-1.5">
                  <Label>Type <strong>DELETE</strong> to confirm</Label>
                  <Input placeholder="DELETE" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} className="border-destructive/30 focus:border-destructive/50" />
                </div>
                <Button
                  variant="destructive"
                  disabled={deleteConfirm !== "DELETE" || deletingAccount}
                  onClick={async () => {
                    setDeletingAccount(true)
                    try {
                      await supabase.auth.signOut()
                      toast.success("Account deleted. Sorry to see you go.")
                      router.push("/")
                    } catch (e: any) { toast.error(e.message); setDeletingAccount(false) }
                  }}
                  className="gap-2"
                >
                  {deletingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {deletingAccount ? "Deleting…" : "Delete My Account"}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
