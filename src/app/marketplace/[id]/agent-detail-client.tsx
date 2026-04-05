"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Star, Zap, CheckCircle, Play, Code2, BookOpen, MessageSquare, Tag, Globe, Clock, TrendingUp, ArrowLeft, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { formatNumber, formatCurrency, formatDate, getInitials, categoryLabel, CATEGORY_ICONS } from "@/lib/utils";
import toast from "react-hot-toast";
import Link from "next/link";

interface Props {
  agent: any;
  reviews: any[];
  user: any;
  userSubscription: any;
}

export function AgentDetailClient({ agent, reviews, user, userSubscription }: Props) {
  const router = useRouter();
  const [testInput, setTestInput] = useState(agent.example_inputs?.[0] ? JSON.stringify(agent.example_inputs[0], null, 2) : '{"input": "Hello!"}');
  const [testOutput, setTestOutput] = useState("");
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const seller = agent.profiles;

  const handleTest = async () => {
    if (!user) { router.push("/login"); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, input: JSON.parse(testInput) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestOutput(JSON.stringify(data.output, null, 2));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(`const res = await fetch("https://api.agentdyne.com/v1/agents/${agent.id}/execute", {
  method: "POST",
  headers: { "Authorization": "Bearer YOUR_API_KEY", "Content-Type": "application/json" },
  body: JSON.stringify({ input: ${testInput} })
});
const data = await res.json();`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/marketplace">
            <Button variant="ghost" size="sm" className="mb-6 text-muted-foreground">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Marketplace
            </Button>
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Header */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-brand/20 border border-border flex items-center justify-center text-3xl flex-shrink-0">
                    {CATEGORY_ICONS[agent.category]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
                      {agent.is_verified && <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>}
                      {agent.is_featured && <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">⭐ Featured</Badge>}
                    </div>
                    <p className="text-muted-foreground mt-1">{agent.description}</p>
                    <div className="flex items-center gap-4 mt-3 flex-wrap">
                      <div className="flex items-center gap-1 text-sm">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-semibold text-white">{agent.average_rating?.toFixed(1) || "—"}</span>
                        <span className="text-muted-foreground">({formatNumber(agent.total_reviews)} reviews)</span>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Zap className="h-4 w-4" />{formatNumber(agent.total_executions)} executions
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />~{agent.average_latency_ms}ms avg
                      </div>
                      <Badge variant="outline">{CATEGORY_ICONS[agent.category]} {categoryLabel(agent.category)}</Badge>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Tabs */}
              <Tabs defaultValue="playground">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="playground"><Play className="h-3.5 w-3.5 mr-1.5" />Playground</TabsTrigger>
                  <TabsTrigger value="docs"><BookOpen className="h-3.5 w-3.5 mr-1.5" />Docs</TabsTrigger>
                  <TabsTrigger value="api"><Code2 className="h-3.5 w-3.5 mr-1.5" />API</TabsTrigger>
                  <TabsTrigger value="reviews"><MessageSquare className="h-3.5 w-3.5 mr-1.5" />Reviews</TabsTrigger>
                </TabsList>

                {/* Playground */}
                <TabsContent value="playground" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-white">Input (JSON)</label>
                      <Textarea value={testInput} onChange={e => setTestInput(e.target.value)}
                        className="font-mono text-xs h-48 resize-none" placeholder='{"input": "your message"}' />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-white">Output</label>
                      <div className="h-48 rounded-lg border border-border bg-muted/20 p-3 font-mono text-xs overflow-auto whitespace-pre-wrap text-muted-foreground">
                        {testing ? "Running..." : testOutput || "Output will appear here..."}
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleTest} disabled={testing} className="bg-gradient-brand text-white border-0">
                    <Play className="h-4 w-4 mr-2" />{testing ? "Running..." : "Run Agent"}
                  </Button>
                  {!user && <p className="text-xs text-muted-foreground">Sign in to test this agent</p>}
                </TabsContent>

                {/* Docs */}
                <TabsContent value="docs">
                  <div className="prose prose-invert max-w-none text-sm">
                    {agent.documentation
                      ? <div dangerouslySetInnerHTML={{ __html: agent.documentation }} />
                      : <p className="text-muted-foreground">No documentation provided.</p>
                    }
                  </div>
                </TabsContent>

                {/* API */}
                <TabsContent value="api" className="space-y-4">
                  <div className="bg-muted/20 rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-white">Quick Integration</span>
                      <Button variant="ghost" size="sm" onClick={copySnippet} className="text-xs">
                        {copied ? <><Check className="h-3 w-3 mr-1" />Copied</> : <><Copy className="h-3 w-3 mr-1" />Copy</>}
                      </Button>
                    </div>
                    <pre className="text-xs text-muted-foreground overflow-auto">{`const res = await fetch("https://api.agentdyne.com/v1/agents/${agent.id}/execute", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ input: ${testInput} })
});
const data = await res.json();`}</pre>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-card border border-border rounded-lg p-4">
                      <h4 className="font-medium text-white mb-2">Input Schema</h4>
                      <pre className="text-xs text-muted-foreground">{JSON.stringify(agent.input_schema, null, 2) || "{}"}</pre>
                    </div>
                    <div className="bg-card border border-border rounded-lg p-4">
                      <h4 className="font-medium text-white mb-2">Output Schema</h4>
                      <pre className="text-xs text-muted-foreground">{JSON.stringify(agent.output_schema, null, 2) || "{}"}</pre>
                    </div>
                  </div>
                </TabsContent>

                {/* Reviews */}
                <TabsContent value="reviews" className="space-y-4">
                  {reviews.length === 0
                    ? <p className="text-muted-foreground text-sm">No reviews yet. Be the first!</p>
                    : reviews.map(r => (
                        <div key={r.id} className="bg-card border border-border rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={r.profiles?.avatar_url} />
                              <AvatarFallback className="text-xs bg-indigo-600">{getInitials(r.profiles?.full_name || "A")}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-white">{r.profiles?.full_name || "Anonymous"}</span>
                                <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>
                              </div>
                              <div className="flex gap-0.5 my-1">{Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />)}</div>
                              {r.title && <p className="text-sm font-medium text-white mb-1">{r.title}</p>}
                              <p className="text-sm text-muted-foreground">{r.body}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                </TabsContent>
              </Tabs>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Pricing Card */}
              <div className="bg-card border border-border rounded-xl p-5 sticky top-20">
                <div className="text-center mb-4">
                  {agent.pricing_model === "free" && <div className="text-3xl font-black text-white">Free</div>}
                  {agent.pricing_model === "per_call" && <><div className="text-3xl font-black text-white">{formatCurrency(agent.price_per_call)}</div><div className="text-sm text-muted-foreground">per call</div></>}
                  {agent.pricing_model === "subscription" && <><div className="text-3xl font-black text-white">{formatCurrency(agent.subscription_price_monthly)}</div><div className="text-sm text-muted-foreground">/month</div></>}
                  {agent.pricing_model === "freemium" && <><div className="text-3xl font-black text-white">Free</div><div className="text-xs text-muted-foreground">then {formatCurrency(agent.price_per_call)}/call</div></>}
                </div>
                {userSubscription?.status === "active" ? (
                  <Button className="w-full" variant="outline" onClick={handleTest}>
                    <Play className="h-4 w-4 mr-2" /> Run Agent
                  </Button>
                ) : (
                  <Button className="w-full bg-gradient-brand text-white border-0" onClick={() => user ? null : router.push("/signup")}>
                    {user ? <><Play className="h-4 w-4 mr-2" />Get Started</> : "Sign up to use"}
                  </Button>
                )}
                {agent.free_calls_per_month > 0 && (
                  <p className="text-center text-xs text-muted-foreground mt-2">{agent.free_calls_per_month} free calls/month included</p>
                )}

                <div className="mt-5 space-y-2.5 text-sm">
                  {[
                    { icon: Globe, label: "Provider", value: agent.model_provider },
                    { icon: Zap, label: "Model", value: agent.model_name?.replace("claude-", "Claude ") },
                    { icon: Clock, label: "Avg latency", value: `~${agent.average_latency_ms}ms` },
                    { icon: TrendingUp, label: "Success rate", value: agent.total_executions > 0 ? `${Math.round((agent.successful_executions / agent.total_executions) * 100)}%` : "—" },
                    { icon: Tag, label: "Version", value: agent.version },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-muted-foreground"><item.icon className="h-3.5 w-3.5" />{item.label}</div>
                      <span className="text-white font-medium text-xs">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Seller Card */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-medium text-white mb-3">About the Builder</h3>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={seller?.avatar_url} />
                    <AvatarFallback className="bg-indigo-600">{getInitials(seller?.full_name || "A")}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-white text-sm">{seller?.full_name}</span>
                      {seller?.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-400" />}
                    </div>
                    <span className="text-xs text-muted-foreground">{formatNumber(seller?.total_earned || 0)} earned</span>
                  </div>
                </div>
                {seller?.bio && <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{seller.bio}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
