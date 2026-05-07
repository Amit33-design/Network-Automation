# NetDesign AI — MCP Integration Guide

Complete setup instructions for connecting NetDesign AI to Claude Desktop, ChatGPT, Python agents, and LangChain.

---

## Claude Desktop (stdio transport — recommended)

### Prerequisites

- Python 3.10+ (`python3 --version`)
- Claude Desktop ([download](https://claude.ai/download))
- Repository cloned locally

### 1 — Install dependencies

```bash
cd /path/to/Network-Automation/backend
pip install -r requirements.txt
```

### 2 — Edit Claude Desktop config

| OS | Config path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

A ready-to-edit config is in `backend/claude_desktop_config.json`. Copy it and adjust the path:

```json
{
  "mcpServers": {
    "netdesign-ai": {
      "command": "python3",
      "args": [
        "/FULL/PATH/TO/Network-Automation/backend/mcp_server.py",
        "--transport", "stdio"
      ],
      "cwd": "/FULL/PATH/TO/Network-Automation/backend",
      "env": {
        "PYTHONPATH": "/FULL/PATH/TO/Network-Automation/backend",
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

Replace `/FULL/PATH/TO/Network-Automation` with your actual clone path (e.g. `/Users/yourname/Network-Automation`).

### 3 — Restart Claude Desktop

Fully quit and reopen. A **hammer icon 🔨** appears in the chat input — click it to confirm **NetDesign AI** tools are listed.

### 4 — Example prompts

```
Design a 2-spine 8-leaf Arista EOS DC fabric with EVPN/VXLAN, OSPF underlay,
and three tenant VRFs: PROD, DEV, STORAGE. Validate policies and generate configs.
```

```
Design a GPU cluster for 64× NVIDIA H100s across 8 racks.
SONiC TOR switches, Arista spines, RoCEv2 lossless, PFC priority 3+4.
Run failure simulation on spine-1 and give me the deployment gate decision.
```

```
Use full_automation_pipeline to design, validate, simulate, and gate
a Cisco NX-OS DC fabric with EVPN/VXLAN and tenant VRFs for PROD, DEV, STORAGE.
```

---

## ChatGPT — Custom GPT / GPT Actions (SSE transport)

### 1 — Start the MCP SSE server

```bash
cd backend
python3 mcp_server.py --transport sse --host 0.0.0.0 --port 8001
```

The endpoint is now at `http://YOUR_IP:8001/sse`.

For public access, put this behind an HTTPS reverse proxy (nginx, Caddy) — OpenAI's servers require HTTPS.

Or use Docker Compose (already included):

```bash
docker compose up mcp
# MCP SSE server runs at http://localhost:8001
```

### 2 — Create a Custom GPT

1. Go to [chat.openai.com](https://chat.openai.com) → **Explore GPTs** → **Create**
2. In the **Configure** tab → **Add actions**
3. Import schema from: `http://YOUR_IP:8001/openapi.json` (FastMCP generates this automatically)
4. Set authentication to **None** (or add an API key header if you configure one)
5. Save and test

### 3 — Recommended system prompt

```
You are a network design expert powered by NetDesign AI.
When users describe a network requirement, call design_network() first, then
validate_policies(), simulate_failure(), and check_deployment_gate().
Always show the confidence score and gate decision before generating configs.
Use full_automation_pipeline() for end-to-end requests.
```

---

## Python SDK / Direct MCP Client

```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    server_params = StdioServerParameters(
        command="python3",
        args=["/path/to/backend/mcp_server.py"],
        env={"PYTHONPATH": "/path/to/backend"}
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = await session.list_tools()
            print([t.name for t in tools.tools])

            result = await session.call_tool(
                "design_network",
                {"description": "2 Arista spines, 8 SONiC TOR switches, 64 H100 GPUs, RoCEv2 lossless"}
            )
            print(result.content[0].text)

asyncio.run(main())
```

---

## LangChain + LangGraph

```python
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from mcp import StdioServerParameters

server_params = StdioServerParameters(
    command="python3",
    args=["/path/to/backend/mcp_server.py"],
    env={"PYTHONPATH": "/path/to/backend"}
)

tools  = load_mcp_tools(server_params)
model  = ChatAnthropic(model="claude-opus-4-7")
agent  = create_react_agent(model, tools)

result = agent.invoke({
    "messages": "Design a DC fabric for a fintech company with PCI-DSS compliance, 4 spines, 16 leaves."
})
```

---

## Available MCP Tools (20 total)

| Category | Tools |
|---|---|
| **Design** | `design_network`, `get_ip_plan`, `get_vlan_plan`, `get_bgp_topology`, `get_topology_graph` |
| **Explain** | `explain_design` |
| **Configs** | `generate_configs` (NX-OS · EOS · SONiC · IOS-XE · JunOS + 9 policy domains) |
| **Validation** | `validate_policies` (15 rules — BLOCK / FAIL / WARN / AUTO_FIX / INFO) |
| **Simulation** | `simulate_failure`, `simulate_link_failure_tool` |
| **Gate** | `check_deployment_gate` (0–100 confidence, APPROVED / CONDITIONAL / BLOCKED) |
| **Monitoring** | `run_health_check`, `diagnose_network`, `get_issue_detail`, `troubleshoot`, `monitor_network` |
| **Quality** | `run_static_analysis` (26 checks, 5 domains, 0–100 score) |
| **Post-deploy** | `run_post_checks` |
| **Automation** | `full_automation_pipeline` |
| **Catalogue** | `list_products` (40+ SKUs) |

**Resources:** `netdesign://products`, `netdesign://architectures/{uc}`, `netdesign://policy-rules`, `netdesign://community-scheme`

**Prompts:** `design_campus_network`, `design_dc_fabric`, `design_gpu_cluster`, `validate_and_deploy`
