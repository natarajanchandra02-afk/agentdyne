# AgentDyne SDK Publishing Guide
## April 2026 — Founder Reference

This document covers how to publish all four AgentDyne SDKs, plus Docker Hub and
HuggingFace. Follow this checklist on every release.

---

## Release Checklist (run for every version bump)

- [ ] Bump version in all 4 SDKs (TypeScript, Python, Ruby, Go)
- [ ] Update `CHANGELOG.md`
- [ ] Run all test suites locally
- [ ] Build artifacts and verify they import correctly
- [ ] Push git tag
- [ ] Publish TypeScript → npm
- [ ] Publish Python → PyPI
- [ ] Publish Ruby → RubyGems
- [ ] Push Go tag → pkg.go.dev auto-indexes
- [ ] Push Docker image → Docker Hub
- [ ] Update HuggingFace Space (if needed)
- [ ] Update `docs-client.tsx` install commands if version changed
- [ ] Post to Discord `#announcements` and Twitter/X

---

## 1. TypeScript → npm (@agentdyne/sdk)

### One-time setup
```bash
# Create npmjs.com account + org at npmjs.com/org/create
npm login
npm login --scope=@agentdyne
```

### Disk space fix (OL9 / small servers)
```bash
npm cache clean --force
df -h   # verify space freed
```

### Build & publish
```bash
cd sdk/typescript

# Install only what's needed (tsc + types — no bundler)
npm install --save-dev typescript @types/node

# Typecheck — must be zero errors
npm run typecheck

# Build (emits ESM + types to dist/)
npm run build

# Publish publicly under the @agentdyne scope
npm publish --access public
```

### Bump version
```bash
npm version patch   # 1.0.0 → 1.0.1  (bug fix)
npm version minor   # 1.0.0 → 1.1.0  (new non-breaking feature)
npm version major   # 1.0.0 → 2.0.0  (breaking change)
git push --follow-tags
npm publish --access public
```

### GitHub Actions — auto-publish on tag
```yaml
# .github/workflows/publish-ts.yml
name: Publish TypeScript SDK
on:
  push:
    tags: ['sdk-ts-v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: |
          cd sdk/typescript
          npm ci
          npm run typecheck
          npm run build
          npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Test before publishing (dry run)
```bash
npm publish --dry-run --access public
```

---

## 2. Python → PyPI (pip install agentdyne)

### One-time setup
```bash
pip install build twine

# Create account at pypi.org
# Create API token: pypi.org/manage/account/token/
# Scope it to the "agentdyne" project for security
```

### Configure credentials (recommended)
```ini
# ~/.pypirc
[distutils]
  index-servers = pypi

[pypi]
  username = __token__
  password = pypi-AgXXXXXXXXXXXXXXXXXXX
```

### Build & publish
```bash
cd sdk/python

# Build both wheel (.whl) and source dist (.tar.gz)
python -m build

# Validate package before uploading
twine check dist/*

# Upload to PyPI
twine upload dist/*
```

### Bump version
```
# Edit sdk/python/pyproject.toml:
# version = "1.0.1"

python -m build
twine upload dist/*
```

### Test first on TestPyPI
```bash
twine upload --repository testpypi dist/*
pip install --index-url https://test.pypi.org/simple/ agentdyne==1.0.1
python -c "from agentdyne import AgentDyne; print('OK')"
```

### Run tests
```bash
cd sdk/python
pip install pytest
pip install -e .
pytest tests/ -v
```

### GitHub Actions
```yaml
# .github/workflows/publish-python.yml
name: Publish Python SDK
on:
  push:
    tags: ['sdk-py-v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: |
          pip install build twine pytest
          cd sdk/python
          pip install -e .
          pytest tests/ -v
          python -m build
          twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

---

## 3. Ruby → RubyGems (gem install agentdyne)

### One-time setup
```bash
# Create account at rubygems.org
gem signin
# Or set API key:
# rubygems.org → Profile → API Keys → New API Key (scope: push)
```

### Configure credentials
```bash
mkdir -p ~/.gem
echo ":rubygems_api_key: YOUR_API_KEY" > ~/.gem/credentials
chmod 0600 ~/.gem/credentials
```

### Build & publish
```bash
cd sdk/ruby

# Build the gem
gem build agentdyne.gemspec
# → creates agentdyne-1.0.0.gem

# Push to RubyGems
gem push agentdyne-1.0.0.gem
```

### Bump version
```ruby
# Edit sdk/ruby/lib/agentdyne/version.rb:
# VERSION = "1.0.1"
```
```bash
gem build agentdyne.gemspec
gem push agentdyne-1.0.1.gem
```

### Run tests
```bash
cd sdk/ruby
bundle install
bundle exec rspec
```

### GitHub Actions
```yaml
# .github/workflows/publish-ruby.yml
name: Publish Ruby SDK
on:
  push:
    tags: ['sdk-ruby-v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
      - run: |
          mkdir -p ~/.gem
          printf -- "---\n:rubygems_api_key: %s\n" "$RUBYGEMS_API_KEY" > ~/.gem/credentials
          chmod 0600 ~/.gem/credentials
          cd sdk/ruby
          gem build agentdyne.gemspec
          gem push *.gem
        env:
          RUBYGEMS_API_KEY: ${{ secrets.RUBYGEMS_API_KEY }}
```

---

## 4. Go → pkg.go.dev (go get github.com/agentdyne/go)

### How Go modules work
Go modules are served directly from GitHub — **no registry account needed**.
`pkg.go.dev` auto-indexes any public GitHub repo that has a `go.mod` file
once it's tagged with a semver tag.

### Steps to release
```bash
# Ensure go.mod module path matches your GitHub repo
# module github.com/agentdyne/go

cd sdk/go

# Verify it compiles and passes vet
go build ./...
go vet ./...

# Tag the release (multi-module repo style)
git tag sdk/go/v1.0.0
git push origin sdk/go/v1.0.0
```

### Force pkg.go.dev to index immediately
```bash
# Warm the module proxy (optional — usually auto-detected within minutes)
curl "https://proxy.golang.org/github.com/agentdyne/go/@v/v1.0.0.info"
curl "https://sum.golang.org/lookup/github.com/agentdyne/go@v1.0.0"
```

### Users install with
```bash
go get github.com/agentdyne/go@latest
# or pin to version:
go get github.com/agentdyne/go@v1.0.0
```

### Bump version
```bash
# Just push a new tag — no build step needed
git tag sdk/go/v1.0.1
git push origin sdk/go/v1.0.1
```

### GitHub Actions
```yaml
# .github/workflows/publish-go.yml
name: Test & Tag Go SDK
on:
  push:
    tags: ['sdk/go/v*']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: |
          cd sdk/go
          go build ./...
          go vet ./...
          go test ./... -v
      # Tag already pushed — pkg.go.dev picks it up automatically
```

---

## 5. Docker Hub — agentdyne/platform

### Why Docker?
Enterprise and self-hosted customers need to run AgentDyne inside their own VPC.
A Docker image removes all infrastructure dependency on Cloudflare/Vercel.

### Dockerfile (create at platform/Dockerfile)
```dockerfile
# Stage 1 — deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false

# Stage 2 — build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3 — runner (minimal)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# next.config.js must have: output: 'standalone'
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

### Add to next.config.js
```js
// platform/next.config.js
const nextConfig = {
  output: 'standalone',  // add this line
  // ...existing config
}
```

### Build & push
```bash
docker login

# Build
docker build \
  -t agentdyne/platform:1.0.0 \
  -t agentdyne/platform:latest \
  platform/

# Push both tags
docker push agentdyne/platform:1.0.0
docker push agentdyne/platform:latest
```

### docker-compose.yml for self-hosters
```yaml
version: "3.8"
services:
  agentdyne:
    image: agentdyne/platform:latest
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_SUPABASE_URL:       "https://your-project.supabase.co"
      NEXT_PUBLIC_SUPABASE_ANON_KEY:  "eyJ..."
      SUPABASE_SERVICE_ROLE_KEY:      "eyJ..."
      ANTHROPIC_API_KEY:              "sk-ant-..."
      STRIPE_SECRET_KEY:              "sk_live_..."
      STRIPE_WEBHOOK_SECRET:          "whsec_..."
      NEXT_PUBLIC_APP_URL:            "https://your-domain.com"
    restart: unless-stopped
```

### GitHub Actions — auto-push on release tag
```yaml
# .github/workflows/publish-docker.yml
name: Publish Docker Image
on:
  push:
    tags: ['v*']

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: agentdyne
          password: ${{ secrets.DOCKER_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ./platform
          push: true
          tags: |
            agentdyne/platform:latest
            agentdyne/platform:${{ github.ref_name }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## 6. HuggingFace Spaces — Live Playground Demo

### Why HuggingFace?
- 50M+ ML/AI developers discover tools there
- Free hosted compute for a demo — zero infrastructure cost
- Strong SEO — HuggingFace pages rank well on Google
- Acts as a top-of-funnel for agentdyne.com signups

### What to deploy
A lightweight playground that showcases:
- Live execution of 3–5 featured free agents
- Streaming output displayed in real time
- Clear CTA: "Get your API key at agentdyne.com"

### Option A — Gradio (fastest, 30 minutes)
```bash
pip install huggingface_hub gradio requests
huggingface-cli login
```

```python
# app.py
import gradio as gr
import requests
import json

FEATURED_AGENTS = {
    "Email Summariser":   "email-summarizer-pro",
    "Code Reviewer":      "code-review-agent",
    "Data Analyst":       "data-analyst-agent",
}

def run_agent(agent_name: str, user_input: str, api_key: str) -> str:
    if not api_key.startswith("agd_"):
        return "Please enter a valid AgentDyne API key (starts with agd_)"
    agent_id = FEATURED_AGENTS[agent_name]
    try:
        r = requests.post(
            f"https://api.agentdyne.com/v1/agents/{agent_id}/execute",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"input": user_input},
            timeout=60,
        )
        data = r.json()
        if r.status_code != 200:
            return f"Error: {data.get('error', 'Unknown error')}"
        output = data.get("output", "")
        if isinstance(output, dict):
            return json.dumps(output, indent=2)
        return str(output)
    except Exception as e:
        return f"Request failed: {e}"

demo = gr.Interface(
    fn=run_agent,
    inputs=[
        gr.Dropdown(choices=list(FEATURED_AGENTS.keys()), label="Agent", value="Email Summariser"),
        gr.Textbox(lines=6, label="Input", placeholder="Paste your text here..."),
        gr.Textbox(label="API Key", type="password", placeholder="agd_..."),
    ],
    outputs=gr.Textbox(lines=12, label="Output"),
    title="AgentDyne Playground",
    description=(
        "Try AgentDyne agents live. "
        "Get your free API key at **[agentdyne.com](https://agentdyne.com)**."
    ),
    examples=[
        ["Email Summariser", "Hi team, I wanted to follow up on the Q4 results. Revenue was up 40% YoY. Let's discuss in Friday's standup.", "agd_demo"],
    ],
    theme=gr.themes.Soft(),
)

demo.launch()
```

### Deploy to HuggingFace
```bash
# Create the Space
huggingface-cli repo create agentdyne-playground --type space --space_sdk gradio

# Clone and push
git clone https://huggingface.co/spaces/agentdyne/agentdyne-playground
cp app.py agentdyne-playground/
cd agentdyne-playground
git add . && git commit -m "Initial playground"
git push
```

### Option B — Next.js Space (more control)
Use a minimal Next.js app deployed as a Docker Space on HuggingFace.
Set `HF_SPACE_SDK=docker` in Space settings.

---

## 7. Other Registries to Consider

| Registry | What | Priority | When |
|----------|------|----------|------|
| **GitHub Packages** | Mirror of `@agentdyne/sdk` for enterprise GitHub customers | Medium | After 100+ GitHub stars |
| **VS Code Marketplace** | AgentDyne extension — test agents from your IDE | High | Q3 2026 |
| **Homebrew** | `brew install agentdyne` CLI tool | Medium | After CLI is built |
| **conda-forge** | Python SDK for data science / Jupyter users | Low | After 1K PyPI downloads |
| **JSR (Deno registry)** | `deno add @agentdyne/sdk` for Deno users | Low | Deno 2 momentum |

---

## Version Naming Convention

```
Platform release:    v1.2.3
TypeScript tag:      sdk-ts-v1.2.3
Python tag:          sdk-py-v1.2.3
Ruby tag:            sdk-ruby-v1.2.3
Go tag:              sdk/go/v1.2.3
Docker tag:          agentdyne/platform:1.2.3
```

---

## Current Package Links (once published)

| SDK | Registry URL |
|-----|-------------|
| TypeScript | https://www.npmjs.com/package/@agentdyne/sdk |
| Python | https://pypi.org/project/agentdyne/ |
| Ruby | https://rubygems.org/gems/agentdyne |
| Go | https://pkg.go.dev/github.com/agentdyne/go |
| Docker | https://hub.docker.com/r/agentdyne/platform |
| HuggingFace | https://huggingface.co/spaces/agentdyne/agentdyne-playground |
