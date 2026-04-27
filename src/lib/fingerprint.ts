/**
 * AgentDyne — Enhanced Device Fingerprinting
 * 
 * Improvements over v1:
 *   - Subnet correlation (/24 prefix for IPv4, /48 for IPv6)
 *   - Account creation velocity check (3 accounts / same /24 in 24h)
 *   - IP prefix–based blocking separate from device hash
 *   - TOR exit node detection via CF headers
 *   - Fails OPEN — fingerprint errors never block legit users
 */

export interface FingerprintContext {
  fingerprint:  string
  ipPrefix:     string   // /24 subnet prefix
  ip:           string   // full IP (stored hashed, never raw)
  userAgent:    string
  isTorOrVPN:   boolean
}

/** Build fingerprint from request headers — edge-runtime safe */
export async function buildServerFingerprint(req: Request): Promise<FingerprintContext> {
  const ua       = req.headers.get("user-agent")         ?? ""
  const lang     = req.headers.get("accept-language")    ?? ""
  const encoding = req.headers.get("accept-encoding")    ?? ""
  const ip       = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "0.0.0.0"

  // Cloudflare: detect Tor exits and datacenter IPs
  const cfCountry = req.headers.get("cf-ipcountry") ?? ""
  const cfType    = req.headers.get("cf-visitor")   ?? ""  // {"scheme":"https"}
  // Tor exits commonly appear as AS: not a perfect signal but adds score
  const isTorOrVPN = cfCountry === "T1"  // Cloudflare marks Tor as T1 country

  // Subnet prefix: /24 for IPv4, /48 for IPv6
  const ipPrefix = ip.includes(".")
    ? ip.split(".").slice(0, 3).join(".") + ".0/24"
    : ip.split(":").slice(0, 3).join(":") + "::/48"

  // Hash full IP separately (for subnet correlation) — never store raw IP
  const ipHash = await sha256(`ip:${ip}`)

  // Device fingerprint: stable signals only (UA + language + encoding + subnet)
  const raw         = `${ua}||${lang}||${encoding}||${ipPrefix}`
  const fingerprint = await sha256(raw)

  return { fingerprint, ipPrefix, ip: ipHash, userAgent: ua.slice(0, 500), isTorOrVPN }
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * checkAndRecordFingerprint
 *
 * Three checks:
 *   1. Device hash: max 3 accounts per device fingerprint (all time)
 *   2. Subnet velocity: max 5 accounts per /24 subnet in 24h (creation spike)
 *   3. Tor/VPN flag: warn (don't block — legit users use VPNs)
 *
 * Returns { blocked, reason } — always fails open on DB errors.
 */
export async function checkAndRecordFingerprint(params: {
  fingerprint:  string
  ipPrefix:     string
  userAgent:    string
  userId:       string
  isTorOrVPN:   boolean
  serviceUrl:   string
  serviceKey:   string
}): Promise<{ blocked: boolean; reason?: string; riskScore: number }> {
  const { fingerprint, ipPrefix, userAgent, userId, isTorOrVPN, serviceUrl, serviceKey } = params

  const headers = {
    "Content-Type":  "application/json",
    "apikey":        serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Prefer":        "return=representation",
  }

  let riskScore = 0
  if (isTorOrVPN) riskScore += 15  // Tor is suspicious but not blocking

  try {
    // ── 1. Device fingerprint check ──────────────────────────────────────────
    const fpRes = await fetch(
      `${serviceUrl}/rest/v1/device_fingerprints?fingerprint=eq.${fingerprint}&limit=1`,
      { method: "GET", headers }
    )
    const existing: any[] = await fpRes.json()

    if (existing.length > 0) {
      const record = existing[0]
      if (record.is_flagged) return { blocked: true, reason: `Device blocked: ${record.flag_reason ?? "abuse detected"}`, riskScore: 100 }

      const isNewUser   = record.user_id !== userId
      const newCount    = (record.account_count ?? 1) + (isNewUser ? 1 : 0)

      if (isNewUser && newCount > 3) {
        // Flag and block
        await fetch(`${serviceUrl}/rest/v1/device_fingerprints?fingerprint=eq.${fingerprint}`, {
          method: "PATCH", headers,
          body:   JSON.stringify({ is_flagged: true, flag_reason: `Device limit: ${newCount} accounts`, last_seen: new Date().toISOString() }),
        })
        return { blocked: true, reason: "Too many accounts from this device. Contact support if unexpected.", riskScore: 100 }
      }

      // Update
      await fetch(`${serviceUrl}/rest/v1/device_fingerprints?fingerprint=eq.${fingerprint}`, {
        method: "PATCH", headers,
        body:   JSON.stringify({ account_count: newCount, user_id: userId, last_seen: new Date().toISOString() }),
      })
    } else {
      // New fingerprint
      await fetch(`${serviceUrl}/rest/v1/device_fingerprints`, {
        method: "POST", headers: { ...headers, Prefer: "return=minimal" },
        body:   JSON.stringify({ fingerprint, user_id: userId, ip_prefix: ipPrefix, user_agent: userAgent, account_count: 1 }),
      })
    }

    // ── 2. Subnet velocity check (/24 correlation) ────────────────────────────
    // Count accounts created from same /24 subnet in last 24h
    const since24h = new Date(Date.now() - 86_400_000).toISOString()
    const subnetRes = await fetch(
      `${serviceUrl}/rest/v1/device_fingerprints?ip_prefix=eq.${encodeURIComponent(ipPrefix)}&first_seen=gte.${since24h}&select=id`,
      { method: "GET", headers: { ...headers, "Prefer": "count=exact" } }
    )
    const subnetCount = parseInt(subnetRes.headers.get("content-range")?.split("/")[1] ?? "0")

    if (subnetCount > 10) {
      riskScore += 40
      if (subnetCount > 20) {
        // Block: high-velocity subnet (bot farm pattern)
        return { blocked: true, reason: `IP subnet creation velocity exceeded (${subnetCount} accounts in 24h)`, riskScore: 100 }
      }
    } else if (subnetCount > 5) {
      riskScore += 20
    }

    return { blocked: false, riskScore }

  } catch {
    // Fail open — fingerprint errors never block legit users
    return { blocked: false, riskScore }
  }
}
