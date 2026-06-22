-- Migration 011: Concurrency control, idempotency, credit reservation, execution cache
-- Run ONCE after migration 010. All statements are idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. IDEMPOTENCY KEYS TABLE
--    Prevents duplicate execution when client retries (network errors, etc.)
--    TTL: 24 hours. Key = SHA-256 of (user_id + agent_id + X-Idempotency-Key header).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_hash     text        NOT NULL UNIQUE,
  user_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  execution_id uuid,       -- filled after first execution completes
  response     jsonb,      -- cached response payload
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'success', 'failed')),
  created_at   timestamptz DEFAULT now(),
  expires_at   timestamptz DEFAULT (now() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_idem_hash    ON idempotency_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "idem_own" ON idempotency_keys FOR ALL USING (user_id = auth.uid());
CREATE POLICY "idem_insert" ON idempotency_keys FOR INSERT WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO authenticated, service_role;

-- Cleanup job (registered in pg_cron)
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH d AS (DELETE FROM idempotency_keys WHERE expires_at < now() RETURNING id)
  SELECT COUNT(*)::integer FROM d;
$$;
GRANT EXECUTE ON FUNCTION cleanup_expired_idempotency_keys() TO service_role;

SELECT cron.schedule('cleanup-idempotency', '0 * * * *',
  $$SELECT cleanup_expired_idempotency_keys()$$);


-- ---------------------------------------------------------------------------
-- 2. CREDIT RESERVATIONS TABLE
--    Reserve → execute → commit (or release on failure).
--    Prevents "execute then crash before deduction = free call".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_reservations (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  execution_id   uuid,
  reserved_usd   numeric(12,6) NOT NULL CHECK (reserved_usd > 0),
  status         text        NOT NULL DEFAULT 'reserved'
                             CHECK (status IN ('reserved', 'committed', 'released')),
  created_at     timestamptz DEFAULT now(),
  expires_at     timestamptz DEFAULT (now() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_res_user   ON credit_reservations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_res_exec   ON credit_reservations(execution_id);
CREATE INDEX IF NOT EXISTS idx_res_expiry ON credit_reservations(expires_at) WHERE status = 'reserved';

ALTER TABLE credit_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "res_own" ON credit_reservations FOR ALL USING (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON credit_reservations TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. RESERVE CREDITS RPC
--    Atomically reduces balance + creates reservation row.
--    Returns { success, reservation_id, new_balance } as JSONB.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reserve_credits(
  user_id_param      uuid,
  amount_param       numeric,
  execution_id_param uuid DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  current_balance numeric;
  new_balance     numeric;
  res_id          uuid;
BEGIN
  -- Release any stale reservations for this user first (fail-safe)
  UPDATE credit_reservations
  SET status = 'released'
  WHERE user_id = user_id_param
    AND status  = 'reserved'
    AND expires_at < now();

  -- Lock and check balance
  SELECT balance_usd INTO current_balance
  FROM credits WHERE user_id = user_id_param FOR UPDATE;

  IF current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credits account not found');
  END IF;

  IF current_balance < amount_param THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits',
      'balance', current_balance, 'required', amount_param);
  END IF;

  new_balance := current_balance - amount_param;

  UPDATE credits
  SET balance_usd = new_balance, updated_at = now()
  WHERE user_id = user_id_param;

  INSERT INTO credit_reservations (user_id, execution_id, reserved_usd)
  VALUES (user_id_param, execution_id_param, amount_param)
  RETURNING id INTO res_id;

  RETURN jsonb_build_object(
    'success',        true,
    'reservation_id', res_id,
    'new_balance',    new_balance,
    'reserved',       amount_param
  );
END; $$;

GRANT EXECUTE ON FUNCTION reserve_credits(uuid, numeric, uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. COMMIT CREDIT RESERVATION RPC
--    Marks reservation as committed. Called after successful execution.
--    If actual_cost < reserved, refunds the difference.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commit_credit_reservation(
  reservation_id_param uuid,
  actual_cost_param    numeric
)
RETURNS JSONB
LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  res         RECORD;
  refund_amt  numeric;
BEGIN
  SELECT * INTO res FROM credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved' FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reservation not found or already committed');
  END IF;

  -- Refund the difference if actual cost was less than reservation
  refund_amt := GREATEST(0, res.reserved_usd - actual_cost_param);

  IF refund_amt > 0 THEN
    UPDATE credits
    SET balance_usd = balance_usd + refund_amt, updated_at = now()
    WHERE user_id = res.user_id;
  END IF;

  UPDATE credit_reservations
  SET status = 'committed' WHERE id = reservation_id_param;

  INSERT INTO credit_transactions (user_id, type, amount_usd, balance_after, description, reference_id)
  SELECT res.user_id, 'deduction', actual_cost_param,
    (SELECT balance_usd FROM credits WHERE user_id = res.user_id),
    'Agent execution (committed)', res.execution_id;

  RETURN jsonb_build_object('success', true, 'committed', actual_cost_param, 'refunded', refund_amt);
END; $$;

GRANT EXECUTE ON FUNCTION commit_credit_reservation(uuid, numeric) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. RELEASE CREDIT RESERVATION RPC
--    Refunds reservation on failure. Called in catch blocks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_credit_reservation(reservation_id_param uuid)
RETURNS JSONB
LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  res RECORD;
BEGIN
  SELECT * INTO res FROM credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved' FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reservation not found or already processed');
  END IF;

  -- Full refund
  UPDATE credits
  SET balance_usd = balance_usd + res.reserved_usd, updated_at = now()
  WHERE user_id = res.user_id;

  UPDATE credit_reservations SET status = 'released' WHERE id = reservation_id_param;

  RETURN jsonb_build_object('success', true, 'refunded', res.reserved_usd);
END; $$;

GRANT EXECUTE ON FUNCTION release_credit_reservation(uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6. CONCURRENT EXECUTIONS CHECK RPC
--    Returns count of currently-running executions for a user.
--    Called pre-flight to enforce plan concurrency limits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_concurrent_executions(user_id_param uuid)
RETURNS INTEGER
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::integer
  FROM executions
  WHERE user_id = user_id_param
    AND status  = 'running'
    AND created_at > now() - INTERVAL '10 minutes'; -- stale guard
$$;

GRANT EXECUTE ON FUNCTION get_concurrent_executions(uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7. EXECUTION RESPONSE CACHE TABLE
--    SHA-256(agent_id || ':' || normalized_input) → cached output.
--    TTL: configurable per agent (default 1 hour).
--    Free plan users always hit cache. Paid users can opt out with Cache-Control: no-cache.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS execution_cache (
  cache_key    text        PRIMARY KEY,   -- SHA-256 hex
  agent_id     uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  output       jsonb       NOT NULL,
  tokens_input integer     DEFAULT 0,
  tokens_output integer    DEFAULT 0,
  cost_usd     numeric(12,6) DEFAULT 0,
  hit_count    integer     DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_agent   ON execution_cache(agent_id);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON execution_cache(expires_at);

ALTER TABLE execution_cache ENABLE ROW LEVEL SECURITY;
-- Cache is readable by anyone (public agents), insertable by service
CREATE POLICY "cache_public_read"   ON execution_cache FOR SELECT USING (true);
CREATE POLICY "cache_service_write" ON execution_cache FOR ALL USING (true);
GRANT SELECT, INSERT, UPDATE ON execution_cache TO authenticated, service_role;

-- Cleanup expired cache entries hourly
CREATE OR REPLACE FUNCTION cleanup_execution_cache()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH d AS (DELETE FROM execution_cache WHERE expires_at < now() RETURNING cache_key)
  SELECT COUNT(*)::integer FROM d;
$$;
GRANT EXECUTE ON FUNCTION cleanup_execution_cache() TO service_role;

SELECT cron.schedule('cleanup-cache', '30 * * * *',
  $$SELECT cleanup_execution_cache()$$);


-- ---------------------------------------------------------------------------
-- 8. INCREMENT RATE LIMIT RPC (used by anti-abuse checkUserRateLimit)
--    Atomically increments a windowed counter.
--    Returns { count, window_end, blocked } as JSONB.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_rate_limit(
  key_param        text,
  window_end_param timestamptz,
  limit_param      integer
)
RETURNS JSONB
LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  current_count integer;
  current_end   timestamptz;
BEGIN
  -- Try to get existing window
  SELECT count, window_end INTO current_count, current_end
  FROM rate_limit_counters WHERE id = key_param FOR UPDATE SKIP LOCKED;

  IF NOT FOUND OR now() > current_end THEN
    -- New window
    INSERT INTO rate_limit_counters (id, count, window_end)
    VALUES (key_param, 1, window_end_param)
    ON CONFLICT (id) DO UPDATE
      SET count      = 1,
          window_end = window_end_param;

    RETURN jsonb_build_object('count', 1, 'window_end', window_end_param, 'blocked', false);
  END IF;

  IF current_count >= limit_param THEN
    RETURN jsonb_build_object('count', current_count, 'window_end', current_end, 'blocked', true);
  END IF;

  UPDATE rate_limit_counters
  SET count = count + 1
  WHERE id = key_param;

  RETURN jsonb_build_object('count', current_count + 1, 'window_end', current_end, 'blocked', false);
END; $$;

GRANT EXECUTE ON FUNCTION increment_rate_limit(text, timestamptz, integer) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 9. PIPELINE VERSIONS TABLE (used by pipeline execute post-run snapshot)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_versions (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id  uuid        NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  version      text        NOT NULL DEFAULT '1.0.0',
  dag_snapshot jsonb       NOT NULL DEFAULT '{}',
  node_count   integer     DEFAULT 0,
  snapshot_at  timestamptz DEFAULT now(),
  UNIQUE (pipeline_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pver_pipeline ON pipeline_versions(pipeline_id, snapshot_at DESC);
ALTER TABLE pipeline_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pver_owner" ON pipeline_versions FOR ALL USING (
  EXISTS (SELECT 1 FROM pipelines WHERE id = pipeline_versions.pipeline_id AND owner_id = auth.uid())
);
GRANT SELECT, INSERT, UPDATE ON pipeline_versions TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 10. AGENT PIPELINE USAGE TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_pipeline_usage (
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (agent_id, pipeline_id)
);

CREATE INDEX IF NOT EXISTS idx_apu_agent    ON agent_pipeline_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_apu_pipeline ON agent_pipeline_usage(pipeline_id);
ALTER TABLE agent_pipeline_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apu_public" ON agent_pipeline_usage FOR SELECT USING (true);
CREATE POLICY "apu_write"  ON agent_pipeline_usage FOR INSERT WITH CHECK (true);
GRANT SELECT, INSERT ON agent_pipeline_usage TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 11. VERIFY
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  RAISE NOTICE '✅ Migration 011 complete — concurrency control, idempotency, credit reservation, execution cache installed.';
END $$;
