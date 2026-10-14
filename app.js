/*
 * DawaNetwork survey — wizard logic.
 * Reads its content from questions.js and submits through supabaseClient.js.
 */
(function () {
  "use strict";

  // ---------- Build the step list: intro, Q1..Q8, DawaNetwork info, Q9..Q23, review ----------
  const steps = [{ type: "intro" }];
  QUESTIONS.forEach((q) => {
    if (q.id === "q9") steps.push({ type: "dawanetwork-info" });
    steps.push({ type: "question", q });
  });
  steps.push({ type: "review" });

  const TOTAL_QUESTIONS = QUESTIONS.length;

  let current = 0;
  let mode = "form"; // "form" | "confirmation"
  const responses = {}; // qId -> answer value (see shapes below)
  const otherText = {}; // qId -> free text for the "أخرى" option
  const subAmount = {}; // "q17" -> string (number as typed)

  const container = document.getElementById("step-container");
  const btnBack = document.getElementById("btn-back");
  const btnNext = document.getElementById("btn-next");
  const progressFill = document.getElementById("progress-fill");
  const progressTrack = document.getElementById("progress-track");
  const progressLabel = document.getElementById("progress-label");
  const toastEl = document.getElementById("toast");

  // ---------- Small helpers ----------

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        if (key === "class") node.className = props[key];
        else if (key === "text") node.textContent = props[key];
        else if (key === "html") node.innerHTML = props[key];
        else node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("visible"), 3200);
  }

  function questionNumber(qId) {
    return QUESTIONS.findIndex((q) => q.id === qId) + 1;
  }

  // ---------- Rendering ----------

  function renderIntro() {
    container.appendChild(el("h1", { class: "step-title", text: INTRO.heading }));
    const body = el("div", { class: "step-body" });
    INTRO.paragraphs.forEach((p) => body.appendChild(el("p", { text: p })));
    container.appendChild(body);
  }

  function renderDawaNetworkInfo() {
    const info = typeof DAWANETWORK_INFO !== "undefined" ? DAWANETWORK_INFO : DAWALINK_INFO;
    container.appendChild(el("div", { class: "section-eyebrow", text: info.sectionTitle }));
    container.appendChild(el("p", { class: "", text: info.intro }));
    const card = el("div", { class: "info-card" });
    card.appendChild(el("h1", { class: "step-title", text: info.heading }));
    info.paragraphs.forEach((p) => card.appendChild(el("p", { text: p })));
    card.appendChild(el("p", { class: "info-note", text: info.note }));
    container.appendChild(card);
  }

  function optionRow(inputType, name, value, checked, labelText) {
    const input = el("input", {
      type: inputType,
      name: name,
      value: value,
      id: name + "__" + value.replace(/\s+/g, "_"),
    });
    if (checked) input.setAttribute("checked", "checked");
    const label = el(
      "label",
      { class: "option-item" + (checked ? " selected" : ""), for: input.id },
      [input, el("span", { class: "option-text", text: labelText })]
    );
    label.htmlFor = input.id;
    return { label, input };
  }

  function renderSingle(q) {
    const list = el("div", { class: "option-list" });
    const current = responses[q.id];
    q.options.forEach((opt) => {
      const { label, input } = optionRow("radio", q.id, opt, current === opt, opt);
      input.addEventListener("change", () => {
        responses[q.id] = opt;
        list.querySelectorAll(".option-item").forEach((n) => n.classList.remove("selected"));
        label.classList.add("selected");
        toggleOtherField();
        clearError();
      });
      list.appendChild(label);
    });
    container.appendChild(list);

    let otherInput = null;
    function toggleOtherField() {
      if (!q.other) return;
      const needs = responses[q.id] === "أخرى";
      if (needs && !otherInput) {
        otherInput = buildOtherInput(q.id);
        list.insertAdjacentElement("afterend", otherInput.wrap);
      }
      if (otherInput) otherInput.wrap.style.display = needs ? "block" : "none";
    }
    if (q.other && current === "أخرى") toggleOtherField();
  }

  function renderMultiple(q) {
    const list = el("div", { class: "option-list" });
    const selected = Array.isArray(responses[q.id]) ? responses[q.id] : [];
    q.options.forEach((opt) => {
      const { label, input } = optionRow("checkbox", q.id, opt, selected.includes(opt), opt);
      input.addEventListener("change", () => {
        let arr = Array.isArray(responses[q.id]) ? responses[q.id].slice() : [];
        if (input.checked) {
          if (!arr.includes(opt)) arr.push(opt);
          label.classList.add("selected");
        } else {
          arr = arr.filter((v) => v !== opt);
          label.classList.remove("selected");
        }
        responses[q.id] = arr;
        toggleOtherField();
        clearError();
      });
      list.appendChild(label);
    });
    container.appendChild(list);

    let otherInput = null;
    function toggleOtherField() {
      if (!q.other) return;
      const needs = Array.isArray(responses[q.id]) && responses[q.id].includes("أخرى");
      if (needs && !otherInput) {
        otherInput = buildOtherInput(q.id);
        list.insertAdjacentElement("afterend", otherInput.wrap);
      }
      if (otherInput) otherInput.wrap.style.display = needs ? "block" : "none";
    }
    if (q.other && selected.includes("أخرى")) toggleOtherField();
  }

  function buildOtherInput(qId) {
    const input = el("input", {
      type: "text",
      placeholder: "يرجى التوضيح",
      value: otherText[qId] || "",
    });
    input.addEventListener("input", () => {
      otherText[qId] = input.value;
      clearError();
    });
    const wrap = el("div", { class: "other-input" }, [input]);
    return { wrap, input };
  }

  function renderSubscription(q) {
    const list = el("div", { class: "option-list" });
    const selectedPeriod = responses[q.id] && responses[q.id].period;
    let amountRow = null;

    function amountRowBuild() {
      const input = el("input", {
        type: "number",
        min: "0",
        inputmode: "numeric",
        placeholder: "القيمة التقريبية",
        value: subAmount[q.id] || "",
      });
      input.addEventListener("input", () => {
        subAmount[q.id] = input.value;
        if (responses[q.id]) responses[q.id].amount = input.value;
      });
      const label = el("span", { text: "جنيه مصري تقريبًا" });
      return el("div", { class: "sub-input-row" }, [input, label]);
    }

    q.periodOptions.forEach((opt) => {
      const checked = selectedPeriod === opt;
      const { label, input } = optionRow("radio", q.id, opt, checked, opt);
      input.addEventListener("change", () => {
        responses[q.id] = { period: opt, amount: subAmount[q.id] || "" };
        list.querySelectorAll(".option-item").forEach((n) => n.classList.remove("selected"));
        label.classList.add("selected");
        if (amountRow) {
          amountRow.remove();
          amountRow = null;
        }
        if (opt === "شهري" || opt === "سنوي") {
          amountRow = amountRowBuild();
          list.insertAdjacentElement("afterend", amountRow);
        }
      });
      list.appendChild(label);
    });
    container.appendChild(list);

    if (selectedPeriod === "شهري" || selectedPeriod === "سنوي") {
      amountRow = amountRowBuild();
      list.insertAdjacentElement("afterend", amountRow);
    }
  }

  function renderLongtext(q) {
    const textarea = el("textarea", { placeholder: q.placeholder || "" });
    textarea.value = responses[q.id] || "";
    textarea.addEventListener("input", () => {
      responses[q.id] = textarea.value;
      clearError();
    });
    container.appendChild(textarea);
  }

  function renderText(q) {
    const input = el("input", {
      type: "text",
      placeholder: q.placeholder || "",
      class: "text-input"
    });
    input.value = responses[q.id] || "";
    input.addEventListener("input", () => {
      responses[q.id] = input.value;
      clearError();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        goNext();
      }
    });
    container.appendChild(input);
    setTimeout(() => {
      try { input.focus(); } catch (e) {}
    }, 60);
  }

  function renderQuestion(q) {
    container.appendChild(el("div", { class: "section-eyebrow", text: q.section }));
    const legend = el("h1", { class: "step-title", text: q.text });
    if (!q.required) {
      const tag = el("span", { class: "optional-tag", text: "اختياري" });
      legend.appendChild(tag);
    }
    container.appendChild(legend);

    if (q.id === "q18") {
      container.appendChild(el("p", { class: "info-note", text: SECTION6_NOTE, style: "margin-bottom:16px;" }));
    }

    if (q.type === "single") renderSingle(q);
    else if (q.type === "multiple") renderMultiple(q);
    else if (q.type === "subscription") renderSubscription(q);
    else if (q.type === "longtext") renderLongtext(q);
    else if (q.type === "text") renderText(q);

    container.appendChild(el("p", { class: "field-error", id: "field-error" }));
  }

  function formatAnswerForDisplay(q) {
    const v = responses[q.id];
    if (q.type === "single") {
      if (!v) return null;
      return v === "أخرى" && otherText[q.id] ? "أخرى — " + otherText[q.id] : v;
    }
    if (q.type === "multiple") {
      if (!v || !v.length) return null;
      return v
        .map((opt) => (opt === "أخرى" && otherText[q.id] ? "أخرى — " + otherText[q.id] : opt))
        .join("، ");
    }
    if (q.type === "subscription") {
      if (!v || !v.period) return null;
      if (v.period === "لا أستطيع تحديد قيمة") return v.period;
      return v.period + (v.amount ? " — " + v.amount + " جنيه تقريبًا" : "");
    }
    if (q.type === "longtext" || q.type === "text") {
      return v && v.trim() ? v.trim() : null;
    }
    return null;
  }


  function renderReview() {
    container.appendChild(el("h1", { class: "step-title", text: "مراجعة الإجابات" }));
    container.appendChild(
      el("p", { class: "", text: "يمكنك مراجعة إجاباتك قبل الإرسال، أو العودة لتعديل أي سؤال." })
    );
    const list = el("div", { class: "review-list" });
    QUESTIONS.forEach((q, idx) => {
      const answer = formatAnswerForDisplay(q);
      const item = el("div", { class: "review-item" });
      item.style.cursor = "pointer";
      item.appendChild(el("div", { class: "review-q", text: "س" + (idx + 1) + ". " + q.text }));
      item.appendChild(
        el("div", {
          class: "review-a" + (answer ? "" : " empty"),
          text: answer || (q.required ? "لم تتم الإجابة" : "بدون إجابة (سؤال اختياري)"),
        })
      );
      item.addEventListener("click", () => {
        current = steps.findIndex((s) => s.type === "question" && s.q.id === q.id);
        mode = "form";
        render();
      });
      list.appendChild(item);
    });
    container.appendChild(list);

    const backend = window.DawaNetworkBackend || window.DawaLinkBackend || {};
    if (!backend.isConfigured) {
      container.appendChild(
        el("div", {
          class: "local-banner",
          text:
            "ملاحظة: لم يتم إعداد قاعدة بيانات بعد (config.js فارغ)، لذلك سيتم حفظ إجابتك محليًا في متصفحك فقط عند الإرسال، ولن تُجمع من أجهزة المشاركين الآخرين عبر الإنترنت حتى يتم إعداد Supabase.",
        })
      );
    }
  }

  function renderConfirmation(resultNote) {
    const wrap = el("div", { class: "confirm-wrap" });
    wrap.appendChild(
      el("div", { class: "confirm-mark" }, [
        (() => {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("fill", "none");
          svg.innerHTML =
            '<path d="M5 13l4 4L19 7" stroke="#0C2A35" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
          return svg;
        })(),
      ])
    );
    wrap.appendChild(el("h1", { class: "step-title", text: "تم إرسال إجاباتك" }));
    wrap.appendChild(el("p", { text: CONFIRMATION_MESSAGE }));
    if (resultNote) wrap.appendChild(el("p", { class: "", style: "color:#35505c;font-size:0.9rem;", text: resultNote }));

    const actions = el("div", { style: "display:flex;flex-direction:column;gap:10px;margin-top:22px;align-items:center;" });
    const exportBtn = el("button", { type: "button", class: "btn btn-ghost", text: "تنزيل الإجابات المحفوظة محليًا (JSON)" });
    exportBtn.addEventListener("click", exportLocalResponses);
    actions.appendChild(exportBtn);

    const restartBtn = el("button", { type: "button", class: "btn btn-ghost", text: "تعبئة استطلاع آخر" });
    restartBtn.addEventListener("click", resetSurvey);
    actions.appendChild(restartBtn);

    wrap.appendChild(actions);
    container.appendChild(wrap);
  }

  // ---------- Progress ----------

  function updateProgress() {
    const pct = Math.round((current / (steps.length - 1)) * 100);
    progressFill.style.width = pct + "%";
    progressTrack.setAttribute("aria-valuenow", String(pct));

    const step = steps[current];
    if (mode === "confirmation") {
      progressLabel.textContent = "تم الإرسال";
    } else if (step.type === "intro") {
      progressLabel.textContent = "قبل البدء";
    } else if (step.type === "dawanetwork-info" || step.type === "dawalink-info") {
      progressLabel.textContent = "تعريف بالفكرة";
    } else if (step.type === "review") {
      progressLabel.textContent = "مراجعة نهائية";
    } else {
      progressLabel.textContent = "سؤال " + questionNumber(step.q.id) + " من " + TOTAL_QUESTIONS;
    }
  }

  function updateNavButtons() {
    if (mode === "confirmation") {
      btnBack.hidden = true;
      btnNext.hidden = true;
      return;
    }
    btnBack.hidden = false;
    btnNext.hidden = false;
    btnBack.style.visibility = current === 0 ? "hidden" : "visible";

    const step = steps[current];
    if (step.type === "intro") btnNext.textContent = "ابدأ الاستطلاع";
    else if (step.type === "review") btnNext.textContent = "إرسال الإجابات";
    else btnNext.textContent = "التالي";
  }

  // ---------- Validation ----------

  function clearError() {
    const errEl = document.getElementById("field-error");
    if (errEl) errEl.classList.remove("visible");
  }

  function showError(msg) {
    const errEl = document.getElementById("field-error");
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.add("visible");
    }
  }

  function validateCurrentStep() {
    const step = steps[current];
    if (step.type !== "question") return true;
    const q = step.q;
    if (!q.required) return true;

    if (q.type === "single") {
      const v = responses[q.id];
      if (!v) {
        showError("يرجى اختيار إجابة للمتابعة.");
        return false;
      }
      if (v === "أخرى" && (!otherText[q.id] || !otherText[q.id].trim())) {
        showError("يرجى كتابة توضيح مختصر.");
        return false;
      }
      return true;
    }
    if (q.type === "multiple") {
      const v = responses[q.id];
      if (!v || !v.length) {
        showError("يرجى اختيار إجابة واحدة على الأقل.");
        return false;
      }
      if (v.includes("أخرى") && (!otherText[q.id] || !otherText[q.id].trim())) {
        showError("يرجى كتابة توضيح مختصر.");
        return false;
      }
      return true;
    }
    if (q.type === "text" || q.type === "longtext") {
      const v = responses[q.id];
      if (!v || !v.trim()) {
        showError("يرجى كتابة الإجابة للمتابعة.");
        return false;
      }
      return true;
    }
    return true;
  }


  // ---------- Local storage fallback ----------

  const LOCAL_KEY = "dawanetwork_survey_responses";
  const OLD_LOCAL_KEY = "dawalink_survey_responses";

  function buildAnswersObject() {
    const out = {};
    QUESTIONS.forEach((q) => {
      out[q.id] = formatAnswerForDisplay(q);
    });
    return out;
  }

  function saveLocally(answers) {
    let all = [];
    try {
      all = JSON.parse(localStorage.getItem(LOCAL_KEY) || localStorage.getItem(OLD_LOCAL_KEY) || "[]");
    } catch (e) {
      all = [];
    }
    all.push({ submitted_at: new Date().toISOString(), answers });
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
    } catch (e) {
      console.warn("Could not save locally:", e);
    }
  }

  function exportLocalResponses() {
    let all = [];
    try {
      all = JSON.parse(localStorage.getItem(LOCAL_KEY) || localStorage.getItem(OLD_LOCAL_KEY) || "[]");
    } catch (e) {
      all = [];
    }
    if (!all.length) {
      showToast("لا توجد إجابات محفوظة محليًا على هذا الجهاز بعد.");
      return;
    }
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dawanetwork-survey-responses.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function resetSurvey() {
    Object.keys(responses).forEach((k) => delete responses[k]);
    Object.keys(otherText).forEach((k) => delete otherText[k]);
    Object.keys(subAmount).forEach((k) => delete subAmount[k]);
    current = 0;
    mode = "form";
    render();
  }

  // ---------- Submit ----------

  async function handleSubmit() {
    const answers = buildAnswersObject();
    saveLocally(answers); // always keep a local safety copy

    const backend = window.DawaNetworkBackend || window.DawaLinkBackend;
    if (backend && backend.isConfigured) {
      btnNext.disabled = true;
      btnNext.textContent = "جارٍ الإرسال...";
      const result = await backend.submit(answers);
      btnNext.disabled = false;
      if (result.ok) {
        mode = "confirmation";
        render("تم حفظ إجاباتك في قاعدة البيانات.");
        return;
      }
      showToast("تعذر إرسال الإجابات إلى قاعدة البيانات. تم حفظها محليًا، يمكنك المحاولة مرة أخرى.");
      return;
    }

    mode = "confirmation";
    render("هذا إصدار تجريبي محلي، فلم تُرسل إجاباتك عبر الإنترنت — تم حفظها في متصفحك فقط.");
  }

  // ---------- Navigation ----------

  function goNext() {
    const step = steps[current];
    if (step.type === "review") {
      handleSubmit();
      return;
    }
    if (!validateCurrentStep()) return;
    if (current < steps.length - 1) {
      current += 1;
      render();
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }
  }

  function goBack() {
    if (current > 0) {
      current -= 1;
      render();
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }
  }

  // ---------- Main render dispatch ----------

  function render(resultNote) {
    container.innerHTML = "";
    if (mode === "confirmation") {
      renderConfirmation(resultNote);
      updateProgress();
      updateNavButtons();
      return;
    }
    const step = steps[current];
    if (step.type === "intro") renderIntro();
    else if (step.type === "dawanetwork-info" || step.type === "dawalink-info") renderDawaNetworkInfo();
    else if (step.type === "question") renderQuestion(step.q);
    else if (step.type === "review") renderReview();
    updateProgress();
    updateNavButtons();
  }

  btnNext.addEventListener("click", goNext);
  btnBack.addEventListener("click", goBack);

  render();
})();
