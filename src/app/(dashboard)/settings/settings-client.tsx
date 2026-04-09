"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { User, Lock, Bell, Trash2, Loader2, Check, Camera, Globe, Building } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/lib/supabase/client"
import { getInitials, cn } from "@/lib/utils"
import toast from "react-hot-toast"
import type { User as SupabaseUser } from "@supabase/supabase-js"

const profileSchema = z.object({
  full_name: z.string().min(2),
  username:  z.string().min(3).max(30).regex(/^[a-z0-9_-]+$/).optional().or(z.literal("")),
  bio:       z.string().max(280).optional(),
  website:   z.string().url().optional().or(z.literal("")),
  company:   z.string().max(80).optional(),
})

const passwordSchema = z.object({
  new_password:     z.string().min(8),
  confirm_password: z.string(),
}).refine(d => d.new_password === d.confirm_password, {
  message: "Passwords do not match", path: ["confirm_password"],
})

type ProfileForm  = z.infer<typeof profileSchema>
type PasswordForm = z.infer<typeof passwordSchema>

interface Props { user: SupabaseUser; profile: any }

export function SettingsClient({ user, profile }: Props) {
  const router   = useRouter()
  const supabase = createClient()
  const [savingProfile,  setSavingProfile]  = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [deleteConfirm,  setDeleteConfirm]  = useState("")

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
        ...data, username: data.username || null, bio: data.bio || null,
        website: data.website || null, company: data.company || null,
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
    if (!file || file.size > 2 * 1024 * 1024) { toast.error("Max 2MB"); return }
    try {
      const path = `${user.id}/avatar.${file.name.split(".").pop()}`
      const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true })
      if (uploadErr) throw uploadErr
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path)
      await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id)
      toast.success("Avatar updated")
      router.refresh()
    } catch (e: any) { toast.error(e.message) }
  }

  const FIELD = ({ label, name, form, type = "text", placeholder = "" }: any) => (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-zinc-700">{label}</Label>
      <Input type={type} placeholder={placeholder} className="rounded-xl border-zinc-200 h-10"
        {...form.register(name)} />
      {form.formState.errors[name] && (
        <p className="text-xs text-red-500">{form.formState.errors[name]?.message}</p>
      )}
    </div>
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Settings</h1>
        <p className="text-zinc-500 text-sm mt-1">Manage your account preferences and security.</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="mb-6 bg-zinc-50 border border-zinc-100 p-1 rounded-xl">
          <TabsTrigger value="profile"       className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><User className="h-3.5 w-3.5" />Profile</TabsTrigger>
          <TabsTrigger value="security"      className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><Lock className="h-3.5 w-3.5" />Security</TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><Bell className="h-3.5 w-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="danger"        className="rounded-lg text-sm gap-1.5 text-red-500 data-[state=active]:bg-white data-[state=active]:shadow-sm"><Trash2 className="h-3.5 w-3.5" />Danger</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="space-y-4">
          {/* Avatar */}
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
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-zinc-900 flex items-center justify-center cursor-pointer hover:bg-zinc-700 transition-colors shadow-md">
                  <Camera className="h-3.5 w-3.5 text-white" />
                </label>
                <input id="avatar-upload" type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
              </div>
              <div>
                <p className="font-semibold text-zinc-900">{profile?.full_name || "Your Name"}</p>
                <p className="text-sm text-zinc-400 mt-0.5">{user.email}</p>
              </div>
            </div>
          </div>

          {/* Profile form */}
          <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Personal Information</h2>
            <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FIELD label="Full Name" name="full_name" form={profileForm} placeholder="John Smith" />
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-zinc-700">Username</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">@</span>
                    <Input placeholder="johnsmith" className="pl-7 rounded-xl border-zinc-200 h-10" {...profileForm.register("username")} />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Bio</Label>
                <Textarea placeholder="Tell the world about yourself…" rows={3}
                  className="rounded-xl border-zinc-200 resize-none text-sm" {...profileForm.register("bio")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FIELD label="Website" name="website" form={profileForm} placeholder="https://yoursite.com" />
                <FIELD label="Company" name="company" form={profileForm} placeholder="Acme Corp" />
              </div>
              <Button type="submit" disabled={savingProfile}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
                {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {savingProfile ? "Saving…" : "Save Changes"}
              </Button>
            </form>
          </div>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="space-y-4">
          <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Email Address</h2>
            <div className="flex items-center gap-3">
              <Input value={user.email || ""} readOnly className="rounded-xl border-zinc-200 bg-zinc-50 text-zinc-500 h-10" />
              <span className="text-[10px] font-bold bg-green-50 text-green-600 px-2.5 py-1 rounded-full flex-shrink-0">Verified</span>
            </div>
          </div>

          <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Change Password</h2>
            <form onSubmit={passwordForm.handleSubmit(savePassword)} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">New Password</Label>
                <Input type="password" placeholder="Min. 8 characters" className="rounded-xl border-zinc-200 h-10" {...passwordForm.register("new_password")} />
                {passwordForm.formState.errors.new_password && <p className="text-xs text-red-500">{passwordForm.formState.errors.new_password.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Confirm Password</Label>
                <Input type="password" placeholder="Repeat password" className="rounded-xl border-zinc-200 h-10" {...passwordForm.register("confirm_password")} />
                {passwordForm.formState.errors.confirm_password && <p className="text-xs text-red-500">{passwordForm.formState.errors.confirm_password.message}</p>}
              </div>
              <Button type="submit" disabled={savingPassword}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
                {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {savingPassword ? "Updating…" : "Update Password"}
              </Button>
            </form>
          </div>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Email Notifications</h2>
            <div className="space-y-0">
              {[
                { label: "New review on your agent",   desc: "Get notified when someone reviews your agent." },
                { label: "Payout processed",           desc: "Confirmation when your payout is sent." },
                { label: "Agent approved / rejected",  desc: "Status changes on your submitted agents." },
                { label: "Billing & subscription",     desc: "Renewal confirmations and payment failures." },
                { label: "Product updates",            desc: "New features and platform announcements." },
              ].map(({ label, desc }) => (
                <div key={label} className="flex items-start justify-between py-3.5 border-b border-zinc-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{label}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer mt-0.5 ml-4 flex-shrink-0">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-9 h-5 bg-zinc-200 rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4 shadow-inner" />
                  </label>
                </div>
              ))}
            </div>
            <Button className="mt-4 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
              <Check className="h-4 w-4" /> Save Preferences
            </Button>
          </div>
        </TabsContent>

        {/* Danger */}
        <TabsContent value="danger">
          <div className="bg-white border border-red-100 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Delete Account
            </h2>
            <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
              Permanently delete your account and all data. This cannot be undone.
              Active subscriptions will be canceled with no refund.
            </p>
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-600 mb-4">
              ⚠️ All agents, API keys, transaction history, and profile data will be permanently deleted.
            </div>
            <div className="space-y-1.5 mb-4">
              <Label className="text-sm font-medium text-zinc-700">Type <strong>DELETE</strong> to confirm</Label>
              <Input placeholder="DELETE" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                className="rounded-xl border-red-200 focus:border-red-300 h-10" />
            </div>
            <Button
              disabled={deleteConfirm !== "DELETE"}
              onClick={async () => { await supabase.auth.signOut(); router.push("/") }}
              className="rounded-xl bg-red-600 text-white hover:bg-red-700 font-semibold gap-2 disabled:opacity-40">
              <Trash2 className="h-4 w-4" /> Delete My Account
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
