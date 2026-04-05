"use client";

import { useState } from "react";
import { CheckCircle, Loader2, CreditCard, TrendingUp, Zap, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANS } from "@/lib/stripe";
import { formatCurrency, formatDate } from "@/lib/utils";
import toast from "react-hot-toast";

interface Props { profile: any; transactions: any[]; }

const PLAN_LIST = [
  { key: "free", ...PLANS.free },
  { key: "starter", ...PLANS.starter },
  { key: "pro", ...PLANS.pro },
  { key: "enterprise", ...PLANS.enterprise },
] as const;

export function BillingClient({ profile, transactions }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const currentPlan = profile?.subscription_plan || "free";

  const handleUpgrade = async (planKey: string) => {
    if (planKey === "enterprise") { window.location.href = "mailto:sales@agentdyne.com"; return; }
    if (planKey === currentPlan) return;
    setLoading(planKey);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleManage = async () => {
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Billing & Plans</h1>
          <p className="text-muted-foreground mt-1">Manage your subscription and payment history</p>
        </div>
        {currentPlan !== "free" && (
          <Button variant="outline" onClick={handleManage} disabled={loading === "portal"}>
            {loading === "portal" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
            Manage Subscription
          </Button>
        )}
      </div>

      {/* Current Plan */}
      <Card className="border-indigo-500/30 bg-indigo-500/5">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Current Plan</p>
              <p className="text-2xl font-bold text-white capitalize mt-1">{currentPlan}</p>
              {profile?.subscription_status && (
                <Badge className={`mt-2 ${profile.subscription_status === "active" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                  {profile.subscription_status}
                </Badge>
              )}
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Zap className="h-4 w-4" />
                {(profile?.executions_used_this_month || 0).toLocaleString()} / {(profile?.monthly_execution_quota || 100).toLocaleString()} calls used
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {PLAN_LIST.map((plan, i) => {
            const isCurrentPlan = plan.key === currentPlan;
            const isPopular = plan.key === "pro";
            return (
              <motion.div key={plan.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <div className={`relative rounded-xl border p-5 h-full flex flex-col ${isPopular ? "border-indigo-500 bg-indigo-500/5" : "border-border bg-card"}`}>
                  {isPopular && <div className="absolute -top-2.5 left-1/2 -translate-x-1/2"><Badge className="bg-indigo-500 text-white border-0 text-xs">Most Popular</Badge></div>}
                  <div className="mb-4">
                    <h3 className="font-bold text-white">{plan.name}</h3>
                    <div className="mt-2">
                      {plan.price === null
                        ? <span className="text-2xl font-black text-white">Custom</span>
                        : <><span className="text-2xl font-black text-white">${plan.price}</span><span className="text-muted-foreground text-sm">/mo</span></>
                      }
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{plan.calls === -1 ? "Unlimited" : `${plan.calls.toLocaleString()}`} calls/month</p>
                  </div>
                  <ul className="space-y-2 flex-1 mb-4">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <CheckCircle className="h-3.5 w-3.5 text-green-400 mt-0.5 flex-shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className={`w-full text-sm ${isPopular && !isCurrentPlan ? "bg-gradient-brand text-white border-0" : ""}`}
                    variant={isCurrentPlan ? "outline" : isPopular ? "default" : "outline"}
                    disabled={isCurrentPlan || loading === plan.key}
                    onClick={() => handleUpgrade(plan.key)}
                  >
                    {loading === plan.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                     isCurrentPlan ? "Current Plan" :
                     plan.key === "enterprise" ? "Contact Sales" :
                     <><ArrowRight className="h-3.5 w-3.5 mr-1" />Upgrade</>}
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Transaction History */}
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2"><TrendingUp className="h-4 w-4" />Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No transactions yet</p>
          ) : (
            <div className="space-y-2">
              {transactions.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-white capitalize">{tx.type.replace("_"," ")}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(tx.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">{formatCurrency(tx.amount)}</p>
                    <Badge className={`text-xs ${tx.status === "succeeded" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}`}>{tx.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
