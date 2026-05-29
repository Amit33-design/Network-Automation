"use strict";

const nd = window.netdesign;  // exposed by preload.js

// ── Tier selection ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tier-card").forEach(card => {
    card.addEventListener("click", () => {
        document.querySelectorAll(".tier-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        const tier = card.dataset.tier;
        // Show license field only for paid tiers
        const licField = document.getElementById("licenseKey").closest(".field");
        licField.style.display = tier === "community" ? "none" : "block";
    });
});

// ── On load — pre-fill from saved .env ────────────────────────────────────────
(async () => {
    // Docker check
    if (nd) {
        const dockerOk = await nd.docker.available();
        if (!dockerOk) {
            document.getElementById("dockerWarning").style.display = "block";
        }

        // Pre-fill existing values
        const env = await nd.env.read();
        if (env.ADMIN_USER) document.getElementById("adminUser").value = env.ADMIN_USER;
        if (env.LICENSE_KEY && env.LICENSE_KEY.startsWith("nd.")) {
            document.getElementById("licenseKey").value = env.LICENSE_KEY;
        }

        // Pre-select tier from saved license (best-effort)
        const lic = env.LICENSE_KEY || "";
        if (lic.includes('"tier":"enterprise"') || lic.includes("enterprise")) {
            selectTier("enterprise");
        } else if (lic.includes('"tier":"professional"') || lic.includes("professional")) {
            selectTier("professional");
        }

        // If already configured, skip straight to launching
        const configured = env.ADMIN_PASS && env.ADMIN_PASS !== "change_me_admin_password_here";
        if (configured) {
            setStatus("info", "Services are starting… the UI will load automatically.");
            document.getElementById("step1").style.opacity = "0.5";
            document.getElementById("launchBtn").disabled = true;
        }
    }
})();

function selectTier(tier) {
    document.querySelectorAll(".tier-card").forEach(c => {
        c.classList.toggle("selected", c.dataset.tier === tier);
    });
}

// ── Launch ─────────────────────────────────────────────────────────────────────
async function launch() {
    const adminUser = document.getElementById("adminUser").value.trim();
    const adminPass = document.getElementById("adminPass").value.trim();
    const licenseKey = document.getElementById("licenseKey").value.trim();

    if (!adminUser) { setStatus("error", "Admin username is required."); return; }
    if (!adminPass || adminPass.length < 8) {
        setStatus("error", "Admin password must be at least 8 characters.");
        return;
    }

    setStatus("info", '<span class="spinner"></span> Saving configuration…');
    document.getElementById("launchBtn").disabled = true;

    if (nd) {
        await nd.env.write("ADMIN_USER", adminUser);
        await nd.env.write("ADMIN_PASS", adminPass);
        if (licenseKey) await nd.env.write("LICENSE_KEY", licenseKey);

        setStatus("info", '<span class="spinner"></span> Starting Docker services… (this may take 1–2 minutes on first run)');
        await nd.services.start();

        setStatus("success", "✓ NetDesign AI is starting. The interface will load automatically.");
    } else {
        // Dev mode: not running in Electron — just open the web UI
        setStatus("success", "Dev mode — open http://localhost:8080 in your browser.");
    }
}

function openDataDir() { nd && nd.app.openDataDir(); }
function openLog()     { nd && nd.app.openLogFile(); }
function openUrl(url)  { window.open(url); }

function setStatus(type, html) {
    const box = document.getElementById("statusBox");
    box.style.display = "block";
    box.className = `status ${type}`;
    box.innerHTML = html;
}
