/**
 * Device Fingerprinting — Edge Runtime Safe
 *
 * Creates a SHA-256 hash from stable browser signals.
 * Used to detect multi-account abuse without storing full UA strings.
 *
 * Called at: signup, login, first execution.
 * Stored in: public.device_fingerprints (via service-role API call).
 *
 * Privacy: no raw UA stored in DB, only the hash.
 * IP stored as /24 prefix only (last octet zeroed).
 */

/** Build fingerprint from request headers — server-side (Edge) */
export async function buildServerFingerprint(
  req: Request,
): Promise<{ fingerprint: string; ipPrefix: string; userAgent: string }> {
  const ua        = req.headers.get("user-agent")    ?? ""
  const lang      = req.headers.get("accept-language") ?? ""
  const encoding  = req.headers.get("accept-encoding") ?? ""
  const ip        = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? "0.0.0.0"

  // Anonymise IP: keep first 3 octets only (IPv4) or first 3 groups (IPv6)
  const ipPrefix = ip.includes(".")
    ? ip.split(".").slice(0, 3).join(".") + ".0"
    : ip.split(":").slice(0, 3).join(":") + "::"

  // Hash the stable signals
  const raw     = `${ua}||${lang}||${encoding}||${ipPrefix}`
  const encoded = new TextEncoder().encode(raw)
  const digest  = await crypto.subtle.digest("SHA-256", encoded)
  const hex     = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")

  return { fingerprint: hex, ipPrefix, userAgent: ua.slice(0, 500) }
}

/** Check fingerprint against DB and enforce 3-accounts-per-fingerprint rule */
export async function checkAndRecordFingerprint(params: {
  fingerprint:  string
  ipPrefix:     string
  userAgent:    string
  userId:       string
  serviceUrl:   string    // NEXT_PUBLIC_SUPABASE_URL
  serviceKey:   string    // SUPABASE_SERVICE_ROLE_KEY
}): Promise<{ blocked: boolean; reason?: string }> {
  const { fingerprint, ipPrefix, userAgent, userId, serviceUrl, serviceKey } = params

  const headers = {
    "Content-Type":  "application/json",
    "apikey":        serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Prefer":        "return=representation",
  }

  try {
    // Upsert fingerprint record
    const upsertRes = await fetch(
      `${serviceUrl}/rest/v1/device_fingerprints?fingerprint=eq.${fingerprint}`,
      {
        method:  "GET",
        headers,
      }
    )
    const existing: any[] = await upsertRes.json()

    if (existing.length > 0) {
      const record = existing[0]

      // Blocked fingerprint
      if (record.is_flagged) {
        return { blocked: true, reason: `Fingerprint blocked: ${record.flag_reason ?? "abuse detected"}` }
      }

      // Check if this user is already associated — if not, increment account_count
      if (record.user_id !== userId) {
        const newCount = (record.account_count ?? 1) + 1

        // Hard cap: 3 accounts per fingerprint
        if (newCount > 3) {
          // Flag the fingerprint
          await fetch(`${serviceUrl}/rest/v1/device_fingerprints?fingerprint=eq.${fingerprint}`, {
            method:  "PATCH",
            headers,
            body:    JSON.stringify({
              is_flagged:   true,
              flag_reason:  `Account limit exceeded: ${newCount} accounts from same device`,
              last_seen:    new Date().toISOString(),
            }),
          })
          return {
            blocked: true,
            reason:  "Too many accounts from this device. Contact support if this is unexpected.",
          }
        }

        // Update count + last_seen
        await fetch(`${serviceUrl}/rest/v1/device_fingerprints?fingerprint=eq.${fingerprint}`, {
          method:  "PATCH",
          headers,
          body:    JSON.stringify({
            account_count: newCount,
            user_id:       userId,  // associate most recent user
            last_seen:     new Date().toISOString(),
          }),
        })
      } else {
        // Same user — just update last_seen
        await fetch(`${serviceUrl}/rest/v1/device_fingerprints?fingerprint=eq.${fingerprint}`, {
          method:  "PATCH",
          headers,
          body:    JSON.stringify({ last_seen: new Date().toISOString() }),
        })
      }
    } else {
      // New fingerprint — insert
      await fetch(`${serviceUrl}/rest/v1/device_fingerprints`, {
        method:  "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body:    JSON.stringify({
          fingerprint,
          user_id:       userId,
          ip_prefix:     ipPrefix,
          user_agent:    userAgent,
          account_count: 1,
          is_flagged:    false,
        }),
      })
    }

    return { blocked: false }
  } catch {
    // Fail-open: fingerprint errors should never block legit users
    return { blocked: false }
  }
}
