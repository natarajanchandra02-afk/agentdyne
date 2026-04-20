export const runtime = 'edge'

/**
 * GET /api/pipelines/templates
 *
 * Returns pre-built pipeline template goals.
 * Each template has a goal string sent to /api/composer, plus metadata.
 * Templates are static — no DB needed.
 *
 * Used by the pipeline builder's "Start from template" panel.
 */

import { NextResponse } from "next/server"

export interface PipelineTemplate {
  id:          string
  title:       string
  description: string
  goal:        string
  category:    string
  icon:        string
  tags:        string[]
  difficulty:  "starter" | "intermediate" | "advanced"
  estimatedNodes: number
}

const TEMPLATES: PipelineTemplate[] = [
  {
    id:          "support-automation",
    title:       "Support Ticket Automation",
    description: "Classify incoming support tickets by urgency and category, then draft personalised replies",
    goal:        "Classify incoming customer support tickets by urgency (critical/high/medium/low) and issue category, then draft a personalised, empathetic reply that addresses the specific issue and suggests next steps",
    category:    "customer_support",
    icon:        "🎧",
    tags:        ["classification", "email", "support"],
    difficulty:  "starter",
    estimatedNodes: 3,
  },
  {
    id:          "document-intelligence",
    title:       "Document Intelligence",
    description: "Extract structured data from documents and generate an executive summary",
    goal:        "Extract key structured data (entities, dates, amounts, action items) from a document, validate the extracted data for completeness, then generate a concise executive summary with key findings and recommended actions",
    category:    "data_analysis",
    icon:        "📄",
    tags:        ["extraction", "summarization", "nlp"],
    difficulty:  "starter",
    estimatedNodes: 3,
  },
  {
    id:          "content-pipeline",
    title:       "Content Generation Pipeline",
    description: "Research a topic, generate a structured article, and optimise it for SEO",
    goal:        "Research a given topic and gather key facts and insights, then write a well-structured 800-word article with an engaging introduction and clear sections, finally optimise the content for SEO by suggesting meta title, meta description, and keyword-rich headings",
    category:    "content",
    icon:        "✍️",
    tags:        ["research", "writing", "seo"],
    difficulty:  "intermediate",
    estimatedNodes: 4,
  },
  {
    id:          "lead-enrichment",
    title:       "Lead Enrichment",
    description: "Enrich company leads with intelligence and score their fit",
    goal:        "Given a company name and website, research the company to extract industry, size, tech stack and recent news, then score the lead fit on a scale of 1-10 based on ideal customer profile criteria, and finally draft a personalised cold outreach email",
    category:    "sales",
    icon:        "🎯",
    tags:        ["research", "scoring", "email", "sales"],
    difficulty:  "intermediate",
    estimatedNodes: 4,
  },
  {
    id:          "code-review",
    title:       "Automated Code Review",
    description: "Review code for bugs, security issues, and style problems",
    goal:        "Analyse submitted code for logical bugs and edge cases, then check for security vulnerabilities and injection risks, then evaluate code style and suggest refactoring improvements, and finally produce a structured code review report with severity ratings",
    category:    "coding",
    icon:        "🔍",
    tags:        ["code", "security", "review"],
    difficulty:  "intermediate",
    estimatedNodes: 4,
  },
  {
    id:          "data-quality",
    title:       "Data Quality Pipeline",
    description: "Validate, clean and enrich a dataset",
    goal:        "Validate a dataset for completeness, format consistency and outliers, then clean the data by normalising formats and filling missing values with sensible defaults, then enrich each record with additional derived fields, and produce a data quality report with before/after statistics",
    category:    "data_analysis",
    icon:        "🧹",
    tags:        ["data", "validation", "cleaning"],
    difficulty:  "advanced",
    estimatedNodes: 5,
  },
]

export async function GET() {
  return NextResponse.json({
    templates: TEMPLATES,
    count:     TEMPLATES.length,
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  })
}
