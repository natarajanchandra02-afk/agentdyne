"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Bot, Loader2, ArrowRight, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { createClient } from "@/lib/supabase/client";
import { slugify, CATEGORY_ICONS, categoryLabel } from "@/lib/utils";
import toast from "react-hot-toast";

const CATEGORIES = ["productivity","coding","marketing","finance","legal","customer_support","data_analysis","content","research","hr","sales","devops","security","other"];

const schema = z.object({
  name: z.string().min(3).max(60),
  description: z.string().min(20).max(300),
  category: z.string(),
  pricing_model: z.enum(["free","per_call","subscription","freemium"]),
  price_per_call: z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  system_prompt: z.string().min(20, "System prompt must be at least 20 characters"),
  model_name: z.string(),
  temperature: z.coerce.number().min(0).max(2),
  max_tokens: z.coerce.number().min(100).max(32000),
});

type FormData = z.infer<typeof schema>;

export default function BuilderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      pricing_model: "free",
      model_name: "claude-sonnet-4-20250514",
      temperature: 0.7,
      max_tokens: 4096,
    },
  });

  const pricingModel = watch("pricing_model");

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: agent, error } = await supabase.from("agents").insert({
        ...data,
        seller_id: user.id,
        slug: slugify(data.name) + "-" + Math.random().toString(36).slice(2, 7),
        status: "draft",
      }).select().single();

      if (error) throw error;
      toast.success("Agent created!");
      router.push(`/builder/${agent.id}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Create New Agent</h1>
                <p className="text-sm text-muted-foreground">Build and publish your AI microagent</p>
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Basic Info */}
              <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                <h2 className="font-semibold text-white flex items-center gap-2"><Wand2 className="h-4 w-4 text-indigo-400" />Basic Information</h2>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-1.5">
                    <Label>Agent Name *</Label>
                    <Input placeholder="e.g. Email Summarizer Pro" {...register("name")} />
                    {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Description *</Label>
                    <Textarea placeholder="Describe what your agent does, who it's for, and what makes it unique..." rows={3} {...register("description")} />
                    {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category *</Label>
                    <Select onValueChange={v => setValue("category", v)}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => (
                          <SelectItem key={c} value={c}>{CATEGORY_ICONS[c]} {categoryLabel(c)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>AI Model *</Label>
                    <Select defaultValue="claude-sonnet-4-20250514" onValueChange={v => setValue("model_name", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="claude-opus-4-6">Claude Opus 4.6 (Powerful)</SelectItem>
                        <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4 (Balanced)</SelectItem>
                        <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fast)</SelectItem>
                        <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                        <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                        <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* System Prompt */}
              <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                <h2 className="font-semibold text-white">System Prompt *</h2>
                <Textarea
                  placeholder="You are an expert email analyst. When given an email thread, you will:
1. Summarize the key points concisely
2. Identify action items for the recipient
3. Highlight any urgent requests
4. Flag any concerns or ambiguities

Always be professional and concise. Format output as structured JSON."
                  rows={8}
                  className="font-mono text-sm"
                  {...register("system_prompt")}
                />
                {errors.system_prompt && <p className="text-xs text-destructive">{errors.system_prompt.message}</p>}
              </div>

              {/* Model Settings */}
              <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                <h2 className="font-semibold text-white">Model Parameters</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Temperature (0-2)</Label>
                    <Input type="number" step="0.1" min="0" max="2" {...register("temperature")} />
                    <p className="text-xs text-muted-foreground">Lower = more precise, Higher = more creative</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max Tokens</Label>
                    <Input type="number" min="100" max="32000" {...register("max_tokens")} />
                  </div>
                </div>
              </div>

              {/* Pricing */}
              <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                <h2 className="font-semibold text-white">Pricing Model</h2>
                <div className="grid grid-cols-2 gap-3">
                  {(["free","per_call","subscription","freemium"] as const).map(p => (
                    <button key={p} type="button" onClick={() => setValue("pricing_model", p)}
                      className={`p-3 rounded-lg border text-sm font-medium text-left transition-all ${pricingModel === p ? "border-indigo-500 bg-indigo-500/10 text-indigo-400" : "border-border text-muted-foreground hover:border-indigo-500/30"}`}>
                      <div className="font-semibold capitalize">{p.replace("_"," ")}</div>
                      <div className="text-xs mt-0.5 font-normal opacity-70">
                        {p === "free" && "No cost to users"}
                        {p === "per_call" && "Charge per execution"}
                        {p === "subscription" && "Monthly recurring"}
                        {p === "freemium" && "Free tier + paid"}
                      </div>
                    </button>
                  ))}
                </div>

                {(pricingModel === "per_call" || pricingModel === "freemium") && (
                  <div className="space-y-1.5">
                    <Label>Price per Call (USD)</Label>
                    <Input type="number" step="0.001" min="0" placeholder="0.010" {...register("price_per_call")} />
                  </div>
                )}
                {pricingModel === "subscription" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Monthly Price (USD)</Label>
                      <Input type="number" step="0.01" min="0" placeholder="9.99" {...register("subscription_price_monthly")} />
                    </div>
                  </div>
                )}
              </div>

              <Button type="submit" size="lg" className="w-full bg-gradient-brand text-white border-0" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                {loading ? "Creating..." : "Create Agent & Continue to Editor"}
              </Button>
            </form>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
