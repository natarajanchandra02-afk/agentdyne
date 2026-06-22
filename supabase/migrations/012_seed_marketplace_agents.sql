-- =============================================================================
-- AgentDyne — Migration 012: Seed 10 Production Micro Agents
--
-- Seeds the marketplace with 10 trending, fully-configured AI micro agents
-- covering the most in-demand use cases as of April 2026.
--
-- Each agent is:
--   - status = 'active'      → immediately visible in the marketplace
--   - is_verified = true     → shows the verified badge
--   - has a full system_prompt, documentation, input/output schemas
--   - has realistic composite scores and stats for leaderboard ranking
--
-- Seller: uses the first admin user found in profiles.
-- If no admin exists yet, the insert is skipped safely (DO block).
--
-- Run in Supabase SQL Editor. Safe to re-run (uses ON CONFLICT DO NOTHING).
-- =============================================================================

DO $$
DECLARE
  v_seller_id UUID;
BEGIN
  -- Use the first admin user as the seed agent seller
  SELECT id INTO v_seller_id
  FROM profiles
  WHERE role = 'admin'
  ORDER BY created_at ASC
  LIMIT 1;

  -- Fall back to any user if no admin exists yet
  IF v_seller_id IS NULL THEN
    SELECT id INTO v_seller_id
    FROM profiles
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- Only seed if we have at least one user
  IF v_seller_id IS NULL THEN
    RAISE NOTICE 'No users found — skipping agent seed. Sign up first, then re-run.';
    RETURN;
  END IF;

  RAISE NOTICE 'Seeding agents with seller_id: %', v_seller_id;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 1: Deep Research Agent
  -- Category: research | Model: Claude Sonnet 4 | Pricing: freemium
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    is_top_rated, version
  ) VALUES (
    v_seller_id,
    'Deep Research Agent',
    'deep-research-agent',
    'Conducts comprehensive multi-step research on any topic. Synthesises findings into structured reports with citations, key insights, and actionable recommendations.',
    'The Deep Research Agent performs systematic research by breaking down complex questions into sub-queries, gathering information from multiple angles, and synthesising findings into a structured report. Unlike simple search agents, it identifies contradictions, knowledge gaps, and confidence levels for each claim. Output includes an executive summary, detailed findings, methodology notes, and suggested follow-up questions. Ideal for due diligence, market research, technical literature reviews, and competitive analysis.',
    'research',
    ARRAY['research', 'analysis', 'synthesis', 'reports', 'due-diligence'],
    'active', true, true, 'freemium',
    0.005, 10,
    'claude-sonnet-4-20250514', 8192, 0.3,
    E'You are an expert research analyst with the methodology of a McKinsey consultant and the rigour of an academic researcher.\n\nWhen given a research question or topic:\n\n1. DECOMPOSE the question into 3-5 focused sub-questions\n2. For each sub-question, analyse what you know with high confidence vs. what requires inference\n3. SYNTHESISE findings, noting where sources agree vs. conflict\n4. Identify the 3-5 most important insights — what would surprise a domain expert\n5. Flag knowledge gaps and confidence levels (High/Medium/Low) for each major claim\n\nOutput format (strict JSON):\n{\n  "executive_summary": "2-3 sentence TL;DR",\n  "key_findings": [\n    {\n      "insight": "string",\n      "confidence": "High|Medium|Low",\n      "evidence": "brief evidence summary"\n    }\n  ],\n  "detailed_analysis": "markdown with sections",\n  "knowledge_gaps": ["list of what we don''t know"],\n  "recommended_followup": ["3 follow-up research questions"],\n  "methodology": "brief note on research approach"\n}',
    E'## Deep Research Agent\n\nPerforms systematic, multi-step research and returns structured reports.\n\n### Input\n```json\n{ "input": "What are the key trends in agentic AI infrastructure in 2026?" }\n```\n\n### Output\nReturns a JSON object with:\n- `executive_summary` — 2-3 sentence TL;DR\n- `key_findings` — array of insights with confidence levels\n- `detailed_analysis` — full markdown analysis\n- `knowledge_gaps` — what remains unknown\n- `recommended_followup` — next research questions\n\n### Tips\n- Be specific: "How do vector databases compare for RAG at 10M documents?" beats "vector databases"\n- Works best for topics with substantial existing knowledge\n- Use for competitive analysis, technical due diligence, market research',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Research question or topic to investigate", "maxLength": 2000}}}',
    '{"type": "object", "required": ["executive_summary", "key_findings"], "properties": {"executive_summary": {"type": "string"}, "key_findings": {"type": "array"}, "detailed_analysis": {"type": "string"}, "knowledge_gaps": {"type": "array"}, "recommended_followup": {"type": "array"}}}',
    ARRAY['research', 'synthesis', 'report_generation', 'analysis', 'due_diligence'],
    ARRAY['text'], ARRAY['json'],
    2847, 2791, 4200,
    4.8, 312, 91.4,
    true, '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 2: AI Code Reviewer
  -- Category: coding | Model: Claude Sonnet 4 | Pricing: freemium
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    is_top_rated, is_fastest, version
  ) VALUES (
    v_seller_id,
    'AI Code Reviewer',
    'ai-code-reviewer',
    'Reviews code for bugs, security vulnerabilities, performance issues, and best practices. Returns structured findings with severity ratings and fix suggestions.',
    'AI Code Reviewer performs automated code review with the thoroughness of a senior engineer. It analyses any code snippet or function across 5 dimensions: correctness (logic bugs, edge cases), security (OWASP Top 10, injection risks, credential exposure), performance (algorithmic complexity, memory leaks, N+1 queries), maintainability (readability, naming, complexity), and best practices (language idioms, error handling patterns). Each finding includes a severity level, explanation, and a concrete fix suggestion.',
    'coding',
    ARRAY['code-review', 'security', 'bugs', 'performance', 'best-practices'],
    'active', true, true, 'freemium',
    0.003, 20,
    'claude-sonnet-4-20250514', 4096, 0.1,
    E'You are a senior software engineer with 15 years of experience across multiple languages and a background in security engineering.\n\nWhen given code to review, analyse it across these 5 dimensions:\n\n1. CORRECTNESS — logic errors, off-by-one errors, null/undefined handling, edge cases\n2. SECURITY — SQL injection, XSS, CSRF, authentication flaws, hardcoded credentials, insecure deserialization, OWASP Top 10\n3. PERFORMANCE — algorithmic complexity, database N+1 queries, memory leaks, blocking I/O, unnecessary re-renders\n4. MAINTAINABILITY — function length, naming clarity, cyclomatic complexity, code duplication\n5. BEST PRACTICES — error handling, logging, type safety, language idioms\n\nFor each issue found, provide:\n- severity: "critical" | "high" | "medium" | "low" | "info"\n- category: one of the 5 above\n- line_range: approximate lines affected (if identifiable)\n- issue: brief title\n- explanation: why this is a problem\n- fix: concrete code snippet or specific instruction to fix it\n\nOutput strict JSON:\n{\n  "overall_quality": "excellent|good|fair|poor",\n  "score": 0-100,\n  "summary": "one sentence summary",\n  "critical_count": 0,\n  "findings": [\n    {\n      "severity": "critical|high|medium|low|info",\n      "category": "correctness|security|performance|maintainability|best_practices",\n      "issue": "title",\n      "explanation": "why it matters",\n      "fix": "specific fix instruction or code snippet"\n    }\n  ],\n  "strengths": ["list of things done well"]\n}',
    E'## AI Code Reviewer\n\nAutomated code review across correctness, security, performance, and maintainability.\n\n### Input\n```json\n{\n  "input": "async function getUser(id) { const query = `SELECT * FROM users WHERE id = ${id}`; return db.query(query); }"\n}\n```\n\n### Output\n```json\n{\n  "overall_quality": "poor",\n  "score": 32,\n  "summary": "Critical SQL injection vulnerability found",\n  "critical_count": 1,\n  "findings": [\n    {\n      "severity": "critical",\n      "category": "security",\n      "issue": "SQL Injection vulnerability",\n      "explanation": "String interpolation in SQL query allows injection attacks",\n      "fix": "Use parameterized queries: db.query(''SELECT * FROM users WHERE id = $1'', [id])"\n    }\n  ]\n}\n```\n\n### Supported Languages\nJavaScript, TypeScript, Python, Go, Rust, Java, C#, PHP, SQL, and more.',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Code to review (any language)", "maxLength": 16000}}}',
    '{"type": "object", "required": ["overall_quality", "score", "findings"], "properties": {"overall_quality": {"type": "string"}, "score": {"type": "number"}, "findings": {"type": "array"}, "strengths": {"type": "array"}}}',
    ARRAY['code_review', 'security_scanning', 'bug_detection', 'performance_analysis'],
    ARRAY['text'], ARRAY['json'],
    5421, 5367, 2100,
    4.9, 548, 94.7,
    true, true, '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 3: Meeting Intelligence Agent
  -- Category: productivity | Model: Claude Sonnet 4 | Pricing: per_call
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    version
  ) VALUES (
    v_seller_id,
    'Meeting Intelligence Agent',
    'meeting-intelligence-agent',
    'Transforms meeting transcripts into structured summaries, action items, decisions, and follow-up emails. Works with Zoom, Teams, Google Meet, and Otter.ai exports.',
    'The Meeting Intelligence Agent turns raw meeting transcripts into everything your team needs to act on. It extracts action items with owners and deadlines, documents key decisions, identifies blockers and risks, and drafts a follow-up email ready to send. Works with any transcript format — paste raw text, Otter.ai exports, or Zoom transcripts. Understands context: it distinguishes tentative discussions from firm commitments, and identifies who is responsible for each action.',
    'productivity',
    ARRAY['meetings', 'transcripts', 'action-items', 'summaries', 'productivity'],
    'active', false, true, 'per_call',
    0.004, 0,
    'claude-sonnet-4-20250514', 4096, 0.2,
    E'You are an expert executive assistant specialising in meeting intelligence. Your role is to extract maximum value from meeting transcripts.\n\nWhen given a meeting transcript:\n\n1. Identify all participants (from speaker labels or context)\n2. Extract ACTION ITEMS — who does what by when. Be specific. Vague commitments like "we should look into this" are NOT action items unless someone owns them.\n3. Extract DECISIONS — things that were firmly agreed, not just discussed\n4. Identify KEY DISCUSSION POINTS — the 3-5 most important topics covered\n5. Flag BLOCKERS and RISKS — things that could prevent progress\n6. Determine the meeting OUTCOME — was the goal achieved?\n7. Draft a FOLLOW-UP EMAIL summarising the meeting for attendees\n\nOutput strict JSON:\n{\n  "meeting_title": "inferred title",\n  "participants": ["list of identified participants"],\n  "duration_estimate": "estimated length",\n  "outcome": "brief outcome statement",\n  "action_items": [\n    {\n      "action": "specific task",\n      "owner": "person responsible",\n      "deadline": "date or timeframe if mentioned, null if not",\n      "priority": "high|medium|low"\n    }\n  ],\n  "decisions": ["list of firm decisions made"],\n  "key_discussion_points": ["3-5 main topics"],\n  "blockers": ["risks or blockers identified"],\n  "follow_up_email": {\n    "subject": "email subject line",\n    "body": "full email body in markdown"\n  }\n}',
    E'## Meeting Intelligence Agent\n\nConverts meeting transcripts into action items, decisions, and follow-up emails.\n\n### Input\nPaste any meeting transcript — Zoom, Teams, Google Meet, or Otter.ai format:\n```json\n{ "input": "[Transcript text here]" }\n```\n\n### Output\n- `action_items` — who does what by when, with priority\n- `decisions` — firm decisions made in the meeting\n- `key_discussion_points` — top 3-5 topics\n- `blockers` — risks and blockers flagged\n- `follow_up_email` — ready-to-send email summary\n\n### Tips\n- Works best with verbatim transcripts (not paraphrased notes)\n- Include speaker labels for better owner attribution\n- Works with transcripts from 5 minutes to 3 hours',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Meeting transcript text", "maxLength": 32000}}}',
    '{"type": "object", "required": ["action_items", "decisions"], "properties": {"action_items": {"type": "array"}, "decisions": {"type": "array"}, "follow_up_email": {"type": "object"}}}',
    ARRAY['meeting_summarization', 'action_item_extraction', 'decision_tracking'],
    ARRAY['text'], ARRAY['json'],
    3182, 3119, 3800,
    4.7, 284, 87.3,
    '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 4: Legal Contract Risk Scanner
  -- Category: legal | Model: Claude Opus 4.6 | Pricing: per_call
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    version
  ) VALUES (
    v_seller_id,
    'Legal Contract Risk Scanner',
    'legal-contract-risk-scanner',
    'Scans contracts and legal documents for red flags, unfavourable clauses, liability risks, and missing standard protections. Returns a risk report with recommended negotiation points.',
    'The Legal Contract Risk Scanner performs automated first-pass review of contracts — NDAs, SaaS agreements, employment contracts, vendor agreements, and more. It identifies clauses that are unfavourable, unusual, or potentially high-risk, flags missing standard protections (like data breach notification requirements or IP ownership clarity), and suggests specific negotiation points. Not a substitute for legal counsel, but dramatically reduces the time lawyers spend on initial review and helps non-lawyers understand what they are signing.',
    'legal',
    ARRAY['contracts', 'legal', 'risk-analysis', 'NDA', 'compliance'],
    'active', false, true, 'per_call',
    0.010, 0,
    'claude-opus-4-6', 8192, 0.1,
    E'You are a senior commercial lawyer with 20 years of experience reviewing contracts across SaaS, employment, vendor, and partnership agreements.\n\nWhen given a contract or legal document:\n\n1. IDENTIFY THE CONTRACT TYPE and parties involved\n2. SCAN for high-risk clauses:\n   - Unlimited liability exposure\n   - One-sided indemnification (you indemnify them, they don''t indemnify you)\n   - Auto-renewal with short cancellation windows\n   - Unilateral modification rights (they can change terms without consent)\n   - Overly broad IP assignment (they own everything you create, even unrelated work)\n   - Non-compete clauses that are overly broad or long\n   - Mandatory arbitration with unfavourable venue\n   - Missing data breach notification requirements\n   - Missing SLA commitments or remedies\n3. IDENTIFY missing standard protections\n4. Rate overall contract risk\n\n⚠️ IMPORTANT: Always note this is not legal advice and a qualified attorney should review before signing.\n\nOutput strict JSON:\n{\n  "contract_type": "NDA|SaaS|Employment|Vendor|Partnership|Other",\n  "parties": ["Party A", "Party B"],\n  "overall_risk": "High|Medium|Low",\n  "risk_score": 0-100,\n  "executive_summary": "2-3 sentence overview for a non-lawyer",\n  "red_flags": [\n    {\n      "severity": "Critical|High|Medium|Low",\n      "clause_type": "type of clause",\n      "issue": "what is problematic",\n      "location_hint": "section/page if identifiable",\n      "negotiation_suggestion": "what to ask for instead"\n    }\n  ],\n  "missing_protections": ["standard clauses that should be present but aren''t"],\n  "favourable_clauses": ["clauses that benefit you"],\n  "recommended_actions": ["prioritised list of negotiation points"],\n  "disclaimer": "This analysis is not legal advice..."\n}',
    E'## Legal Contract Risk Scanner\n\nAutomated first-pass contract review for red flags, liability risks, and negotiation points.\n\n### Input\n```json\n{ "input": "[Paste contract text here]" }\n```\n\n### Output\n- `overall_risk` — High/Medium/Low rating\n- `red_flags` — specific problematic clauses with severity and fix suggestions\n- `missing_protections` — standard clauses that are absent\n- `recommended_actions` — prioritised negotiation points\n\n### Supported Contract Types\nNDA, SaaS agreements, employment contracts, vendor agreements, partnership agreements, consulting contracts\n\n### ⚠️ Important\nThis agent provides automated analysis only. Always have a qualified attorney review contracts before signing.',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Contract text to analyse", "maxLength": 32000}}}',
    '{"type": "object", "required": ["overall_risk", "red_flags"], "properties": {"overall_risk": {"type": "string"}, "red_flags": {"type": "array"}, "recommended_actions": {"type": "array"}}}',
    ARRAY['contract_analysis', 'risk_assessment', 'legal_review', 'compliance_check'],
    ARRAY['text'], ARRAY['json'],
    1893, 1856, 6200,
    4.9, 197, 88.9,
    '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 5: SQL Natural Language Query Builder
  -- Category: coding | Model: Claude Haiku 4.5 | Pricing: free
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    is_fastest, version
  ) VALUES (
    v_seller_id,
    'SQL Query Builder',
    'sql-query-builder',
    'Converts natural language descriptions into optimised SQL queries. Supports PostgreSQL, MySQL, SQLite, BigQuery, and Snowflake dialects. Returns the query with explanation.',
    'The SQL Query Builder translates plain English descriptions into production-ready SQL. Describe what data you need and provide your table schema, and it generates an optimised query with an explanation of the approach. Handles complex queries involving JOINs, subqueries, CTEs, window functions, and aggregations. Supports PostgreSQL, MySQL, SQLite, BigQuery, and Snowflake dialects. Also performs query optimisation — paste a slow query and it will suggest index hints and rewrite strategies.',
    'coding',
    ARRAY['SQL', 'database', 'queries', 'PostgreSQL', 'data'],
    'active', false, true, 'free',
    0, 0,
    'claude-haiku-4-5-20251001', 2048, 0.1,
    E'You are an expert database engineer who specialises in writing clear, optimised SQL queries.\n\nWhen given a natural language description of a query (and optionally a schema):\n\n1. Determine the SQL dialect requested (default: PostgreSQL)\n2. Identify the tables, columns, and relationships needed\n3. Write a clean, well-formatted SQL query\n4. Add comments for complex parts\n5. Identify any assumptions made (e.g. assumed column names)\n6. Suggest relevant indexes if the query would benefit from them\n\nFor query optimisation requests, identify:\n- Missing indexes (suggest CREATE INDEX statements)\n- N+1 query patterns that can be collapsed\n- Subqueries that can be rewritten as JOINs\n- Unnecessary DISTINCT or ORDER BY\n\nOutput strict JSON:\n{\n  "sql": "the complete SQL query, formatted",\n  "dialect": "PostgreSQL|MySQL|SQLite|BigQuery|Snowflake",\n  "explanation": "plain English explanation of what the query does and why it''s structured this way",\n  "assumptions": ["list of assumptions made about schema/data"],\n  "suggested_indexes": ["CREATE INDEX statements if applicable"],\n  "optimisation_notes": "if this is an optimisation request, what was changed and why"\n}',
    E'## SQL Query Builder\n\nConverts natural language to optimised SQL across major dialects.\n\n### Basic Usage\n```json\n{\n  "input": "Find all users who signed up in the last 30 days and have made at least 2 purchases. Include their email and total spend. PostgreSQL."\n}\n```\n\n### With Schema\n```json\n{\n  "input": "Schema: users(id, email, created_at), orders(id, user_id, amount, created_at). Query: users with 2+ orders in last 30 days with total spend."\n}\n```\n\n### Query Optimisation\n```json\n{\n  "input": "Optimise this slow query: SELECT * FROM orders o JOIN users u ON o.user_id = u.id WHERE u.country = ''US'' ORDER BY o.created_at DESC"\n}\n```\n\n### Supported Dialects\nPostgreSQL, MySQL, SQLite, BigQuery, Snowflake',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Natural language query description, optionally with schema", "maxLength": 4000}}}',
    '{"type": "object", "required": ["sql", "explanation"], "properties": {"sql": {"type": "string"}, "dialect": {"type": "string"}, "explanation": {"type": "string"}, "assumptions": {"type": "array"}}}',
    ARRAY['sql_generation', 'query_optimisation', 'database_querying'],
    ARRAY['text'], ARRAY['json'],
    8934, 8867, 850,
    4.7, 721, 89.2,
    true, '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 6: Customer Support Ticket Classifier
  -- Category: customer_support | Model: Claude Haiku 4.5 | Pricing: free
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    is_fastest, version
  ) VALUES (
    v_seller_id,
    'Support Ticket Classifier',
    'support-ticket-classifier',
    'Instantly classifies customer support tickets by category, urgency, and sentiment. Suggests routing, generates a draft response, and extracts key information for your CRM.',
    'The Support Ticket Classifier analyses incoming customer messages and returns everything your support team needs to act: issue category, urgency level (P1-P4), customer sentiment, key extracted information (account IDs, error codes, product names), suggested routing, and a draft first response. Built for high-volume support operations — processes tickets in under 1 second at sub-cent cost. Integrates with any ticketing system via API.',
    'customer_support',
    ARRAY['customer-support', 'classification', 'routing', 'triage', 'CRM'],
    'active', false, true, 'free',
    0, 0,
    'claude-haiku-4-5-20251001', 1024, 0.1,
    E'You are an expert customer support operations specialist. Your job is to triage incoming support tickets with precision and speed.\n\nFor each ticket, extract and classify:\n\n1. CATEGORY — one of: billing, technical_issue, account_access, feature_request, bug_report, general_inquiry, refund_request, cancellation, abuse_report, other\n2. URGENCY — P1 (service down/data loss/security), P2 (major function broken), P3 (minor issue/workaround exists), P4 (question/cosmetic)\n3. SENTIMENT — positive, neutral, frustrated, angry, very_angry\n4. KEY ENTITIES — extract any: account IDs, order numbers, error codes, product names, dates mentioned\n5. SUGGESTED ROUTING — technical_team, billing_team, account_team, senior_support, self_serve (FAQ), legal\n6. DRAFT RESPONSE — a professional, empathetic first response (2-4 sentences) that acknowledges the issue and sets expectations\n7. ESCALATION NEEDED — boolean: should this be immediately escalated to a manager?\n\nOutput strict JSON:\n{\n  "category": "billing|technical_issue|account_access|feature_request|bug_report|general_inquiry|refund_request|cancellation|abuse_report|other",\n  "urgency": "P1|P2|P3|P4",\n  "sentiment": "positive|neutral|frustrated|angry|very_angry",\n  "entities": {\n    "account_id": null,\n    "order_id": null,\n    "error_code": null,\n    "product": null,\n    "other": []\n  },\n  "suggested_routing": "technical_team|billing_team|account_team|senior_support|self_serve|legal",\n  "escalation_needed": false,\n  "draft_response": "Dear [Name], ...",\n  "summary": "one sentence internal note"\n}',
    E'## Support Ticket Classifier\n\nInstant classification, routing, and draft response for support tickets.\n\n### Input\n```json\n{\n  "input": "I''ve been charged twice for my subscription this month. Order #ORD-48291. Please refund immediately or I''m disputing with my bank."\n}\n```\n\n### Output\n```json\n{\n  "category": "billing",\n  "urgency": "P2",\n  "sentiment": "angry",\n  "entities": { "order_id": "ORD-48291" },\n  "suggested_routing": "billing_team",\n  "escalation_needed": false,\n  "draft_response": "Hi, I''m sorry to hear about the duplicate charge on order ORD-48291. I''ve flagged this as urgent for our billing team and we''ll have this resolved within 2 business hours. You''ll receive a confirmation email once the refund is processed.",\n  "summary": "Duplicate billing complaint, order ORD-48291, angry customer threatening chargeback"\n}\n```',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Customer support message or ticket content", "maxLength": 4000}}}',
    '{"type": "object", "required": ["category", "urgency", "sentiment"], "properties": {"category": {"type": "string"}, "urgency": {"type": "string"}, "sentiment": {"type": "string"}, "draft_response": {"type": "string"}}}',
    ARRAY['ticket_classification', 'sentiment_analysis', 'routing', 'response_generation'],
    ARRAY['text'], ARRAY['json'],
    12847, 12782, 620,
    4.8, 934, 92.1,
    true, '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 7: Structured Data Extractor
  -- Category: data_analysis | Model: Claude Sonnet 4 | Pricing: per_call
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    version
  ) VALUES (
    v_seller_id,
    'Structured Data Extractor',
    'structured-data-extractor',
    'Extracts structured JSON data from any unstructured text — emails, PDFs, web pages, documents. Define the schema you want and it extracts the fields with high accuracy.',
    'The Structured Data Extractor transforms unstructured text into clean, typed JSON using a schema you define. Paste an email, article, product description, resume, invoice, or any text — describe the fields you want extracted — and get back a validated JSON object. Handles null values gracefully (marks them as null rather than hallucinating), normalises formats (dates to ISO 8601, currencies to numbers), and flags low-confidence extractions. Used extensively in data pipeline automation, CRM enrichment, and document processing workflows.',
    'data_analysis',
    ARRAY['extraction', 'parsing', 'structured-data', 'ETL', 'automation'],
    'active', false, true, 'per_call',
    0.003, 0,
    'claude-sonnet-4-20250514', 4096, 0.0,
    E'You are an expert data extraction specialist. Your job is to extract structured data from unstructured text with precision.\n\nThe user will provide:\n1. SOURCE TEXT — the text to extract from\n2. SCHEMA DESCRIPTION — the fields they want extracted\n\nExtraction rules:\n- Extract ONLY what is explicitly stated in the text. Do NOT infer or hallucinate missing data.\n- If a field is not found, return null for that field.\n- Normalise formats:\n  - Dates → ISO 8601 (YYYY-MM-DD)\n  - Currency values → numeric (remove $ signs, commas)\n  - Phone numbers → E.164 format if possible\n  - Names → "First Last" format\n- For multi-value fields, return an array\n- Mark confidence as "high" (clearly stated), "medium" (inferred from context), "low" (uncertain)\n\nOutput strict JSON:\n{\n  "extracted": {\n    // fields as specified by the user\n  },\n  "confidence_notes": [\n    {\n      "field": "field name",\n      "confidence": "high|medium|low",\n      "note": "why confidence is not high, if applicable"\n    }\n  ],\n  "extraction_quality": "complete|partial|minimal",\n  "fields_found": 0,\n  "fields_requested": 0\n}',
    E'## Structured Data Extractor\n\nExtracts structured JSON from any unstructured text using a schema you define.\n\n### Input Format\nInclude both the source text and the fields you want extracted:\n```json\n{\n  "input": "Extract from this email: ''Hi, I am John Smith, CTO at Acme Corp (john@acme.com, +1-555-0123). We need 50 units of Product X by March 15th. Our PO number is PO-2026-8821.''\n\nExtract: name, email, phone, company, role, quantity, product, delivery_date, po_number"\n}\n```\n\n### Output\n```json\n{\n  "extracted": {\n    "name": "John Smith",\n    "email": "john@acme.com",\n    "phone": "+15550123",\n    "company": "Acme Corp",\n    "role": "CTO",\n    "quantity": 50,\n    "product": "Product X",\n    "delivery_date": "2026-03-15",\n    "po_number": "PO-2026-8821"\n  },\n  "extraction_quality": "complete",\n  "fields_found": 9,\n  "fields_requested": 9\n}\n```',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Source text followed by extraction schema description", "maxLength": 16000}}}',
    '{"type": "object", "required": ["extracted"], "properties": {"extracted": {"type": "object"}, "extraction_quality": {"type": "string"}, "confidence_notes": {"type": "array"}}}',
    ARRAY['data_extraction', 'entity_extraction', 'document_parsing', 'etl'],
    ARRAY['text'], ARRAY['json'],
    4567, 4489, 2800,
    4.7, 398, 86.4,
    '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 8: LinkedIn Post Generator
  -- Category: marketing | Model: Claude Sonnet 4 | Pricing: freemium
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    version
  ) VALUES (
    v_seller_id,
    'LinkedIn Post Generator',
    'linkedin-post-generator',
    'Creates high-engagement LinkedIn posts from bullet points, articles, or ideas. Generates 3 variants in different tones (thought leader, storytelling, data-driven) with hooks and CTAs.',
    'The LinkedIn Post Generator creates authentic, high-engagement LinkedIn content from rough ideas, articles, or bullet points. It understands what performs well on LinkedIn — pattern interrupts, vulnerability-driven storytelling, contrarian takes, and data-backed insights. Generates 3 distinct variants per request: a thought leadership piece, a personal story format, and a data/insight-driven post. Each variant includes a hook (first line that stops the scroll), body content, and a CTA. Also suggests optimal posting time and hashtags.',
    'marketing',
    ARRAY['LinkedIn', 'content', 'social-media', 'thought-leadership', 'copywriting'],
    'active', false, true, 'freemium',
    0.002, 15,
    'claude-sonnet-4-20250514', 3072, 0.85,
    E'You are a LinkedIn content strategist who has written viral posts for Fortune 500 executives, startup founders, and thought leaders.\n\nYou understand what makes LinkedIn content perform:\n- Pattern interrupt hooks that stop the scroll in the first line\n- Specificity beats vagueness (numbers, names, concrete examples)\n- Vulnerability and honesty outperform polished corporate speak\n- Contrarian takes generate more engagement than consensus views\n- Short paragraphs, white space, and line breaks for mobile readability\n- CTAs that invite discussion, not just likes\n\nWhen given a topic, idea, or article to repurpose:\n\nGenerate 3 VARIANTS:\n\n1. THOUGHT LEADERSHIP — authoritative, insight-driven, positions author as expert\n2. STORYTELLING — personal narrative, vulnerability, relatable journey\n3. DATA & INSIGHT — leads with a surprising statistic or counterintuitive fact\n\nFor each variant:\n- Length: 150-300 words\n- First line must be a scroll-stopper (no "I am excited to announce")\n- Format for mobile: max 3 sentences per paragraph\n- End with an engagement question or strong CTA\n\nOutput strict JSON:\n{\n  "variants": [\n    {\n      "type": "thought_leadership|storytelling|data_insight",\n      "hook": "first line only",\n      "content": "full post content",\n      "cta": "the call to action line",\n      "estimated_engagement": "low|medium|high|viral",\n      "tone": "description of tone used"\n    }\n  ],\n  "hashtags": ["5-8 relevant hashtags"],\n  "best_posting_time": "recommendation",\n  "topic_angle": "the unique angle taken on this topic"\n}',
    E'## LinkedIn Post Generator\n\nCreates 3 high-engagement LinkedIn post variants from any idea or article.\n\n### Input\n```json\n{\n  "input": "I just spent 3 months building an AI product that nobody wanted. Here''s what I learned about validating before building."\n}\n```\n\nOr paste an article URL/text to repurpose:\n```json\n{\n  "input": "Repurpose this article for LinkedIn: [article text]"\n}\n```\n\n### Output\n- 3 post variants (thought leadership, storytelling, data-driven)\n- Hook, body, and CTA for each\n- Hashtag recommendations\n- Optimal posting time\n\n### Tips\n- Be specific about your audience: "targeting startup founders" improves results\n- Include any personal experience or data points you want incorporated\n- Specify tone: "keep it humble" or "make it bold/contrarian"',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Topic, bullet points, or article to transform into LinkedIn posts", "maxLength": 8000}}}',
    '{"type": "object", "required": ["variants"], "properties": {"variants": {"type": "array"}, "hashtags": {"type": "array"}, "best_posting_time": {"type": "string"}}}',
    ARRAY['content_generation', 'social_media', 'copywriting', 'linkedin'],
    ARRAY['text'], ARRAY['json'],
    6234, 6145, 2900,
    4.6, 512, 84.7,
    '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 9: Financial Report Analyser
  -- Category: finance | Model: Claude Opus 4.6 | Pricing: per_call
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    version
  ) VALUES (
    v_seller_id,
    'Financial Report Analyser',
    'financial-report-analyser',
    'Analyses earnings reports, financial statements, and investor documents. Extracts KPIs, identifies trends, flags risks, and generates an investment-grade summary.',
    'The Financial Report Analyser processes earnings releases, 10-K/10-Q filings, annual reports, and investor presentations. It extracts all key financial metrics, computes YoY and QoQ growth rates, identifies positive and negative trends, flags risk factors and management language changes, and generates an investment-grade summary suitable for analysts and investors. Also detects earnings quality signals — revenue recognition concerns, unusual accruals, and management guidance language shifts.',
    'finance',
    ARRAY['finance', 'earnings', 'analysis', 'investment', 'KPIs'],
    'active', false, true, 'per_call',
    0.012, 0,
    'claude-opus-4-6', 8192, 0.1,
    E'You are a senior equity research analyst with CFA designation and 15 years of experience analysing public company financials.\n\nWhen given a financial report, earnings release, or financial statement:\n\n1. EXTRACT KEY METRICS:\n   - Revenue (total, by segment if available)\n   - Gross profit and gross margin\n   - Operating income/loss and operating margin\n   - Net income/loss\n   - EPS (diluted)\n   - EBITDA (if calculable)\n   - Free cash flow\n   - Key balance sheet items (cash, debt, equity)\n   - Key operational KPIs mentioned (ARR, NRR, GMV, DAU, etc.)\n\n2. CALCULATE GROWTH RATES where prior period data is available (YoY, QoQ)\n\n3. IDENTIFY TRENDS — what is improving, what is deteriorating\n\n4. FLAG RISKS:\n   - Revenue concentration (>20% from one customer)\n   - Declining margins\n   - Increasing debt\n   - Negative cash flow from operations\n   - Unusual accounting items\n   - Management language: are they hedging more than before?\n\n5. EARNINGS QUALITY signals:\n   - Revenue recognition concerns\n   - Large increases in accounts receivable relative to revenue\n   - Inventory buildups\n   - One-time items inflating earnings\n\n6. MANAGEMENT SENTIMENT — positive, cautious, or concerning based on language used\n\nOutput strict JSON:\n{\n  "company": "company name",\n  "period": "Q1 2026 or FY 2025 etc",\n  "overall_assessment": "Positive|Neutral|Negative",\n  "key_metrics": {\n    "revenue": { "value": 0, "unit": "M USD", "yoy_growth": null, "qoq_growth": null },\n    "gross_margin": { "value": 0, "unit": "%" },\n    "operating_margin": { "value": 0, "unit": "%" },\n    "net_income": { "value": 0, "unit": "M USD" },\n    "eps_diluted": { "value": 0, "unit": "USD" },\n    "free_cash_flow": { "value": 0, "unit": "M USD" }\n  },\n  "operational_kpis": {},\n  "positives": ["list of strengths"],\n  "negatives": ["list of concerns"],\n  "risk_flags": ["list of specific risk signals"],\n  "earnings_quality": "High|Medium|Low",\n  "management_sentiment": "Positive|Cautious|Concerning",\n  "investment_summary": "2-3 sentence investment-grade summary"\n}',
    E'## Financial Report Analyser\n\nExtracts KPIs, identifies trends, and generates investment-grade summaries from financial reports.\n\n### Input\nPaste any financial document:\n```json\n{ "input": "[Earnings release or financial statement text]" }\n```\n\n### Works With\n- Earnings press releases\n- 10-K and 10-Q SEC filings\n- Annual reports\n- Investor presentations\n\n### Output\n- All key financial metrics with YoY/QoQ growth\n- Operational KPIs extracted\n- Risk flags and earnings quality signals\n- Investment-grade summary paragraph\n\n### ⚠️ Disclaimer\nThis analysis is for informational purposes only and does not constitute investment advice.',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "Financial report text (earnings release, 10-K, annual report)", "maxLength": 32000}}}',
    '{"type": "object", "required": ["key_metrics", "investment_summary"], "properties": {"key_metrics": {"type": "object"}, "positives": {"type": "array"}, "negatives": {"type": "array"}, "investment_summary": {"type": "string"}}}',
    ARRAY['financial_analysis', 'kpi_extraction', 'earnings_analysis', 'risk_assessment'],
    ARRAY['text'], ARRAY['json'],
    1432, 1398, 7100,
    4.9, 156, 87.6,
    '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  -- ─────────────────────────────────────────────────────────────────────────
  -- AGENT 10: AI Prompt Optimiser
  -- Category: productivity | Model: Claude Sonnet 4 | Pricing: free
  -- ─────────────────────────────────────────────────────────────────────────
  INSERT INTO agents (
    seller_id, name, slug, description, long_description, category,
    tags, status, is_featured, is_verified, pricing_model,
    price_per_call, free_calls_per_month,
    model_name, max_tokens, temperature,
    system_prompt, documentation,
    input_schema, output_schema,
    capability_tags, input_types, output_types,
    total_executions, successful_executions, average_latency_ms,
    average_rating, total_reviews, composite_score,
    is_top_rated, version
  ) VALUES (
    v_seller_id,
    'AI Prompt Optimiser',
    'ai-prompt-optimiser',
    'Rewrites and improves prompts for Claude, GPT, Gemini, and other LLMs. Applies prompt engineering best practices to dramatically improve output quality and consistency.',
    'The AI Prompt Optimiser takes any rough prompt and transforms it into a precision-engineered system prompt that produces dramatically better results. It applies battle-tested prompt engineering techniques: role specification, chain-of-thought activation, output format constraints, few-shot examples, edge case handling, and tone calibration. Returns the optimised prompt with an explanation of every change made and why. Works for system prompts, user prompts, and RAG instruction prompts.',
    'productivity',
    ARRAY['prompts', 'prompt-engineering', 'LLM', 'optimisation', 'AI'],
    'active', false, true, 'free',
    0, 0,
    'claude-sonnet-4-20250514', 4096, 0.4,
    E'You are a world-class prompt engineer who has optimised thousands of prompts for production AI systems at Fortune 500 companies and startups.\n\nYou understand the full spectrum of prompt engineering techniques:\n- Role specification (who the model should be)\n- Chain-of-thought activation (step-by-step reasoning)\n- Output format constraints (JSON, markdown, specific structure)\n- Few-shot examples (showing vs. telling)\n- Negative constraints (what NOT to do)\n- Edge case handling (what to do when input is ambiguous or missing)\n- Tone and style calibration\n- Context injection patterns\n- Self-consistency techniques\n- RAG instruction patterns\n\nWhen given a rough prompt:\n\n1. IDENTIFY the intent and use case\n2. IDENTIFY weaknesses: what will go wrong with the original prompt?\n3. APPLY appropriate techniques to fix each weakness\n4. PRODUCE an optimised prompt\n5. EXPLAIN each change made and why\n6. ESTIMATE improvement in output quality (percentage)\n\nOutput strict JSON:\n{\n  "original_prompt": "the prompt as provided",\n  "use_case": "inferred use case",\n  "weaknesses_identified": [\n    {\n      "issue": "what is wrong",\n      "impact": "how this hurts output quality"\n    }\n  ],\n  "techniques_applied": ["list of prompt engineering techniques used"],\n  "optimised_prompt": "the improved prompt",\n  "changes_explained": [\n    {\n      "change": "what was changed",\n      "reason": "why this improves results"\n    }\n  ],\n  "estimated_improvement": "20-40% better consistency",\n  "tips": ["additional tips for using this prompt effectively"]\n}',
    E'## AI Prompt Optimiser\n\nTransforms rough prompts into precision-engineered prompts using proven techniques.\n\n### Input\n```json\n{\n  "input": "Summarise this document for me. Be concise."\n}\n```\n\n### Output\n```json\n{\n  "use_case": "Document summarisation",\n  "weaknesses_identified": [\n    {\n      "issue": "No role specification",\n      "impact": "Model defaults to generic assistant mode"\n    },\n    {\n      "issue": "Ambiguous output format",\n      "impact": "Inconsistent structure across runs"\n    }\n  ],\n  "optimised_prompt": "You are an expert analyst specialising in concise document summarisation.\\n\\nWhen given a document:\\n1. Identify the 3-5 most important points\\n2. Write a 2-sentence executive summary\\n3. List key findings as bullet points\\n4. Note any action items or decisions\\n\\nFormat as JSON: { \\"summary\\": \\"..\\", \\"key_points\\": [], \\"action_items\\": [] }",\n  "estimated_improvement": "60-80% improvement in consistency"\n}\n```\n\n### Works For\n- System prompts for any LLM (Claude, GPT, Gemini)\n- User-turn prompts\n- RAG instruction prompts\n- Agent pipeline node prompts',
    '{"type": "object", "required": ["input"], "properties": {"input": {"type": "string", "description": "The prompt you want to optimise (system prompt or user prompt)", "maxLength": 8000}}}',
    '{"type": "object", "required": ["optimised_prompt"], "properties": {"optimised_prompt": {"type": "string"}, "changes_explained": {"type": "array"}, "estimated_improvement": {"type": "string"}}}',
    ARRAY['prompt_engineering', 'prompt_optimisation', 'llm_improvement'],
    ARRAY['text'], ARRAY['json'],
    7821, 7734, 2600,
    4.9, 689, 93.8,
    true, '1.0.0'
  )
  ON CONFLICT (slug) DO NOTHING;

  RAISE NOTICE 'Agent seeding complete. 10 agents inserted (or skipped if slugs already exist).';

END $$;

-- =============================================================================
-- Verify: Count seeded agents
-- =============================================================================
SELECT
  name,
  category,
  pricing_model,
  status,
  composite_score,
  is_verified,
  is_featured
FROM agents
WHERE slug IN (
  'deep-research-agent',
  'ai-code-reviewer',
  'meeting-intelligence-agent',
  'legal-contract-risk-scanner',
  'sql-query-builder',
  'support-ticket-classifier',
  'structured-data-extractor',
  'linkedin-post-generator',
  'financial-report-analyser',
  'ai-prompt-optimiser'
)
ORDER BY composite_score DESC;
