/*
 * DawaNetwork Survey — Admin & Analytics Engine
 * Connects to Supabase, aggregates survey metrics, renders interactive charts,
 * provides participant-level logs, and exports to Excel/CSV and JSON.
 */

(function () {
  "use strict";

  // State
  let rawResponses = [];       // All loaded responses from source
  let filteredResponses = [];  // Responses after search/role filter
  let currentSource = "supabase"; // "supabase" | "local"
  let customServiceKey = sessionStorage.getItem("dawanetwork_admin_key") || sessionStorage.getItem("dawalink_admin_key") || "";
  let activeTab = "analytics"; // "analytics" | "table" | "feedback"

  // DOM Elements
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const refreshBtn = document.getElementById("btn-refresh");
  const exportCsvBtn = document.getElementById("btn-export-csv");
  const exportJsonBtn = document.getElementById("btn-export-json");
  const printBtn = document.getElementById("btn-print");
  const keyModalBtn = document.getElementById("btn-open-key-modal");

  const searchInput = document.getElementById("search-input");
  const roleFilter = document.getElementById("role-filter");
  const expFilter = document.getElementById("exp-filter");
  const btnSrcSupabase = document.getElementById("src-supabase");
  const btnSrcLocal = document.getElementById("src-local");

  const kpiTotal = document.getElementById("kpi-total");
  const kpiInterest = document.getElementById("kpi-interest");
  const kpiPaying = document.getElementById("kpi-paying");
  const kpiSubAvg = document.getElementById("kpi-sub-avg");
  const kpiTrial = document.getElementById("kpi-trial");

  const rlsAlert = document.getElementById("rls-alert");
  const analyticsContainer = document.getElementById("analytics-view");
  const tableViewContainer = document.getElementById("table-view");
  const feedbackViewContainer = document.getElementById("feedback-view");
  const responsesTableBody = document.getElementById("responses-table-body");
  const feedbackGrid = document.getElementById("feedback-grid");

  const inspectModal = document.getElementById("inspect-modal");
  const inspectModalBody = document.getElementById("inspect-modal-body");
  const inspectModalClose = document.getElementById("inspect-modal-close");

  const toast = document.getElementById("toast");

  // ---------- Toast Notification ----------

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => {
      toast.classList.remove("visible");
    }, 3200);
  }

  // ---------- PIN Auth / Gatekeeper ----------

  const PIN_KEY = "dawanetwork_admin_pin_auth";
  const loginModal = document.getElementById("login-modal");
  const pinInput = document.getElementById("pin-input");
  const pinSubmitBtn = document.getElementById("pin-submit-btn");
  const pinError = document.getElementById("pin-error");

  function checkAuth() {
    if (!loginModal) return true;
    const isAuthed = sessionStorage.getItem(PIN_KEY) === "true" || sessionStorage.getItem("dawalink_admin_pin_auth") === "true";
    if (isAuthed) {
      loginModal.style.display = "none";
      return true;
    }
    loginModal.style.display = "flex";
    return false;
  }

  if (pinSubmitBtn && pinInput) {
    pinSubmitBtn.addEventListener("click", () => {
      const val = pinInput.value.trim();
      // Default PIN is 1234 or any 4+ character password
      if (val === "112007" || val === "admin" || val.length >= 4) {
        sessionStorage.setItem(PIN_KEY, "true");
        loginModal.style.display = "none";
        initDashboard();
      } else {
        pinError.textContent = "رمز PIN غير صحيح ";
        pinError.style.display = "block";
      }
    });

    pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") pinSubmitBtn.click();
    });
  }

  // ---------- Supabase / Data Fetching ----------

  function getEffectiveKey() {
    if (customServiceKey) return customServiceKey;
    const cfg = window.SUPABASE_CONFIG || {};
    return cfg.anonKey || "";
  }

  function getEffectiveUrl() {
    const cfg = window.SUPABASE_CONFIG || {};
    return (cfg.url || "").replace(/\/+$/, "");
  }

  async function fetchFromSupabase() {
    const url = getEffectiveUrl();
    const key = getEffectiveKey();

    if (!url || !key) {
      return { ok: false, error: "missing_config", data: [] };
    }

    try {
      const endpoint = `${url}/rest/v1/survey_responses?select=*&order=submitted_at.desc`;
      const res = await fetch(endpoint, {
        method: "GET",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, error: errText || "HTTP " + res.status, data: [] };
      }

      const rows = await res.json();
      return { ok: true, data: Array.isArray(rows) ? rows : [] };
    } catch (err) {
      console.error("Supabase fetch failed:", err);
      return { ok: false, error: err.message || "network_error", data: [] };
    }
  }

  function fetchFromLocal() {
    try {
      const raw = localStorage.getItem("dawanetwork_survey_responses") || localStorage.getItem("dawalink_survey_responses") || "[]";
      const parsed = JSON.parse(raw);
      // Normalize to match DB row structure
      return parsed.map((item, idx) => ({
        id: item.id || `local-${idx + 1}`,
        submitted_at: item.submitted_at || new Date().toISOString(),
        answers: item.answers || {},
        user_agent: item.user_agent || "Local Browser"
      }));
    } catch (e) {
      console.warn("Could not read local responses:", e);
      return [];
    }
  }

  async function loadData() {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = `<span>جارٍ التحميل...</span>`;

    if (currentSource === "supabase") {
      statusDot.className = "status-dot";
      statusText.textContent = "جارٍ الاتصال بقاعدة البيانات...";

      const result = await fetchFromSupabase();

      if (result.ok) {
        rawResponses = result.data;
        statusDot.className = "status-dot online";
        statusText.textContent = `متصل بقاعدة البيانات (${rawResponses.length} رد)`;

        // Check if 0 rows returned — might be RLS
        if (rawResponses.length === 0) {
          const localCheck = fetchFromLocal();
          if (localCheck.length > 0) {
            rlsAlert.style.display = "flex";
          } else {
            // Also show RLS reminder in case test submits were made
            rlsAlert.style.display = "flex";
          }
        } else {
          rlsAlert.style.display = "none";
        }
      } else {
        statusDot.className = "status-dot offline";
        statusText.textContent = "تعذر جلب البيانات من Supabase";
        showToast("تعذر جلب البيانات: " + (result.error || "خطأ غير معروف"));
        rlsAlert.style.display = "flex";
      }
    } else {
      rawResponses = fetchFromLocal();
      statusDot.className = "status-dot offline";
      statusText.textContent = `المحفوظات المحلية المتصفح (${rawResponses.length} رد)`;
      rlsAlert.style.display = "none";
    }

    refreshBtn.disabled = false;
    refreshBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
      <span>تحديث البيانات</span>
    `;

    applyFilters();
  }

  // ---------- Filtering & Search ----------

  function applyFilters() {
    const qTerm = (searchInput.value || "").trim().toLowerCase();
    const selRole = roleFilter.value;
    const selExp = expFilter.value;

    filteredResponses = rawResponses.filter((item) => {
      const a = item.answers || {};

      // Role filter (Q1)
      if (selRole && a.q1) {
        if (!a.q1.includes(selRole)) return false;
      }

      // Experience filter (Q2)
      if (selExp && a.q2) {
        if (!a.q2.includes(selExp)) return false;
      }

      // Search term
      if (qTerm) {
        const fullText = JSON.stringify(a).toLowerCase();
        if (!fullText.includes(qTerm)) return false;
      }

      return true;
    });

    renderAllViews();
  }

  // ---------- KPI Calculations ----------

  function updateKpis() {
    const total = filteredResponses.length;
    kpiTotal.textContent = total;

    // Filter responses that actually answered the survey
    const validSurveys = filteredResponses.filter((r) => r.answers && r.answers.q1);
    const baseCount = validSurveys.length > 0 ? validSurveys.length : (total > 0 ? total : 0);

    if (baseCount === 0) {
      kpiInterest.textContent = "0%";
      kpiPaying.textContent = "0%";
      kpiSubAvg.textContent = "—";
      kpiTrial.textContent = "0%";
      return;
    }

    // 1. Interest in DawaNetwork (Q9 or Q13 positive)
    let interestedCount = 0;
    validSurveys.forEach((r) => {
      const a = r.answers || {};
      const q9 = a.q9 || "";
      const q13 = a.q13 || "";
      if (
        q9.includes("بالتأكيد") || q9.includes("غالبًا") ||
        q13.includes("بالتأكيد") || q13.includes("غالبًا")
      ) {
        interestedCount++;
      }
    });
    kpiInterest.textContent = Math.round((interestedCount / baseCount) * 100) + "%";

    // 2. Willingness to Pay Subscription (Q16)
    let payingCount = 0;
    validSurveys.forEach((r) => {
      const a = r.answers || {};
      const q16 = a.q16 || "";
      if (q16.includes("بالتأكيد") || q16.includes("غالبًا") || q16.includes("ربما")) {
        payingCount++;
      }
    });
    kpiPaying.textContent = Math.round((payingCount / baseCount) * 100) + "%";

    // 3. Average Subscription Amount (Q17)
    let sumAmounts = 0;
    let amountCount = 0;
    validSurveys.forEach((r) => {
      const a = r.answers || {};
      const q17 = a.q17 || "";
      if (typeof q17 === "string") {
        const match = q17.match(/(\d+)/);
        if (match) {
          const val = parseInt(match[1], 10);
          if (!isNaN(val) && val > 0 && val < 50000) {
            sumAmounts += val;
            amountCount++;
          }
        }
      }
    });
    if (amountCount > 0) {
      const avg = Math.round(sumAmounts / amountCount);
      kpiSubAvg.textContent = avg.toLocaleString("ar-EG") + " ج.م";
    } else {
      kpiSubAvg.textContent = "—";
    }

    // 4. Free Trial Willingness (Q22: نعم)
    let trialCount = 0;
    validSurveys.forEach((r) => {
      const a = r.answers || {};
      const q22 = a.q22 || "";
      if (q22.trim() === "نعم" || q22.includes("نعم")) {
        trialCount++;
      }
    });
    kpiTrial.textContent = Math.round((trialCount / baseCount) * 100) + "%";
  }


  function getQuestionsList() {
    if (typeof QUESTIONS !== "undefined" && Array.isArray(QUESTIONS)) return QUESTIONS;
    if (typeof window !== "undefined" && Array.isArray(window.QUESTIONS)) return window.QUESTIONS;
    return [];
  }

  // ---------- Question Analytics View ----------

  function renderAnalytics() {
    analyticsContainer.innerHTML = "";
    const total = filteredResponses.length;
    const questionsList = getQuestionsList();

    if (total === 0 || questionsList.length === 0) {
      analyticsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <div class="empty-title">لا توجد إجابات مسجلة حالياً</div>
          <div class="empty-desc">عندما يقوم الصيادلة بتعبئة الاستبيان، ستظهر الرسوم البيانية وتوزيع النسب هنا تلقائياً.</div>
        </div>
      `;
      return;
    }

    // Group questions by section
    const sections = {};
    questionsList.forEach((q) => {
      if (!sections[q.section]) sections[q.section] = [];
      sections[q.section].push(q);
    });


    Object.keys(sections).forEach((secTitle) => {
      const qList = sections[secTitle];
      const secEl = document.createElement("div");
      secEl.className = "section-group";

      const secHeader = document.createElement("div");
      secHeader.className = "section-header";
      secHeader.innerHTML = `<h2>${escapeHtml(secTitle)}</h2>`;
      secEl.appendChild(secHeader);

      qList.forEach((q) => {
        const card = renderQuestionCard(q, total);
        secEl.appendChild(card);
      });

      analyticsContainer.appendChild(secEl);
    });
  }

  function renderQuestionCard(q, totalRespondents) {
    const card = document.createElement("div");
    card.className = "question-card";

    // Header / Title
    const typeLabel = q.type === "multiple" ? "اختيار متعدد" : q.type === "subscription" ? "تحديد قيمة" : q.type === "text" ? "حقل نصي" : q.type === "longtext" ? "نص حر" : "اختيار فردي";
    card.innerHTML = `
      <div class="question-meta">
        <span class="question-badge">${q.id.toUpperCase()}</span>
        <span class="question-type-label">${typeLabel}</span>
      </div>
      <h3 class="question-text">${escapeHtml(q.text)}</h3>
    `;

    // Long text or short text question (e.g. Pharmacy name/branch or Q23)
    if (q.type === "longtext" || q.type === "text") {
      const textResponses = [];
      filteredResponses.forEach((r) => {
        const a = r.answers || {};
        const val = a[q.id];
        if (val && typeof val === "string" && val.trim()) {
          textResponses.push({ text: val.trim(), date: r.submitted_at });
        }
      });

      const body = document.createElement("div");
      if (textResponses.length === 0) {
        body.innerHTML = `<div style="color:var(--teal-light);font-size:0.86rem;">لم يُسجل أي رد نصي على هذا السؤال حتى الآن.</div>`;
      } else {
        body.innerHTML = `
          <div style="font-size:0.84rem;font-weight:600;color:var(--teal-soft);margin-bottom:10px;">
            عدد المشاركات المسجلة: ${textResponses.length} من إجمالي ${totalRespondents}
          </div>
          <div class="other-list">
            ${textResponses.map((item) => `
              <div class="other-item" style="padding:10px 14px;line-height:1.6;">
                "${escapeHtml(item.text)}"
                <div style="font-size:0.72rem;color:var(--teal-light);margin-top:4px;">${formatDateTime(item.date)}</div>
              </div>
            `).join("")}
          </div>
        `;
      }
      card.appendChild(body);
      return card;
    }


    // Single / Multiple / Subscription aggregation
    const counts = {};
    const otherValues = [];
    let answeredCount = 0;

    // Pre-populate predefined options with 0
    if (q.options) {
      q.options.forEach((opt) => {
        counts[opt] = 0;
      });
    } else if (q.periodOptions) {
      q.periodOptions.forEach((opt) => {
        counts[opt] = 0;
      });
    }

    filteredResponses.forEach((r) => {
      const a = r.answers || {};
      const ans = a[q.id];
      if (!ans) return;
      answeredCount++;

      if (q.type === "single") {
        if (typeof ans === "string" && ans.startsWith("أخرى — ")) {
          counts["أخرى"] = (counts["أخرى"] || 0) + 1;
          otherValues.push(ans.replace("أخرى — ", ""));
        } else {
          counts[ans] = (counts[ans] || 0) + 1;
        }
      } else if (q.type === "multiple") {
        // Can be comma separated string or array
        const parts = Array.isArray(ans) ? ans : String(ans).split("، ");
        parts.forEach((p) => {
          const item = p.trim();
          if (item.startsWith("أخرى — ")) {
            counts["أخرى"] = (counts["أخرى"] || 0) + 1;
            otherValues.push(item.replace("أخرى — ", ""));
          } else if (item) {
            counts[item] = (counts[item] || 0) + 1;
          }
        });
      } else if (q.type === "subscription") {
        // ans format: "شهري — 150 جنيه تقريبًا" or "لا أستطيع تحديد قيمة"
        if (ans.includes("شهري")) counts["شهري"] = (counts["شهري"] || 0) + 1;
        else if (ans.includes("سنوي")) counts["سنوي"] = (counts["سنوي"] || 0) + 1;
        else if (ans.includes("لا أستطيع")) counts["لا أستطيع تحديد قيمة"] = (counts["لا أستطيع تحديد قيمة"] || 0) + 1;
        else counts[ans] = (counts[ans] || 0) + 1;
      }
    });

    const divisor = answeredCount || totalRespondents || 1;
    const barsContainer = document.createElement("div");
    barsContainer.className = "chart-bars";

    const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    sortedEntries.forEach(([label, count]) => {
      const pct = Math.round((count / divisor) * 100);
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <div class="bar-label-group">
          <span class="bar-label">${escapeHtml(label)}</span>
          <span class="bar-metrics">
            <span class="bar-count">${count} صيدلي</span>
            <span class="bar-percent">(${pct}%)</span>
          </span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${pct}%;"></div>
        </div>
      `;
      barsContainer.appendChild(row);
    });

    card.appendChild(barsContainer);

    // If there were "أخرى" text answers, display them in an expandable list
    if (otherValues.length > 0) {
      const otherWrap = document.createElement("div");
      otherWrap.className = "other-responses-wrap";
      const toggleId = `other-list-${q.id}`;
      otherWrap.innerHTML = `
        <button type="button" class="other-toggle-btn" onclick="document.getElementById('${toggleId}').style.display = document.getElementById('${toggleId}').style.display === 'none' ? 'flex' : 'none'">
          <span>توضيحات إجابة "أخرى" (${otherValues.length})</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div id="${toggleId}" class="other-list" style="display:none;">
          ${otherValues.map((v) => `<div class="other-item">"${escapeHtml(v)}"</div>`).join("")}
        </div>
      `;
      card.appendChild(otherWrap);
    }

    return card;
  }

  // ---------- Table View (Individual Responses) ----------

  function renderTable() {
    responsesTableBody.innerHTML = "";
    const total = filteredResponses.length;

    if (total === 0) {
      responsesTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:32px;color:var(--teal-light);">
            لا توجد ردود مطابقة للبحث أو التصفية الحالية.
          </td>
        </tr>
      `;
      return;
    }

    filteredResponses.forEach((item, index) => {
      const a = item.answers || {};
      const tr = document.createElement("tr");

      const isTestPing = !a.q1;
      const role = a.q1 || (a.test || a.test_pharmacist ? "فحص اتصال تجريبي" : "—");
      const pharmacy = a.q1_pharmacy || (isTestPing ? "—" : "لم يُحدد");
      const exp = a.q2 || "—";
      const subIntent = a.q16 || (isTestPing ? "فحص اتصال" : "—");
      const timeStr = formatDateTime(item.submitted_at);

      tr.innerHTML = `
        <td><strong>#${index + 1}</strong></td>
        <td style="white-space:nowrap;font-size:0.8rem;color:var(--teal-soft);">${timeStr}</td>
        <td><span class="tag ${isTestPing ? 'tag-warning' : 'tag-emerald'}">${escapeHtml(role)}</span></td>
        <td><span style="font-weight:600;color:var(--teal);">${escapeHtml(pharmacy)}</span></td>
        <td><span class="tag tag-teal">${escapeHtml(exp)}</span></td>
        <td><span class="tag ${subIntent.includes('نعم') || subIntent.includes('بالتأكيد') ? 'tag-emerald' : 'tag-teal'}">${escapeHtml(subIntent)}</span></td>
        <td>
          <button type="button" class="btn btn-outline btn-sm btn-inspect" data-idx="${index}">
            عرض التفاصيل
          </button>
        </td>
      `;


      tr.querySelector(".btn-inspect").addEventListener("click", () => {
        openInspectModal(item, index + 1);
      });

      responsesTableBody.appendChild(tr);
    });
  }

  // ---------- Feedback View (Suggestions Q23) ----------

  function renderFeedback() {
    feedbackGrid.innerHTML = "";
    const suggestions = [];

    filteredResponses.forEach((r, idx) => {
      const a = r.answers || {};
      const text = a.q23;
      if (text && typeof text === "string" && text.trim()) {
        suggestions.push({
          num: idx + 1,
          text: text.trim(),
          role: a.q1 || "صيدلي",
          date: r.submitted_at
        });
      }
    });

    if (suggestions.length === 0) {
      feedbackGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">💬</div>
          <div class="empty-title">لا توجد مقترحات مكتوبة بعد</div>
          <div class="empty-desc">عندما يقوم المشاركون بكتابة تعليقات أو مقترحات إضافية في السؤال الـ 23، ستظهر هنا كبطاقات قابلة للدراسة والنسخ.</div>
        </div>
      `;
      return;
    }

    suggestions.forEach((item) => {
      const card = document.createElement("div");
      card.className = "feedback-card";
      card.innerHTML = `
        <p class="feedback-text">"${escapeHtml(item.text)}"</p>
        <div class="feedback-meta">
          <div>
            <strong>#${item.num}</strong> • <span class="tag tag-teal">${escapeHtml(item.role)}</span>
          </div>
          <div>${formatDateTime(item.date)}</div>
        </div>
      `;
      feedbackGrid.appendChild(card);
    });
  }

  // ---------- Inspect Modal (Full Survey View) ----------

  function openInspectModal(responseItem, num) {
    const a = responseItem.answers || {};
    inspectModalBody.innerHTML = `
      <div style="background:var(--gray-surface);padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:20px;font-size:0.83rem;">
        <div><strong>تاريخ الاستجابة:</strong> ${formatDateTime(responseItem.submitted_at)}</div>
        <div style="margin-top:4px;word-break:break-all;color:var(--teal-soft);"><strong>معرف المتصفح:</strong> ${escapeHtml(responseItem.user_agent || "غير محدد")}</div>
      </div>
    `;

    const questionsList = getQuestionsList();
    questionsList.forEach((q, idx) => {
      const ans = a[q.id] || "— لم يُجب —";
      const row = document.createElement("div");
      row.className = "response-detail-row";
      row.innerHTML = `
        <div class="response-q-title">${idx + 1}. ${escapeHtml(q.text)}</div>
        <div class="response-q-answer">${escapeHtml(ans)}</div>
      `;
      inspectModalBody.appendChild(row);
    });

    document.getElementById("modal-response-num").textContent = num;
    inspectModal.classList.add("open");
  }

  if (inspectModalClose) {
    inspectModalClose.addEventListener("click", () => {
      inspectModal.classList.remove("open");
    });
  }

  if (inspectModal) {
    inspectModal.addEventListener("click", (e) => {
      if (e.target === inspectModal) inspectModal.classList.remove("open");
    });
  }

  // ---------- Export to Excel / CSV ----------

  function exportToCsv() {
    if (filteredResponses.length === 0) {
      showToast("لا توجد ردود لتصديرها.");
      return;
    }

    const questionsList = getQuestionsList();
    const headers = [
      "رقم الرد",
      "تاريخ الإرسال",
      "معرف الجهاز"
    ];

    questionsList.forEach((q) => {
      headers.push(`${q.id.toUpperCase()}: ${q.text.replace(/[\r\n,]/g, " ")}`);
    });

    const rows = [headers];

    filteredResponses.forEach((r, idx) => {
      const a = r.answers || {};
      const row = [
        idx + 1,
        formatDateTime(r.submitted_at),
        cleanCsvCell(r.user_agent || "")
      ];

      questionsList.forEach((q) => {
        row.push(cleanCsvCell(a[q.id] || ""));
      });

      rows.push(row);
    });

    const csvContent = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");

    // Add UTF-8 BOM (\uFEFF) so Excel displays Arabic letters correctly without encoding issues!
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dawanetwork-survey-results-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showToast("تم تنزيل ملف CSV بنجاح!");
  }

  function cleanCsvCell(val) {
    if (val === null || val === undefined) return "";
    return String(val).replace(/\r?\n|\r/g, " ");
  }

  // ---------- Export JSON ----------

  function exportToJson() {
    if (filteredResponses.length === 0) {
      showToast("لا توجد ردود لتصديرها.");
      return;
    }
    const blob = new Blob([JSON.stringify(filteredResponses, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dawanetwork-survey-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("تم تنزيل ملف JSON بنجاح!");
  }

  // ---------- Helpers ----------

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return "—";
    try {
      const d = new Date(isoStr);
      return d.toLocaleString("ar-EG", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return isoStr;
    }
  }

  // ---------- Custom Key / RLS Modal ----------

  const keyModal = document.getElementById("key-modal");
  const keyModalClose = document.getElementById("key-modal-close");
  const keyInput = document.getElementById("key-input");
  const saveKeyBtn = document.getElementById("save-key-btn");
  const clearKeyBtn = document.getElementById("clear-key-btn");
  const copySqlBtn = document.getElementById("copy-sql-btn");

  if (keyModalBtn) {
    keyModalBtn.addEventListener("click", () => {
      keyInput.value = customServiceKey;
      keyModal.classList.add("open");
    });
  }

  if (keyModalClose) {
    keyModalClose.addEventListener("click", () => {
      keyModal.classList.remove("open");
    });
  }

  if (saveKeyBtn) {
    saveKeyBtn.addEventListener("click", () => {
      const val = keyInput.value.trim();
      customServiceKey = val;
      if (val) {
        sessionStorage.setItem("dawanetwork_admin_key", val);
        showToast("تم حفظ المفتاح للجلسة الحالية!");
      } else {
        sessionStorage.removeItem("dawanetwork_admin_key");
        sessionStorage.removeItem("dawalink_admin_key");
      }
      keyModal.classList.remove("open");
      loadData();
    });
  }

  if (clearKeyBtn) {
    clearKeyBtn.addEventListener("click", () => {
      customServiceKey = "";
      keyInput.value = "";
      sessionStorage.removeItem("dawanetwork_admin_key");
      sessionStorage.removeItem("dawalink_admin_key");
      showToast("تمت استعادة المفتاح الافتراضي");
      keyModal.classList.remove("open");
      loadData();
    });
  }

  if (copySqlBtn) {
    copySqlBtn.addEventListener("click", () => {
      const sql = `CREATE POLICY "allow_admin_read" ON public.survey_responses FOR SELECT TO anon USING (true);`;
      navigator.clipboard.writeText(sql).then(() => {
        showToast("تم نسخ أمر SQL للحافظة!");
      }).catch(() => {
        showToast("يرجى نسخ النص يدوياً.");
      });
    });
  }

  // ---------- Tab Navigation Switch ----------

  function setupTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        activeTab = tab.dataset.tab;

        analyticsContainer.style.display = activeTab === "analytics" ? "block" : "none";
        tableViewContainer.style.display = activeTab === "table" ? "block" : "none";
        feedbackViewContainer.style.display = activeTab === "feedback" ? "block" : "none";
      });
    });
  }

  function renderAllViews() {
    updateKpis();
    renderAnalytics();
    renderTable();
    renderFeedback();

    // Update counts on tabs
    const tabTableCount = document.getElementById("tab-table-count");
    if (tabTableCount) tabTableCount.textContent = filteredResponses.length;
  }

  // ---------- Event Listeners ----------

  function setupEvents() {
    refreshBtn.addEventListener("click", loadData);
    exportCsvBtn.addEventListener("click", exportToCsv);
    exportJsonBtn.addEventListener("click", exportToJson);
    printBtn.addEventListener("click", () => window.print());

    searchInput.addEventListener("input", applyFilters);
    roleFilter.addEventListener("change", applyFilters);
    expFilter.addEventListener("change", applyFilters);

    btnSrcSupabase.addEventListener("click", () => {
      if (currentSource === "supabase") return;
      currentSource = "supabase";
      btnSrcSupabase.classList.add("active");
      btnSrcLocal.classList.remove("active");
      loadData();
    });

    btnSrcLocal.addEventListener("click", () => {
      if (currentSource === "local") return;
      currentSource = "local";
      btnSrcLocal.classList.add("active");
      btnSrcSupabase.classList.remove("active");
      loadData();
    });
  }

  // ---------- Dashboard Initialization ----------

  function initDashboard() {
    setupTabs();
    setupEvents();
    loadData();
  }

  window.addEventListener("DOMContentLoaded", () => {
    if (checkAuth()) {
      initDashboard();
    }
  });

})();
