-- =============================================================================
-- AgentDyne — Migration 032: WAL-lite Replay Engine + Referral System
--
-- Part 1: WAL-lite (Write-Ahead Log) — every execution step is recorded
--   and can be replayed with modified settings. This is the enterprise
--   differentiator: "every execution is auditable and replayable."
--
-- Part 2: Referral system — ?ref=CODE tracking + auto-credit on first payment.
--
-- Safe to re-run. All idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: WAL-LITE + REPLAY ENGINE
-- ─────────────────────────────────────────────────────────────────────────────

-- WAL: records every significant state change during an execution.
-- sequence_num ensures ordering is deterministic for replay.
CREATE TABLE IF NOT EXISTS public.execution_wal (
  id              BIGSERIAL PRIMARY KEY,
  execution_id    UUID        NOT NULL REFERENCES public.executions(id) ON DELETE CASCADE,
  sequence_num    INTEGER     NOT NULL,                  -- order within execution (1-based)
  event_type      TEXT        NOT NULL,                  -- 'input', 'rag_retrieval', 'llm_call', 'tool_call', 'output'
  model_used      TEXT,                                  -- which model served this step
  input_hash      TEXT,                                  -- SHA-256 of input (for dedup/cache)
  output_hash     TEXT,                                  -- SHA-256 of output
  tokens_input    INTEGER     DEFAULT 0,
  tokens_output   INTEGER     DEFAULT 0,
  latency_ms      INTEGER,
  cost_usd        NUMERIC     DEFAULT 0,
  status          TEXT        DEFAULT 'success' CHECK (status IN ('success','error','skipped')),
  error_message   TEXT,
  event_payload   JSONB       DEFAULT '{}'::JSONB,       -- full input/output snapshot (optional, for full replay)
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wal_execution_seq
  ON public.execution_wal(execution_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_wal_created
  ON public.execution_wal(created_at DESC);

-- Replay sessions: records when a user replays an execution with modified params.
-- Result diff is stored to enable A/B comparison.
CREATE TABLE IF NOT EXISTS public.replay_sessions (
  id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_execution_id   UUID        NOT NULL REFERENCES public.executions(id),
  replayed_by             UUID        NOT NULL REFERENCES public.profiles(id),
  agent_id                UUID        REFERENCES public.agents(id),
  modifications           JSONB       DEFAULT '{}'::JSONB, -- { "temperature": 0.9, "model": "claude-opus-4-6" }
  replay_execution_id     UUID        REFERENCES public.executions(id),  -- new execution created by replay
  original_output_hash    TEXT,
  replay_output_hash      TEXT,
  outputs_identical       BOOLEAN,                         -- true if replay produced same result
  replay_cost_usd         NUMERIC     DEFAULT 0,
  replay_latency_ms       INTEGER,
  status                  TEXT        DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed')),
  started_at              TIMESTAMPTZ DEFAULT now(),
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_replay_original
  ON public.replay_sessions(original_execution_id);
CREATE INDEX IF NOT EXISTS idx_replay_user
  ON public.replay_sessions(replayed_by, created_at DESC);

-- RLS
ALTER TABLE public.execution_wal    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replay_sessions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wal_owner_read"     ON public.execution_wal;
DROP POLICY IF EXISTS "wal_service_write"  ON public.execution_wal;
DROP POLICY IF EXISTS "replay_owner"       ON public.replay_sessions;
DROP POLICY IF EXISTS "replay_service_rw"  ON public.replay_sessions;

CREATE POLICY "wal_owner_read" ON public.execution_wal FOR SELECT
  USING (
    execution_id IN (
      SELECT id FROM public.executions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "wal_service_write" ON public.execution_wal FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "replay_owner" ON public.replay_sessions FOR SELECT
  USING (replayed_by = auth.uid());

CREATE POLICY "replay_service_rw" ON public.replay_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "replay_owner_insert" ON public.replay_sessions FOR INSERT
  WITH CHECK (replayed_by = auth.uid() OR auth.role() = 'service_role');

-- Helper: get full WAL for an execution (used by replay API)
CREATE OR REPLACE FUNCTION public.get_execution_wal(p_execution_id UUID)
RETURNS TABLE (
  sequence_num  INTEGER,
  event_type    TEXT,
  model_used    TEXT,
  input_hash    TEXT,
  output_hash   TEXT,
  tokens_input  INTEGER,
  tokens_output INTEGER,
  latency_ms    INTEGER,
  cost_usd      NUMERIC,
  status        TEXT,
  event_payload JSONB,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sequence_num, event_type, model_used,
    input_hash, output_hash,
    tokens_input, tokens_output, latency_ms, cost_usd,
    status, event_payload, created_at
  FROM execution_wal
  WHERE execution_id = p_execution_id
  ORDER BY sequence_num ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_execution_wal(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: REFERRAL SYSTEM
-- ─────────────────────────────────────────────────────────────────────────────

-- referrals table: tracks who referred whom + reward state
CREATE TABLE IF NOT EXISTS public.referrals (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id      UUID        NOT NULL REFERENCES public.profiles(id),
  referred_email   TEXT        NOT NULL,
  referred_user_id UUID        REFERENCES public.profiles(id),       -- filled on signup
  ref_code         TEXT        NOT NULL UNIQUE,                       -- agd_REF_XXXXX
  status           TEXT        DEFAULT 'pending'
                               CHECK (status IN ('pending','signed_up','paid','expired')),
  reward_amount    NUMERIC     DEFAULT 5.00,                          -- $5 credit reward
  reward_credited  BOOLEAN     DEFAULT false,
  signed_up_at     TIMESTAMPTZ,
  first_paid_at    TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ DEFAULT (now() + INTERVAL '90 days'),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_code
  ON public.referrals(ref_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON public.referrals(referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_email
  ON public.referrals(referred_email);
CREATE INDEX IF NOT EXISTS idx_referrals_user
  ON public.referrals(referred_user_id) WHERE referred_user_id IS NOT NULL;

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_owner_read"    ON public.referrals;
DROP POLICY IF EXISTS "referrals_service_write" ON public.referrals;
DROP POLICY IF EXISTS "referrals_public_insert" ON public.referrals;

CREATE POLICY "referrals_owner_read" ON public.referrals FOR SELECT
  USING (referrer_id = auth.uid() OR referred_user_id = auth.uid());

CREATE POLICY "referrals_owner_insert" ON public.referrals FOR INSERT
  WITH CHECK (referrer_id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "referrals_service_write" ON public.referrals FOR UPDATE
  USING (auth.role() = 'service_role');

-- ref_code column on profiles (for "share your code" feature)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ref_code        TEXT UNIQUE,   -- this user's shareable referral code
  ADD COLUMN IF NOT EXISTS referred_by     UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS referral_credit NUMERIC DEFAULT 0;  -- lifetime credits earned via referrals

-- Generate a referral code for existing users who don't have one
UPDATE public.profiles
SET ref_code = 'agd_' || upper(substring(replace(id::text, '-', ''), 1, 8))
WHERE ref_code IS NULL;

-- Function: process referral when a new user signs up with a ref code
CREATE OR REPLACE FUNCTION public.process_referral_signup(
  p_new_user_id    UUID,
  p_new_user_email TEXT,
  p_ref_code       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id   UUID;
  v_referral_id   UUID;
BEGIN
  IF p_ref_code IS NULL OR trim(p_ref_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_code');
  END IF;

  -- Look up the referrer by their code
  SELECT id INTO v_referrer_id
  FROM profiles
  WHERE ref_code = p_ref_code AND id != p_new_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_code');
  END IF;

  -- Check for existing referral (prevent duplicate)
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_user_id = p_new_user_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_referred');
  END IF;

  -- Mark referral as signed_up
  UPDATE referrals
  SET referred_user_id = p_new_user_id,
      status           = 'signed_up',
      signed_up_at     = now()
  WHERE referrer_id    = v_referrer_id
    AND referred_email = p_new_user_email
    AND status         = 'pending'
  RETURNING id INTO v_referral_id;

  IF NOT FOUND THEN
    -- Create a new referral record (link wasn't pre-created)
    INSERT INTO referrals
      (referrer_id, referred_email, referred_user_id, ref_code, status, signed_up_at)
    VALUES
      (v_referrer_id, p_new_user_email, p_new_user_id, p_ref_code, 'signed_up', now())
    RETURNING id INTO v_referral_id;
  END IF;

  -- Link the new user back to their referrer
  UPDATE profiles SET referred_by = v_referrer_id WHERE id = p_new_user_id;

  RETURN jsonb_build_object(
    'success',     true,
    'referrer_id', v_referrer_id,
    'referral_id', v_referral_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_referral_signup(UUID, TEXT, TEXT) TO service_role;

-- Function: process reward when referred user makes their first payment
CREATE OR REPLACE FUNCTION public.process_referral_reward(p_referred_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral  RECORD;
BEGIN
  SELECT r.*, p.id AS ref_id
  INTO v_referral
  FROM referrals r
  WHERE r.referred_user_id = p_referred_user_id
    AND r.status            = 'signed_up'
    AND r.reward_credited   = false
    AND r.expires_at        > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_eligible_referral');
  END IF;

  -- Credit the referrer $5 (or configured reward_amount)
  PERFORM public.add_credits(
    v_referral.referrer_id,
    v_referral.reward_amount,
    'Referral reward: ' || p_referred_user_id,
    v_referral.id
  );

  -- Update referral status
  UPDATE referrals
  SET status          = 'paid',
      reward_credited = true,
      first_paid_at   = now()
  WHERE id = v_referral.id;

  -- Track lifetime referral earnings on profile
  UPDATE profiles
  SET referral_credit = COALESCE(referral_credit, 0) + v_referral.reward_amount
  WHERE id = v_referral.referrer_id;

  -- Notify the referrer
  INSERT INTO notifications (user_id, title, body, type, action_url)
  VALUES (
    v_referral.referrer_id,
    '🎉 You earned a referral reward!',
    '$' || v_referral.reward_amount || ' added to your credits — someone you referred made their first purchase.',
    'referral_reward',
    '/billing'
  );

  RETURN jsonb_build_object('success', true, 'reward', v_referral.reward_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(UUID) TO service_role;

-- Auto-generate ref codes for any profiles missing one
DO $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.profiles
  SET ref_code = 'agd_' || upper(substring(replace(id::text, '-', ''), 1, 8))
  WHERE ref_code IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '✅ Generated ref codes for % profiles', v_count;
END $$;

-- Register referral reward cron (daily cleanup of expired referrals)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-expire-referrals', '0 2 * * *',
      'UPDATE public.referrals SET status = ''expired'' WHERE status = ''pending'' AND expires_at < now()');
    RAISE NOTICE '✅ Referral expiry cron registered';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_wal_ok      BOOLEAN;
  v_replay_ok   BOOLEAN;
  v_referrals_ok BOOLEAN;
  v_ref_codes   INTEGER;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='execution_wal')   INTO v_wal_ok;
  SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='replay_sessions') INTO v_replay_ok;
  SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='referrals')       INTO v_referrals_ok;
  SELECT COUNT(*) INTO v_ref_codes FROM public.profiles WHERE ref_code IS NOT NULL;

  RAISE NOTICE '';
  RAISE NOTICE '=== Migration 032 — Verification ===';
  RAISE NOTICE 'execution_wal table:  %', CASE WHEN v_wal_ok      THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'replay_sessions table: %', CASE WHEN v_replay_ok  THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'referrals table:       %', CASE WHEN v_referrals_ok THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Profiles with ref_code: %', v_ref_codes;
  RAISE NOTICE '=== Migration 032 COMPLETE ===';
END $$;
