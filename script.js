/**
 * PharmaChain Frontend — app.js
 * ============================================================
 * Connects to FastAPI backend at BASE_URL.
 * Handles 3 flows:
 *   1. /api/manufacture  → Blockchain register + QR generation
 *   2. /api/handover     → AI risk scoring + Blockchain checkpoint
 *   3. /api/verify       → Blockchain auth + AI journey graph + history
 *
 * STATUS CODE MAP (from Solidity enum):
 *   0 = Manufactured | 1 = InTransit | 2 = AtRetailer
 *   3 = Sold | 4 = Recalled | 5 = Expired | 6 = Verified
 * ============================================================
 */

// ─────────────────────────────────────────────
// 0. CONFIGURATION
// ─────────────────────────────────────────────
const BASE_URL = "http://localhost:8000"; // Change to deployed URL if needed

// Solidity Status enum → human label + CSS class
const STATUS_MAP = {
  0: { label: "MANUFACTURED",  cls: "status-manufactured" },
  1: { label: "IN TRANSIT",    cls: "status-transit"       },
  2: { label: "AT RETAILER",   cls: "status-retailer"      },
  3: { label: "SOLD",          cls: "status-sold"           },
  4: { label: "RECALLED ⚠️",   cls: "status-recalled"      },
  5: { label: "EXPIRED",       cls: "status-expired"        },
  6: { label: "VERIFIED ✅",   cls: "status-verified"       },
};

// Risk thresholds for AI output colouring
const RISK_LEVELS = {
  LOW:    { max: 0.35, label: "LOW RISK — SAFE TO PROCEED",    cls: "risk-low"    },
  MEDIUM: { max: 0.65, label: "MEDIUM RISK — INSPECT BATCH",   cls: "risk-medium" },
  HIGH:   { max: 1.00, label: "HIGH RISK — FLAG FOR REVIEW",   cls: "risk-high"   },
};


// ─────────────────────────────────────────────
// 1. TAB NAVIGATION
// ─────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;

    // Deactivate all tabs + panels
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => {
      p.classList.add("hidden");
      p.classList.remove("active");
    });

    // Activate selected
    btn.classList.add("active");
    const panel = document.getElementById(`tab-${target}`);
    panel.classList.remove("hidden");
    panel.classList.add("active");

    // Reset all result cards when switching tabs
    hideResults();
  });
});

function hideResults() {
  document.querySelectorAll(".result-card").forEach(card => card.classList.add("hidden"));
  document.getElementById("journey-block")?.classList.add("hidden");
  document.getElementById("history-block")?.classList.add("hidden");
}


// ─────────────────────────────────────────────
// 2. UTILITY HELPERS
// ─────────────────────────────────────────────

/** Show a brief toast notification */
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  const msg   = document.getElementById("toast-msg");
  toast.className = `toast toast-${type}`;
  msg.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

/** Toggle loading state on a submit button */
function setLoading(formId, isLoading) {
  const btn    = document.querySelector(`#${formId} button[type="submit"]`);
  const text   = btn.querySelector(".btn-text");
  const loader = btn.querySelector(".btn-loader");
  btn.disabled = isLoading;
  text.classList.toggle("hidden", isLoading);
  loader.classList.toggle("hidden", !isLoading);
}

/** Render a status badge using the Solidity enum map */
function renderStatus(el, statusCode) {
  const s = STATUS_MAP[statusCode] ?? { label: `UNKNOWN (${statusCode})`, cls: "status-unknown" };
  el.textContent = s.label;
  el.className = `result-val status-badge ${s.cls}`;
}

/** Truncate a long tx hash for display but keep full as title tooltip */
function truncateHash(hash) {
  if (!hash || hash.length < 20) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

/** Format MongoDB ISO timestamp to readable local string */
function formatTimestamp(isoString) {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

/** Determine risk level object from a 0–1 score */
function getRiskLevel(score) {
  if (score <= RISK_LEVELS.LOW.max)    return RISK_LEVELS.LOW;
  if (score <= RISK_LEVELS.MEDIUM.max) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.HIGH;
}

/** Generic fetch wrapper with error handling */
async function apiPost(endpoint, body) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    // FastAPI raises HTTPException with { detail: "..." }
    throw new Error(data.detail || `Server error ${response.status}`);
  }

  return data;
}

/** Animate a number counter from 0 to target (for risk score display) */
function animateCounter(el, target, decimals = 2, duration = 800) {
  const start     = performance.now();
  const startVal  = 0;
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const current  = startVal + (target - startVal) * progress;
    el.textContent = current.toFixed(decimals);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Animate risk bar width */
function animateRiskBar(barEl, score) {
  barEl.style.width = "0%";
  setTimeout(() => {
    barEl.style.width = `${(score * 100).toFixed(1)}%`;
  }, 100);
}


// ─────────────────────────────────────────────
// 3. MANUFACTURE FLOW
//    POST /api/manufacture
//    Body:  { batch_id, medicine_name, location }
//    Returns: { status, qr_url, tx_hash }
// ─────────────────────────────────────────────
document.getElementById("manufacture-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const body = {
    batch_id:      form.batch_id.value.trim(),
    medicine_name: form.medicine_name.value.trim(),
    location:      form.location.value.trim(),
  };

  // Basic GPS format validation
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(body.location)) {
    showToast("GPS format must be: lat,lng  e.g. 13.0827,80.2707", "error");
    return;
  }

  setLoading("manufacture-form", true);

  try {
    const data = await apiPost("/api/manufacture", body);

    // ── Blockchain Output ─────────────────────────────
    const txEl = document.getElementById("res-tx-hash");
    txEl.textContent = truncateHash(data.tx_hash);
    txEl.title       = data.tx_hash; // Full hash on hover

    // Add Sepolia Etherscan link
    txEl.innerHTML = `
      <a href="https://sepolia.etherscan.io/tx/${data.tx_hash}" 
         target="_blank" 
         rel="noopener noreferrer"
         class="tx-link">
        ${truncateHash(data.tx_hash)} ↗
      </a>`;

    // Status
    const statusEl = document.getElementById("res-status");
    statusEl.textContent  = data.status === "success" ? "REGISTERED ✅" : data.status.toUpperCase();
    statusEl.className    = `result-val status-badge ${data.status === "success" ? "status-verified" : "status-recalled"}`;

    // ── QR Code (generated by backend via qrcode lib) ─
    const qrImg = document.getElementById("res-qr-img");
    // Backend serves from: /qrcodes/{batch_id}.png
    qrImg.src    = `${BASE_URL}${data.qr_url}`;
    qrImg.alt    = `QR Code for ${body.batch_id}`;
    qrImg.onerror = () => {
      qrImg.style.display = "none";
      showToast("QR image could not load — check server static files config.", "warning");
    };

    // Download button
    const dlBtn   = document.getElementById("res-qr-download");
    dlBtn.href     = `${BASE_URL}${data.qr_url}`;
    dlBtn.download = `${body.batch_id}_QR.png`;

    // Show result card
    document.getElementById("manufacture-result").classList.remove("hidden");
    showToast(`Batch ${body.batch_id} registered on Sepolia!`, "success");

  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
    console.error("[Manufacture Error]", err);
  } finally {
    setLoading("manufacture-form", false);
  }
});


// ─────────────────────────────────────────────
// 4. HANDOVER FLOW
//    POST /api/handover
//    Body:  { batch_id, new_location, role_index (int) }
//    Returns: { status, risk_score (float 0–1), tx_hash }
//
//    AI ENGINE OUTPUT: risk_score
//      → Computed by PharmaAI.predict_risk()
//      → Factors: distance_km, days_to_expiry,
//                 weight_deviation, status (role)
// ─────────────────────────────────────────────
document.getElementById("handover-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const body = {
    batch_id:     form.batch_id.value.trim(),
    new_location: form.new_location.value.trim(),
    role_index:   parseInt(form.role_index.value), // Must be int: 1 or 2
  };

  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(body.new_location)) {
    showToast("GPS format must be: lat,lng  e.g. 28.6139,77.2090", "error");
    return;
  }

  if (isNaN(body.role_index)) {
    showToast("Please select a recipient role.", "error");
    return;
  }

  setLoading("handover-form", true);

  try {
    const data = await apiPost("/api/handover", body);

    // ── AI Output: Risk Score ──────────────────────────
    const riskScore  = parseFloat(data.risk_score) || 0;
    const riskLevel  = getRiskLevel(riskScore);

    const riskValEl  = document.getElementById("res-risk-score");
    const riskBarEl  = document.getElementById("res-risk-bar");
    const riskVerdEl = document.getElementById("res-risk-verdict");

    // Animate the number counting up
    animateCounter(riskValEl, riskScore, 4, 900);

    // Animate the bar filling
    riskBarEl.className = `risk-bar-fill ${riskLevel.cls}`;
    animateRiskBar(riskBarEl, riskScore);

    // Verdict label
    riskVerdEl.textContent = riskLevel.label;
    riskVerdEl.className   = `risk-verdict ${riskLevel.cls}`;

    // ── Blockchain Output: TX Hash ─────────────────────
    const txEl = document.getElementById("res-ho-tx-hash");
    if (data.tx_hash) {
      txEl.innerHTML = `
        <a href="https://sepolia.etherscan.io/tx/${data.tx_hash}" 
           target="_blank" 
           rel="noopener noreferrer"
           class="tx-link">
          ${truncateHash(data.tx_hash)} ↗
        </a>`;
    } else {
      txEl.textContent = "Tx not confirmed yet";
    }

    // Status badge — role_index maps to Solidity Status enum
    const statusEl = document.getElementById("res-ho-status");
    renderStatus(statusEl, body.role_index); // 1 = InTransit, 2 = AtRetailer

    // Show result card
    document.getElementById("handover-result").classList.remove("hidden");

    const riskMsg = riskScore > 0.65
      ? `⚠️ High risk detected (${riskScore.toFixed(4)}) — Review before proceeding`
      : `Handover recorded. Risk: ${riskScore.toFixed(4)}`;
    showToast(riskMsg, riskScore > 0.65 ? "warning" : "success");

  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
    console.error("[Handover Error]", err);
  } finally {
    setLoading("handover-form", false);
  }
});


// ─────────────────────────────────────────────
// 5. VERIFY FLOW
//    POST /api/verify
//    Body:  { medicine_id, location }
//    Returns:
//      {
//        status: "verified" | "fake" | "error",
//        blockchain_data: {
//          name,            ← from getMedicineData()
//          current_location,
//          status_code      ← Solidity enum int
//        },
//        graph_url,         ← AI-generated matplotlib journey graph
//        history: [         ← MongoDB movements array
//          { role, location, risk_score, timestamp, tx_hash }
//        ]
//      }
// ─────────────────────────────────────────────
document.getElementById("verify-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const body = {
    medicine_id: form.medicine_id.value.trim(),
    location:    form.location.value.trim(),
  };

  setLoading("verify-form", true);

  // Reset previous results
  document.getElementById("verify-result").classList.add("hidden");
  document.getElementById("journey-block").classList.add("hidden");
  document.getElementById("history-block").classList.add("hidden");

  try {
    const data = await apiPost("/api/verify", body);

    // ── AUTHENTICATION VERDICT BANNER ─────────────────
    const banner   = document.getElementById("auth-banner");
    const icon     = document.getElementById("auth-icon");
    const authText = document.getElementById("auth-text");

    if (data.status === "verified") {
      banner.className   = "auth-verdict-banner auth-verified";
      icon.textContent   = "✓";
      authText.textContent = "AUTHENTIC";
    } else if (data.status === "fake") {
      banner.className   = "auth-verdict-banner auth-fake";
      icon.textContent   = "✗";
      authText.textContent = "COUNTERFEIT DETECTED";
    } else {
      // "error" or unexpected
      banner.className   = "auth-verdict-banner auth-error";
      icon.textContent   = "!";
      authText.textContent = "VERIFICATION ERROR";
    }

    // ── Blockchain Data (from getMedicineData on-chain) ─
    const bc = data.blockchain_data || {};

    document.getElementById("res-v-name").textContent     = bc.name     || "—";
    document.getElementById("res-v-location").textContent = bc.current_location || "—";

    // Render status code using the enum map
    renderStatus(document.getElementById("res-v-status"), bc.status_code);

    // ── AI Output: Journey Graph ───────────────────────
    // graph_url is returned by ai_brain.generate_journey_graph(history)
    // It's a path like "/qrcodes/journey_B-101.png" served as static
    if (data.graph_url) {
      const graphImg = document.getElementById("journey-graph-img");
      graphImg.src   = `${BASE_URL}${data.graph_url}`;
      graphImg.alt   = `Journey graph for ${body.medicine_id}`;
      graphImg.onerror = () => {
        document.getElementById("journey-block").classList.add("hidden");
      };
      document.getElementById("journey-block").classList.remove("hidden");
    }

    // ── Movement History (from MongoDB) ───────────────
    if (data.history && data.history.length > 0) {
      buildHistoryTable(data.history);
      document.getElementById("history-block").classList.remove("hidden");
    }

    // Show result card
    document.getElementById("verify-result").classList.remove("hidden");

    const toastType = data.status === "verified" ? "success"
                    : data.status === "fake"     ? "error"
                    : "warning";
    showToast(`Verification complete: ${data.status.toUpperCase()}`, toastType);

  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
    console.error("[Verify Error]", err);
  } finally {
    setLoading("verify-form", false);
  }
});

/**
 * Build the movement history table from MongoDB records.
 * Each record: { role, location, risk_score, timestamp, tx_hash }
 * risk_score is the AI-predicted float from predict_risk()
 */
function buildHistoryTable(history) {
  const tbody = document.getElementById("history-tbody");
  tbody.innerHTML = ""; // Clear previous

  history.forEach((record, index) => {
    const row         = document.createElement("tr");
    const riskScore   = parseFloat(record.risk_score) ?? 0;
    const riskLevel   = getRiskLevel(riskScore);

    // Step number pill
    const stepCell    = `<td><span class="step-pill">${index + 1}</span></td>`;

    // Role cell with icon
    const roleIcon    = record.role === "Factory"      ? "🏭"
                      : record.role === "Distributor"  ? "🚛"
                      : record.role === "Pharmacy"     ? "💊"
                      : "📦";
    const roleCell    = `<td>${roleIcon} ${record.role}</td>`;

    // Location cell
    const locCell     = `<td class="mono small">${record.location || "—"}</td>`;

    // AI Risk Score cell with coloured badge
    const riskCell    = `
      <td>
        <span class="risk-pill ${riskLevel.cls}">
          ${riskScore.toFixed(4)}
        </span>
      </td>`;

    // Timestamp cell
    const timeCell    = `<td class="small">${formatTimestamp(record.timestamp)}</td>`;

    // TX Hash cell with Etherscan link (if available)
    let txCell = `<td class="mono small">—</td>`;
    if (record.tx_hash) {
      txCell = `
        <td class="mono small">
          <a href="https://sepolia.etherscan.io/tx/${record.tx_hash}" 
             target="_blank" rel="noopener noreferrer" class="tx-link">
            ${truncateHash(record.tx_hash)} ↗
          </a>
        </td>`;
    }

    row.innerHTML = stepCell + roleCell + locCell + riskCell + timeCell + txCell;

    // Highlight recalled/high-risk rows
    if (riskScore > 0.65) row.classList.add("row-high-risk");

    tbody.appendChild(row);
  });
}


// ─────────────────────────────────────────────
// 6. TICKER BAR — Live chain feed simulation
//    In production: replace with WebSocket or
//    polling /api/events if you add that endpoint
// ─────────────────────────────────────────────
function initTicker() {
  const track = document.querySelector(".ticker-track");
  if (!track) return;

  // Clone children to create seamless loop
  const items = track.querySelectorAll(".ticker-item");
  items.forEach(item => {
    const clone = item.cloneNode(true);
    track.appendChild(clone);
  });
}

initTicker();


// ─────────────────────────────────────────────
// 7. CHAIN CONNECTION STATUS INDICATOR
//    Pings BASE_URL root to confirm backend is up
// ─────────────────────────────────────────────
async function checkBackendStatus() {
  const dot   = document.getElementById("chain-dot");
  const label = document.getElementById("chain-label");

  try {
    const res = await fetch(`${BASE_URL}/docs`, { method: "HEAD", mode: "no-cors" });
    // no-cors will succeed if server is reachable
    dot.className   = "status-dot dot-online";
    label.textContent = "SEPOLIA · ONLINE";
  } catch {
    dot.className   = "status-dot dot-offline";
    label.textContent = "BACKEND OFFLINE";
  }
}

// Check on load and every 30 seconds
checkBackendStatus();
setInterval(checkBackendStatus, 30000);


// ─────────────────────────────────────────────
// 8. KEYBOARD SHORTCUT: Enter navigates tabs
// ─────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideResults();
});