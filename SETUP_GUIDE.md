# NetDesign AI — MCP Setup Guide

> Connect Claude, ChatGPT, or any AI assistant to a production-grade network design engine.
> Design, validate, simulate, and generate configs through plain English.

---

## What You Get

Once connected, just describe what you need:

> *"Design a 2-spine 8-leaf Cisco NX-OS DC fabric with EVPN/VXLAN, OSPF underlay,
> 3 tenant VRFs (PROD, DEV, STORAGE), validate all policies, simulate a spine failure,
> and generate production-ready configs."*

The AI calls the MCP tools behind the scenes and returns:
- Complete IP addressing plan (loopbacks, P2P /31 links, VTEP pool)
- VLAN/VNI table with route-targets and anycast gateways
- BGP design with community colouring scheme
- Policy validation (15 rules — BLOCK / FAIL / WARN / AUTO_FIX)
- Failure simulation with BFS partition detection
- Deployment confidence score (0-100) + go/no-go decision
- Full device configs ready to copy-paste

---

## Prerequisites

- **Python 3.10 or higher** (3.11, 3.12, 3.13 all work)
- **Git**
- **Claude Desktop** (for Option A) — [download here](https://claude.ai/download)

---

## Option A — Claude Desktop (Recommended)

### 1. Clone the repository

```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation/backend
```

### 2. Set up Python environment

**Using uv (fastest — recommended):**
```bash
# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh   # Mac/Linux
# Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# Create virtual environment and install dependencies
uv venv .venv --python 3.13
uv pip install --python .venv/bin/python "mcp[cli]>=1.0.0" jinja2 pydantic python-dotenv rich
```

**Using pip (if you already have Python 3.10+):**
```bash
python3 -m venv .venv
source .venv/bin/activate          # Mac/Linux
# .venv\Scripts\activate           # Windows
pip install -r requirements.txt
```

### 3. Find your Claude Desktop config

| Operating System | Config file location |
|---|---|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

If the file doesn't exist, create it.

### 4. Add the MCP server

Open the config file and add the `mcpServers` block.

**macOS example** (replace `/Users/YOUR_NAME` with your actual home directory):

```json
{
  "mcpServers": {
    "netdesign-ai": {
      "command": "/Users/YOUR_NAME/Network-Automation/backend/.venv/bin/python",
      "args": [
        "/Users/YOUR_NAME/Network-Automation/backend/mcp_server.py",
        "--transport",
        "stdio",
        "--log-level",
        "WARNING"
      ],
      "env": {
        "PYTHONPATH": "/Users/YOUR_NAME/Network-Automation/backend",
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

**Windows example** (replace `C:\Users\YOUR_NAME` with your actual path):

```json
{
  "mcpServers": {
    "netdesign-ai": {
      "command": "C:\\Users\\YOUR_NAME\\Network-Automation\\backend\\.venv\\Scripts\\python.exe",
      "args": [
        "C:\\Users\\YOUR_NAME\\Network-Automation\\backend\\mcp_server.py",
        "--transport",
        "stdio",
        "--log-level",
        "WARNING"
      ],
      "env": {
        "PYTHONPATH": "C:\\Users\\YOUR_NAME\\Network-Automation\\backend",
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

> **Already have other MCP servers?** Just add the `"netdesign-ai": {...}` block
> inside your existing `"mcpServers": {}` object.

### 5. Restart Claude Desktop

Fully quit (Cmd+Q / Alt+F4) and reopen. Look for the **🔨 hammer icon** in the
chat input bar. Click it — you should see all NetDesign AI tools listed.

### 6. Test it

Paste any of these prompts into Claude Desktop:

```
List available network products for a GPU cluster use case.
```

```
Design a campus network for a 300-person company, 3 floors, Cisco Catalyst 9k,
802.1X, VoIP, guest WiFi. Generate IOS-XE configs.
```

```
Use the full_automation_pipeline tool to design a 2-spine 8-leaf Arista EOS
DC fabric with EVPN/VXLAN, OSPF underlay, 3 tenant VRFs.
Validate, simulate a spine failure, and gate the deployment.
```

---

## Option B — ChatGPT (Custom GPT via SSE)

### 1. Run the MCP server in SSE mode

On a server or your local machine with port 8001 accessible:

```bash
cd Network-Automation/backend
source .venv/bin/activate
python mcp_server.py --transport sse --host 0.0.0.0 --port 8001
```

Or with Docker:
```bash
docker run -d \
  --name netdesign-mcp \
  -p 8001:8001 \
  -e PYTHONUNBUFFERED=1 \
  -v $(pwd):/app \
  python:3.13-slim \
  bash -c "pip install 'mcp[cli]' jinja2 pydantic rich && python /app/backend/mcp_server.py --transport sse --host 0.0.0.0 --port 8001"
```

### 2. Create a Custom GPT

1. Go to [chat.openai.com](https://chat.openai.com) → **Explore GPTs** → **Create**
2. In the **Configure** tab → click **Add actions**
3. Set the schema URL to: `http://YOUR_SERVER_IP:8001/openapi.json`
4. Authentication: **None** (or Bearer token if behind a proxy)
5. Save the GPT

### 3. Add this system prompt to your Custom GPT

```
You are a network design expert powered by NetDesign AI.

When a user describes a network requirement, always call design_network() first
to parse their intent and generate the design. Then:
- Call validate_policies() to check for issues
- Call simulate_failure() with the first spine to test resilience
- Call check_deployment_gate() to get the confidence score and go/no-go
- Only call generate_configs() if the gate approves deployment

For quick end-to-end requests, use full_automation_pipeline() in one call.

Always show the confidence score and gate_decision to the user before configs.
Format configs in code blocks. Be concise with IP plans — show tables, not prose.
```

---

## Option C — Python / LangChain / Any Framework

```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    params = StdioServerParameters(
        command="python3",
        args=["/path/to/Network-Automation/backend/mcp_server.py"],
        env={"PYTHONPATH": "/path/to/Network-Automation/backend"}
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # List tools
            tools = await session.list_tools()
            for t in tools.tools:
                print(t.name)

            # Design a network
            result = await session.call_tool("design_network", {
                "description": "2 Arista spines, 8 SONiC TOR, 64 H100 GPUs, RoCEv2 lossless"
            })
            print(result.content[0].text)

asyncio.run(main())
```

---

## Available Tools (12 total)

| Tool | What it does |
|---|---|
| `design_network` | NL description → IP plan, VLAN/VNI, BGP design, topology |
| `generate_configs` | Design state → device configs (NX-OS/EOS/SONiC/IOS-XE/JunOS) |
| `validate_policies` | 15-rule policy check (BLOCK/FAIL/WARN/AUTO_FIX/INFO) |
| `simulate_failure` | Device failure → partition detection, BGP impact, remediation |
| `simulate_link_failure_tool` | Link failure → ECMP paths, alternate routes |
| `check_deployment_gate` | Confidence score (0-100) + APPROVED/CONDITIONAL/BLOCKED |
| `get_ip_plan` | Loopbacks, P2P links, VTEP pool, H100 session IPs |
| `get_vlan_plan` | VLAN/VNI table with L3VNI, VRF, RT, anycast gateway |
| `get_bgp_topology` | ASNs, peer graph, communities, Mermaid diagram |
| `get_topology_graph` | Adjacency graph, SPOF risk, Mermaid diagram |
| `list_products` | Filterable product catalogue (7 platforms) |
| `full_automation_pipeline` | All of the above in one call |

---

## Troubleshooting

**Hammer icon not showing in Claude Desktop**
- Make sure you fully quit and reopened Claude Desktop (not just closed the window)
- Check the config file path is exactly right — even one typo breaks it
- Verify the Python path exists: `ls /path/to/.venv/bin/python`

**"Module not found" errors**
- Make sure `PYTHONPATH` in the config points to the `backend/` folder
- Re-run the pip install step inside the `.venv`

**Server starts but tools return errors**
- The policy/design engines have full fallback logic — errors are returned as `{"ok": false, "error": "..."}` not crashes
- Run manually to see logs: `PYTHONPATH=backend .venv/bin/python backend/mcp_server.py --log-level DEBUG`

**Windows path issues**
- Use double backslashes `\\` in the JSON config or forward slashes `/` — both work

---

## Links

- **Live Demo:** https://amit33-design.github.io/Network-Automation/
- **GitHub:** https://github.com/Amit33-design/Network-Automation
- **MCP Protocol docs:** https://modelcontextprotocol.io

---

*NetDesign AI is source-available under the [NDAL v1.0](LICENSE) license. Free for personal/evaluation use. Commercial use requires a paid license — contact amit.tiwari.dev@gmail.com.*
