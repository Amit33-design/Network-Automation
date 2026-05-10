# NetDesign AI — Enterprise Roadmap

**Last updated:** 2026-05-09
**Audience:** Engineering leads, product management, enterprise sales

---

## Delivered: Phase 1 — Trust & Compliance ✅

> Goal: Pass a security review and regulated-industry POC.

| Item | File(s) | Status |
|---|---|---|
| OIDC/SSO (Okta, Azure AD, Google, Ping) | `backend/auth.py` | ✅ Done |
| TOTP/MFA (setup, enable, verify, disable) | `backend/auth.py`, `backend/routers/users.py` | ✅ Done |
| API key authentication (nd-key-...) | `backend/auth.py` | ✅ Done |
| Multi-tenancy: Org + OrgMember models | `backend/models.py` | ✅ Done |
| org_id scoping on all resources | `backend/models.py` | ✅ Done |
| Human approval gate (pending → approved/rejected) | `backend/routers/approvals.py` | ✅ Done |
| 4-eyes policy (requester cannot self-approve) | `backend/routers/approvals.py` | ✅ Done |
| Approval TTL + auto-expire + escalate | `backend/routers/approvals.py` | ✅ Done |
| Audit trail → PostgreSQL (dual-write file + DB) | `backend/audit.py` | ✅ Done |
| SIEM webhook (Splunk HEC / Elastic / custom) | `backend/audit.py` | ✅ Done |
| Audit JSONL export endpoint | `backend/routers/orgs.py` | ✅ Done |
| Org CRUD + member invite/remove/role-change | `backend/routers/orgs.py` | ✅ Done |
| SSO domain auto-join for orgs | `backend/routers/users.py` | ✅ Done |
| User profile + password change | `backend/routers/users.py` | ✅ Done |

**New env vars required (Phase 1):**
```
JWT_SECRET=<random-64-char>
OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_CLIENT_ID=<app-id>
OIDC_CLIENT_SECRET=<secret>
OIDC_PROVIDER=azure          # okta | azure | google | ping
OIDC_REDIRECT_URI=https://app.netdesign.ai/api/auth/oidc/callback
SIEM_WEBHOOK_URL=https://splunk.internal/services/collector/event
SIEM_TOKEN=<splunk-hec-token>
APPROVAL_TTL_HOURS=72
APP_URL=https://app.netdesign.ai
```

**New pip deps (Phase 1):** `passlib[bcrypt]`, `pyotp`, `authlib`

---

## Delivered: Phase 2 — Integration & Workflow ✅

> Goal: Fit into the existing enterprise toolchain without process disruption.

| Item | File(s) | Status |
|---|---|---|
| Slack webhook — approval + deploy notifications | `backend/integrations/slack.py` | ✅ Done |
| Microsoft Teams — Adaptive Card notifications | `backend/integrations/teams.py` | ✅ Done |
| ServiceNow — create/update/close Change Requests | `backend/integrations/servicenow.py` | ✅ Done |
| Jira — create issues, transition, comment | `backend/integrations/jira.py` | ✅ Done |
| Netbox IPAM — prefix allocation + device sync | `backend/integrations/netbox.py` | ✅ Done |
| GitOps — commit configs to Git + GitHub PR | `backend/integrations/gitops.py` | ✅ Done |
| Integration config CRUD + test endpoint | `backend/routers/integrations.py` | ✅ Done |
| draw.io topology export (Cisco icon shapes) | `backend/export/drawio.py` | ✅ Done |
| Runbook / SOP Markdown auto-generation | `backend/export/runbook.py` | ✅ Done |
| PDF runbook export (weasyprint optional) | `backend/export/runbook.py` | ✅ Done |
| Export endpoints (/api/export/drawio, /runbook) | `backend/routers/export.py` | ✅ Done |

**Integration config is stored per-org in `integration_configs` table.**
Configure via `POST /api/integrations` with `{"provider": "slack", "config": {"webhook_url": "..."}}`.

**New env vars (Phase 2):** None required — all config stored in DB per-org.
**New pip deps (Phase 2):** `gitpython==3.1.43` (optional: `weasyprint`, `markdown` for PDF)

---

## Planned: Phase 3 — Intelligence & Scale

> Target: Q1 2027 (3 months)
> Goal: Justify "AI" in the product name with real ML and handle 1K+ device designs.

### 3.1 ML-based RCA Engine

**What:** Replace keyword-matching RCA with a trained classifier that correlates:
- Live Prometheus/gNMI telemetry (BGP prefixes, PFC drops, interface errors, CPU)
- Recent deployment history (did a config change precede this symptom?)
- Topology graph (blast radius — which devices are affected downstream?)
- Historical incident corpus (embeddings from past tickets)

**How to build:**
1. Instrument the existing `rca/engine.py` to log all analyses + outcomes to a training table
2. Collect 6 months of labeled incidents (symptom → confirmed root cause)
3. Train a `scikit-learn` gradient boosting classifier + TF-IDF vectorizer on symptom text
4. Layer a topology-aware confidence booster: if the affected device is a spine, escalate confidence
5. Expose a `POST /api/rca/analyze` endpoint that uses the model; fall back to keyword KB if model unavailable

**Files to create/modify:**
- `backend/rca/engine.py` — add model inference path
- `backend/rca/trainer.py` — offline model training script
- `backend/rca/corpus.py` — incident corpus loader
- `backend/rca/models/` — serialised model artefacts (joblib)

**Dependencies:** `scikit-learn`, `sentence-transformers` (embeddings), `joblib`

---

### 3.2 Telemetry Anomaly Detection

**What:** Baseline each metric over a 30-day rolling window; alert when current value is > 3σ above baseline.

**Metrics to baseline:**
- BGP prefix count per peer (drop = session reset or prefix withdraw)
- Interface error rate per port (spike = hardware issue)
- CPU utilisation per device (sustained high = control-plane storm)
- PFC pause frame count (spike = RoCEv2 congestion event)
- Queue drop count per class (QoS misconfiguration)

**How to build:**
1. Extend `telemetry/gnmi_collector.py` to write raw metrics to a TimescaleDB hypertable
2. Create `telemetry/anomaly.py` with a rolling Z-score calculator using Pandas
3. Wire `telemetry/alerting.py` to call anomaly.py and publish alerts via Slack/Teams/PagerDuty
4. Add `GET /api/telemetry/anomalies` endpoint returning active anomalies per device

**Files to create/modify:**
- `backend/telemetry/anomaly.py` — Z-score baseline + alert evaluation
- `backend/telemetry/timescale.py` — TimescaleDB writer
- `backend/telemetry/alerting.py` — extend with PagerDuty/OpsGenie webhook

**Dependencies:** `pandas`, `timescaledb` (Postgres extension), `psycopg2`

---

### 3.3 Cost Estimation / Bill of Materials

**What:** From the capacity plan (spine count, leaf count, firewall model), generate:
- Line-item BOM with list prices from a vendor price catalogue
- CapEx estimate with ±30% range
- TCO projection over 3 and 5 years (including maintenance/support)
- Budget-vs-actual comparison against the `budget_tier` selected in Step 1

**How to build:**
1. Create `backend/bom/catalogue.py` — YAML-driven price catalogue (Cisco, Arista, Juniper, NVIDIA)
2. Create `backend/bom/engine.py` — maps design capacity to SKUs + calculates price
3. Add `POST /api/bom/estimate` endpoint
4. Add BOM export to Excel (openpyxl) at `GET /api/export/bom`
5. Surface in frontend Step 3 (Topology) as a "Cost Estimate" card

**Files to create:**
- `backend/bom/catalogue.yaml` — vendor price list (updated quarterly)
- `backend/bom/catalogue.py` — catalogue loader
- `backend/bom/engine.py` — BOM generator
- `backend/routers/bom.py` — REST endpoints

**Dependencies:** `openpyxl` (Excel export)

---

### 3.4 Async Design Computation (Scale to 1K+ devices)

**What:** Move config generation and policy evaluation off the main request thread.
A 1,000-device config generation blocks the API for ~60 seconds today.

**How to build:**
1. Create a Celery task `jobs/config_gen_job.py` that runs `generate_all_configs()` async
2. `POST /api/generate-configs` returns a `job_id` immediately; client polls `GET /api/jobs/{id}`
3. Results are stored in Redis with a 24-hour TTL; downloaded via `GET /api/jobs/{id}/result`
4. WebSocket `WS /ws/jobs/{id}` streams progress (device count, % complete)
5. Client-side: replace synchronous config preview with a progress bar + async download

**Files to create/modify:**
- `backend/jobs/config_gen_job.py` — Celery task
- `backend/routers/jobs.py` — job status + result endpoints
- `src/js/configgen.js` — poll job endpoint instead of blocking
- `index.html` — add progress bar for async generation

---

### 3.5 Compliance Policy Packs

**What:** Pre-built YAML policy packs that map design rules to compliance framework controls.

**Packs to build (Phase 3):**
- **PCI-DSS 4.0** — network segmentation, encryption in transit, logging requirements
- **NIST SP 800-53 Rev 5** — SC-7 (boundary protection), AU-12 (audit logging), IA-5 (auth)
- **CIS Controls v8** — network monitoring, access control, data protection
- **HIPAA Technical Safeguards** — transmission security, audit controls

**How to build:**
1. Add a `compliance_pack` field to policy rules YAML (maps rule → framework control ID)
2. Create `backend/compliance/engine.py` — evaluates design against a chosen pack
3. Generate a compliance report: which controls PASS, FAIL, or need manual review
4. Export as PDF evidence package (for auditors)

**Files to create:**
- `backend/policies/compliance/pci_dss_4.yaml`
- `backend/policies/compliance/nist_800_53.yaml`
- `backend/policies/compliance/cis_v8.yaml`
- `backend/compliance/engine.py`
- `backend/routers/compliance.py`

---

### 3.6 High Availability Deployment

**What:** Document and implement HA architecture for the backend.

**Architecture:**
```
                     ┌──────────────────┐
                     │   Load Balancer  │ (nginx / AWS ALB)
                     └────────┬─────────┘
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌─────────┐     ┌─────────┐     ┌─────────┐
       │  API-1  │     │  API-2  │     │  API-3  │  (FastAPI, stateless)
       └────┬────┘     └────┬────┘     └────┬────┘
            └───────────────┼───────────────┘
                            ▼
            ┌───────────────────────────────┐
            │  PostgreSQL (primary + 1 read  │
            │  replica, synchronous repl.)   │
            └───────────────────────────────┘
            ┌───────────────────────────────┐
            │  Redis Sentinel / Redis Cluster│  (session cache, job queue)
            └───────────────────────────────┘
            ┌───────────────────────────────┐
            │  Celery workers (N replicas)  │
            └───────────────────────────────┘
```

**Deliverables:**
- `docker-compose.ha.yml` — multi-instance compose for dev/staging
- `ops/kubernetes/` — Helm chart for Kubernetes deployment
- `ops/postgres-ha/` — Patroni config for Postgres HA
- Backup/restore runbook for the design database
- Disaster recovery (DR) procedure with RTO/RPO targets

---

## Planned: Phase 4 — Market Expansion

> Target: Q2–Q3 2027 (6 months)
> Goal: Double the addressable market and enable channel/reseller revenue.

### 4.1 Multi-Cloud Network Design

**What:** Generate network configs for cloud-native networking:

| Cloud | Features |
|---|---|
| AWS | VPC, subnet, route tables, Security Groups, Transit Gateway, Direct Connect |
| Azure | VNet, NSG, Route Table, ExpressRoute, Azure Firewall policy |
| GCP | VPC, Firewall Rules, Cloud Router, Interconnect, Cloud NAT |

**Output formats:**
- Terraform HCL (provider: aws, azurerm, google)
- AWS CDK (Python)
- ARM/Bicep templates (Azure)
- Pulumi (multi-cloud)

**Files to create:**
- `backend/cloud/aws.py` — AWS resource generator
- `backend/cloud/azure.py` — Azure resource generator
- `backend/cloud/gcp.py` — GCP resource generator
- `backend/cloud/terraform.py` — Terraform HCL serialiser
- New frontend step or use-case type: "Cloud Network"

---

### 4.2 Design Collaboration (Async Review)

**What:** Multi-user design review workflow, similar to GitHub PR reviews on network designs.

**Features:**
- **Comments** on any section of a design (step, device, IP plan)
- **@mentions** notify team members via Slack/email
- **Design review** — request review from specific users; required reviews before approval
- **Design history** — timeline of changes with diff view
- **Branching** — fork a design, modify, merge back (compare changes)

**How to build:**
1. Add `DesignComment` model (design_id, section, author, body, resolved)
2. Add `DesignReview` model (design_id, reviewer, status: pending/approved/changes_requested)
3. WebSocket channel per design for real-time comment notifications
4. Frontend: comment bubbles on each step card; review panel in sidebar

---

### 4.3 Self-Service Customer Portal

**What:** Eliminate the "Contact Us" sales bottleneck for Professional and Enterprise tiers.

**Features:**
- Trial license: 30-day Enterprise trial, self-provisioned, auto-converted to paid
- Billing: Stripe integration (card on file, invoicing for Enterprise)
- License management: view tier, usage, renewal date; upgrade in-app
- Usage dashboard: designs created, configs generated, deployments run (for license enforcement)
- Support tickets: open/track/close via in-app portal

**Files to create:**
- `backend/billing/stripe.py` — Stripe webhook handler + subscription management
- `backend/routers/billing.py` — subscription endpoints
- `backend/routers/portal.py` — customer portal endpoints
- Frontend: `/account` page with usage, billing, license, support

---

### 4.4 Vendor API Integrations (Controller-Level)

**What:** Direct API integration with network management controllers — not just SSH config push.

| Controller | Capability |
|---|---|
| Cisco Catalyst Center (DNA Center) | Push intent-based policies, provision devices, get telemetry |
| Juniper Apstra | Push intent, validate, get telemetry via Apstra API |
| Palo Alto Panorama | Push security policy, commit, verify |
| Fortinet FortiManager | Push firewall policy, install to device groups |
| Arista CloudVision | Push config via CVP API, get streaming telemetry |
| VMware NSX-T | Create segments, DFW rules, T0/T1 gateways |

**How to build:**
- `backend/controllers/catalyst_center.py` — DNA Center REST API client
- `backend/controllers/apstra.py` — Apstra GraphQL client
- `backend/controllers/panorama.py` — Panorama XML API client
- `backend/controllers/cloudvision.py` — CVP gRPC/REST client
- Extend `backend/routers/deployments.py` to route to controller vs Nornir based on platform

---

### 4.5 Kubernetes / Cloud-Native Network Design

**What:** Extend intent-driven design to Kubernetes CNI and service mesh.

**Capabilities:**
- Generate Calico/Cilium network policies from security intent
- Generate Istio/Linkerd service mesh config from traffic intent
- Validate Kubernetes NetworkPolicy against design intent
- Detect CNI misconfigurations (e.g. CIDR overlap with node subnet)

**Files to create:**
- `backend/k8s/calico.py` — Calico NetworkPolicy generator
- `backend/k8s/cilium.py` — CiliumNetworkPolicy generator
- `backend/k8s/istio.py` — Istio VirtualService + AuthorizationPolicy generator
- New frontend use-case type: "Kubernetes Networking"

---

### 4.6 White-Label / OEM API

**What:** Allow MSPs and SI partners to embed NetDesign AI under their own brand.

**Deliverables:**
- White-label config: custom logo, colour scheme, product name via env vars
- Partner API: scoped API keys for reseller-created sub-orgs
- Revenue share: usage-based billing reported back to NetDesign AI
- Partner portal: onboard sub-tenants, view usage, manage licenses
- SLA definition document (99.9% uptime, 4-hour critical support response)

---

## Environment Variable Reference (All Phases)

```bash
# ── Core ──────────────────────────────────────────────────────────────────────
JWT_SECRET=                    # Required in production — 64 random chars
JWT_EXPIRY_HOURS=8             # Token lifetime
CORS_ORIGINS=https://app.netdesign.ai
DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/netdesign
REDIS_URL=redis://redis:6379/0
ADMIN_USER=admin
ADMIN_PASS=changeme

# ── Phase 1: SSO / MFA ────────────────────────────────────────────────────────
OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_PROVIDER=azure            # okta | azure | google | ping
OIDC_REDIRECT_URI=https://app.netdesign.ai/api/auth/oidc/callback
APPROVAL_TTL_HOURS=72          # How long pending approvals stay open
APP_URL=https://app.netdesign.ai

# ── Phase 1: Audit / SIEM ─────────────────────────────────────────────────────
SIEM_WEBHOOK_URL=              # Splunk HEC URL or Elastic endpoint
SIEM_TOKEN=                    # Splunk HEC token / Elastic API key
AUDIT_LOG_PATH=/var/log/netdesign/audit.jsonl   # File fallback

# ── Phase 2: Integrations (configured per-org in DB, not env) ─────────────────
# Slack, Teams, ServiceNow, Jira, Netbox, GitOps config is stored in
# integration_configs table. Configure via POST /api/integrations.

# ── Phase 3: ML / Telemetry ───────────────────────────────────────────────────
TIMESCALEDB_URL=               # For telemetry metrics (Phase 3)
GNMI_DEVICES=                  # hostname:ip[:port[:platform]] comma-sep
PAGERDUTY_ROUTING_KEY=         # PagerDuty Events v2 (Phase 3)

# ── Phase 4: Cloud / Billing ──────────────────────────────────────────────────
STRIPE_SECRET_KEY=             # Stripe billing (Phase 4)
STRIPE_WEBHOOK_SECRET=         # Stripe webhook validation
AWS_ACCESS_KEY_ID=             # For cloud network design (Phase 4)
AWS_SECRET_ACCESS_KEY=
AZURE_TENANT_ID=               # For Azure network design (Phase 4)
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
```

---

## Dependency Matrix

| Phase | New pip packages | Approx. install size |
|---|---|---|
| P1 | `passlib[bcrypt]`, `pyotp`, `authlib` | ~15 MB |
| P2 | `gitpython`, `weasyprint`*, `markdown`* | ~80 MB (*optional) |
| P3 | `scikit-learn`, `sentence-transformers`, `pandas`, `openpyxl` | ~400 MB |
| P4 | `stripe`, `boto3`, `azure-mgmt-network`, `google-cloud-compute` | ~200 MB |

---

## API Surface Summary (After P1 + P2)

```
POST   /api/auth/token                    local login
POST   /api/auth/totp-verify              MFA second step
GET    /api/auth/oidc/login               start SSO flow
GET    /api/auth/oidc/callback            SSO callback
POST   /api/auth/switch-org              swap org context

GET    /api/users/me                      own profile
PATCH  /api/users/me                      update profile / password
POST   /api/users/me/totp/setup           generate TOTP secret
POST   /api/users/me/totp/enable          activate TOTP
DELETE /api/users/me/totp                 disable TOTP
POST   /api/users/me/api-keys             generate API key
DELETE /api/users/me/api-keys             revoke API key

POST   /api/orgs                          create org
GET    /api/orgs                          list my orgs
GET    /api/orgs/{id}                     org detail
POST   /api/orgs/{id}/members/invite      invite member
GET    /api/orgs/{id}/members             list members
PATCH  /api/orgs/{id}/members/{uid}       change role
DELETE /api/orgs/{id}/members/{uid}       remove member
GET    /api/orgs/{id}/audit               audit log (paged)
GET    /api/orgs/{id}/audit/export        JSONL export

POST   /api/approvals                     request approval
GET    /api/approvals                     list approvals
GET    /api/approvals/{id}                detail
POST   /api/approvals/{id}/approve        approve
POST   /api/approvals/{id}/reject         reject
POST   /api/approvals/{id}/escalate       escalate + extend TTL
DELETE /api/approvals/{id}                cancel

GET    /api/integrations                  list configured
POST   /api/integrations                  upsert config
DELETE /api/integrations/{provider}       remove
POST   /api/integrations/test/{provider}  send test
POST   /api/integrations/netbox/sync-devices
GET    /api/integrations/netbox/prefix
POST   /api/integrations/gitops/commit

POST   /api/export/drawio                 topology diagram
POST   /api/export/runbook                Markdown SOP
POST   /api/export/runbook/pdf            PDF SOP
```

---

*NetDesign AI — Enterprise Roadmap v1.0 | 2026-05-09*
