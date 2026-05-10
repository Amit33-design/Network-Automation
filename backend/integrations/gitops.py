"""
GitOps integration — commit generated configs to a Git repository.

Supports GitHub (default), GitLab, and Bitbucket via HTTPS token auth.

Config keys:
  repo_url      — HTTPS clone URL (e.g. https://github.com/acme/network-configs)
  token         — Personal Access Token or Deploy Key with write access
  branch        — Target branch (default: "main")
  base_path     — Directory within repo for configs (default: "configs/")
  author_name   — Git commit author name (default: "NetDesign AI")
  author_email  — Git commit author email (default: "netdesign@ci")
  create_pr     — "true" to open a PR instead of pushing directly (GitHub only)
  pr_base       — Base branch for PR (default: "main")
"""

from __future__ import annotations
import logging
import os
import tempfile
import shutil
from pathlib import Path
from typing import Any
import httpx

log = logging.getLogger("netdesign.integrations.gitops")


async def _get_config(org_id: str) -> dict | None:
    try:
        from db import _SessionLocal
        from models import IntegrationConfig
        from sqlalchemy import select
        if not _SessionLocal:
            return None
        async with _SessionLocal() as s:
            row = await s.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.org_id == org_id,
                    IntegrationConfig.provider == "gitops",
                    IntegrationConfig.enabled == True,
                )
            )
            cfg = row.scalar_one_or_none()
            return cfg.config if cfg else None
    except Exception:
        return None


async def commit_configs(
    org_id: str,
    design_id: str,
    design_name: str,
    configs: dict[str, str],   # {hostname: config_text}
    commit_message: str = "",
) -> dict[str, str]:
    """
    Write configs to the Git repository.
    Returns {"commit_sha": "...", "pr_url": "...", "branch": "..."} or {"error": "..."}.
    """
    cfg = await _get_config(org_id)
    if not cfg:
        return {"error": "GitOps not configured for this org"}

    try:
        import git  # gitpython
    except ImportError:
        return {"error": "gitpython not installed — pip install gitpython"}

    repo_url  = cfg["repo_url"]
    token     = cfg["token"]
    branch    = cfg.get("branch", "main")
    base_path = cfg.get("base_path", "configs/").rstrip("/") + "/"
    author    = git.Actor(
        cfg.get("author_name", "NetDesign AI"),
        cfg.get("author_email", "netdesign@ci"),
    )
    create_pr = cfg.get("create_pr", "false").lower() == "true"
    msg       = commit_message or f"chore(netdesign): update configs for design '{design_name}'"

    # Inject token into URL for HTTPS auth
    if "://" in repo_url:
        proto, rest = repo_url.split("://", 1)
        auth_url = f"{proto}://netdesign:{token}@{rest}"
    else:
        auth_url = repo_url

    work_branch = f"netdesign/{design_id[:8]}" if create_pr else branch

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            repo = git.Repo.clone_from(auth_url, tmpdir, branch=branch, depth=1)
        except Exception as exc:
            return {"error": f"Git clone failed: {exc}"}

        if create_pr and work_branch != branch:
            repo.git.checkout("-b", work_branch)

        # Write config files
        written: list[str] = []
        for hostname, config_text in configs.items():
            safe_name = hostname.replace("/", "_").replace(" ", "_")
            rel_path  = f"{base_path}{design_name}/{safe_name}.conf"
            full_path = Path(tmpdir) / rel_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(config_text, encoding="utf-8")
            written.append(rel_path)

        repo.index.add(written)
        if not repo.index.diff("HEAD") and not repo.untracked_files:
            return {"commit_sha": repo.head.commit.hexsha, "branch": work_branch, "pr_url": "", "note": "no changes"}

        commit = repo.index.commit(msg, author=author, committer=author)

        try:
            origin = repo.remote("origin")
            if create_pr:
                origin.push(refspec=f"{work_branch}:{work_branch}")
            else:
                origin.push()
        except Exception as exc:
            return {"error": f"Git push failed: {exc}"}

        result: dict[str, str] = {"commit_sha": commit.hexsha, "branch": work_branch, "pr_url": ""}

        if create_pr:
            pr_url = await _open_github_pr(cfg, work_branch, branch, msg, design_name)
            result["pr_url"] = pr_url

        return result


async def _open_github_pr(
    cfg: dict,
    head: str,
    base: str,
    title: str,
    design_name: str,
) -> str:
    """Create a GitHub Pull Request and return its URL."""
    repo_url = cfg["repo_url"]
    token    = cfg["token"]

    # Extract owner/repo from URL
    # https://github.com/owner/repo.git → owner/repo
    path = repo_url.split("github.com/")[-1].removesuffix(".git")
    if "/" not in path:
        return ""

    try:
        async with httpx.AsyncClient(
            base_url="https://api.github.com",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=10.0,
        ) as client:
            body = {
                "title": title,
                "head":  head,
                "base":  base,
                "body": (
                    f"## NetDesign AI — Config Update\n\n"
                    f"**Design:** {design_name}\n"
                    f"**Branch:** `{head}` → `{base}`\n\n"
                    f"_Automated PR opened by NetDesign AI._"
                ),
                "draft": False,
            }
            resp = await client.post(f"/repos/{path}/pulls", json=body)
            if resp.status_code in (200, 201):
                return resp.json().get("html_url", "")
            log.warning("GitHub PR creation returned %s: %s", resp.status_code, resp.text[:200])
            return ""
    except Exception as exc:
        log.warning("GitHub PR creation failed: %s", exc)
        return ""
