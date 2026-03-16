(() => {
  const PANEL_CONFIG = {
    background: {
      label: "人物背景",
      resultsId: "backgroundResults",
      generateButtonId: "bgGenerateButton",
      accentRgb: "45, 74, 122",
    },
    personality: {
      label: "性格档案",
      resultsId: "personalityResults",
      generateButtonId: "personalityGenerateButton",
      accentRgb: "45, 138, 110",
    },
    body: {
      label: "人物外观",
      resultsId: "bodyAppearanceResults",
      generateButtonId: "bodyAppearanceGenerateButton",
      accentRgb: "138, 109, 59",
    },
    appearance: {
      label: "私密部位",
      resultsId: "appearanceResults",
      generateButtonId: "appearanceGenerateButton",
      accentRgb: "140, 68, 102",
    },
    fetish: {
      label: "偏好档案",
      resultsId: "fetishResults",
      generateButtonId: "fetishGenerateButton",
      accentRgb: "122, 47, 42",
    },
    relationship: {
      label: "关系动态",
      accentRgb: "90, 74, 106",
    },
  };

  const WORKSPACE_BRIDGE_KEY = "role_generator_workspace_bridge_v1";
  const PRIVATE_PANEL_IDS = ["appearance", "fetish"];

  const ui = {
    shell: document.querySelector(".workspace-shell"),
    tabs: Array.from(document.querySelectorAll(".generator-tab")),
    panels: Array.from(document.querySelectorAll(".workspace-panel")),
    privateTabs: Array.from(document.querySelectorAll('.generator-tab[data-private-panel="true"]')),
    privatePanels: Array.from(document.querySelectorAll('.workspace-panel[data-private-panel="true"]')),
    controlSheets: Array.from(document.querySelectorAll(".controls-sheet")),
    status: document.getElementById("workspaceActionStatus"),
    privateToggle: document.getElementById("workspacePrivateToggle"),
    chainButton: document.getElementById("workspaceChainButton"),
    exportButton: document.getElementById("workspaceExportButton"),
    toastStack: document.getElementById("workspaceToastStack"),
  };

  function controllers() {
    return window.generatorWorkspaceControllers || {};
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function getPanel(panelId) {
    return document.getElementById(`panel-${panelId}`);
  }

  function getResultContainer(panelId) {
    const config = PANEL_CONFIG[panelId];
    return config?.resultsId ? document.getElementById(config.resultsId) : null;
  }

  function privatePanelsEnabled() {
    return ui.shell?.dataset.privateMode === "expanded";
  }

  function chainSequenceText() {
    return privatePanelsEnabled() ? "背景 → 性格 → 人物外观 → 私密部位" : "背景 → 性格 → 人物外观";
  }

  function syncPrivateToggleButton() {
    if (!ui.privateToggle) return;
    ui.privateToggle.textContent = privatePanelsEnabled() ? "收起私密设定" : "设定私密部位与偏好";
    ui.privateToggle.classList.toggle("is-active", privatePanelsEnabled());
  }

  function setPrivateMode(expanded, options = {}) {
    const { announce = true } = options;
    if (ui.shell) ui.shell.dataset.privateMode = expanded ? "expanded" : "collapsed";

    ui.privateTabs.forEach((tab) => {
      tab.classList.toggle("is-private-hidden", !expanded);
      tab.setAttribute("aria-hidden", expanded ? "false" : "true");
    });
    ui.privatePanels.forEach((panel) => {
      panel.classList.toggle("is-private-hidden", !expanded);
      panel.setAttribute("aria-hidden", expanded ? "false" : "true");
    });

    const activePrivateTab = ui.tabs.find((tab) => tab.classList.contains("active") && PRIVATE_PANEL_IDS.includes(tab.dataset.panel));
    if (!expanded && activePrivateTab) {
      activatePanel("background");
    }

    syncPrivateToggleButton();
    updateStatus(
      expanded
        ? `已展开私密设定。串联生成会按 ${chainSequenceText()} 的顺序围绕当前人物推进，偏好档案也可单独补充。`
        : "当前默认从人物背景开始。公开版默认只串联 背景 → 性格 → 人物外观；如需补充私密部位与偏好档案，可点击顶部按钮展开。"
    );

    if (announce) {
      showToast(
        expanded ? "私密设定已展开" : "私密设定已收起",
        expanded ? "私密部位与偏好档案面板现在可见。" : "导出与串联已恢复为公开版默认范围。",
        expanded ? "appearance" : "background"
      );
    }

    syncActivePanel();
  }

  function activatePanel(panelId) {
    const tab = ui.tabs.find((item) => item.dataset.panel === panelId);
    if (!tab) return;
    tab.click();
    syncActivePanel();
  }

  function syncActivePanel() {
    const activeTab = ui.tabs.find((tab) => tab.classList.contains("active"));
    const activePanelId = activeTab?.dataset.panel || "background";
    if (ui.shell) ui.shell.dataset.activePanel = activePanelId;
  }

  function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function updateStatus(message) {
    if (ui.status) ui.status.textContent = message;
  }

  function showToast(title, message, panelId = "background") {
    if (!ui.toastStack) return;
    const toast = document.createElement("article");
    toast.className = "workspace-toast";
    toast.style.setProperty("--panel-accent-rgb", PANEL_CONFIG[panelId]?.accentRgb || PANEL_CONFIG.background.accentRgb);
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
    ui.toastStack.append(toast);
    const duration = Math.max(2200, Math.min(4000, (String(title || "").length + String(message || "").length) * 80));
    window.setTimeout(() => {
      toast.classList.add("is-hiding");
      window.setTimeout(() => toast.remove(), 180);
    }, duration);
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeSummaryValue(label, control) {
    if (!control) return "";
    if (control.tagName === "SELECT") {
      const selected = control.selectedOptions?.[0];
      if (control.value) return selected?.textContent?.trim() || control.value;
      if (label.includes("人物")) return "待选";
      if (label.includes("体态")) return "随机";
      return "随机";
    }

    const raw = control.value.trim();
    if (raw) return raw;
    if (control.readOnly) return "等待同步";
    if (label.includes("种子")) return "自动";
    return "未设定";
  }

  function refreshControlSheet(details) {
    if (!details) return;
    const summaryValues = details.querySelector(".summary-values");
    const summaryToggle = details.querySelector(".summary-toggle");
    if (!summaryValues || !summaryToggle) return;

    const parts = Array.from(details.querySelectorAll(".control-grid .control-field"))
      .map((field) => {
        const label = field.querySelector("span")?.textContent?.trim();
        const control = field.querySelector("select, input");
        if (!label || !control) return "";
        return `${label} ${normalizeSummaryValue(label, control)}`;
      })
      .filter(Boolean);

    summaryValues.textContent = ["单角色", ...parts.slice(0, 4)].join(" · ");
    summaryToggle.textContent = details.open ? "收起" : "展开";
  }

  function refreshAllControlSheets() {
    ui.controlSheets.forEach(refreshControlSheet);
  }

  function updateStatsVisibility(panelId) {
    const panel = getPanel(panelId);
    if (!panel) return;
    const stats = Array.from(panel.querySelectorAll(".hero-chip strong"));
    if (!stats.length) return;
    const ready = stats.every((node) => Number(node.textContent || "0") > 0);
    panel.classList.toggle("is-stats-ready", ready);
  }

  function buildEmptyIcon(panelId) {
    const stroke = PANEL_CONFIG[panelId]?.accentRgb || PANEL_CONFIG.background.accentRgb;
    const pathMap = {
      body: "M18 5c1.8 0 3.2 1.4 3.2 3.2 0 1-.4 1.9-1.1 2.5l2.4 4.4v7.7h-5v-5.5h-3v5.5h-5V15l2.4-4.4A3.2 3.2 0 0 1 15 5h3Z",
      background: "M12 5h8l5 5v9a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1 6h10m-10 4h10m-10 4h6",
      personality: "M12 10a6 6 0 0 1 12 0c0 2.5-1.1 4-2.3 5.5-.9 1.1-1.7 2.1-1.7 3.5h-4c0-1.4-.8-2.4-1.7-3.5C13.1 14 12 12.5 12 10Zm3 12h6",
      relationship: "M9 10a4 4 0 0 1 7-2.6A4 4 0 0 1 23 10c0 4.4-7 8.8-7 8.8S9 14.4 9 10Z",
      appearance: "M9 8h18v5H9Zm0 8h8v7H9Zm11 0h7v7h-7Z",
      fetish: "M12 8h16v12H12Zm4-3h8m-4 15v4",
    };

    return `
      <svg class="empty-icon" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="30" height="30" rx="11" stroke="rgba(${stroke}, 0.35)" />
        <path d="${pathMap[panelId] || pathMap.background}" stroke="rgba(${stroke}, 1)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }

  function enhanceEmptyState(panelId) {
    const container = getResultContainer(panelId);
    if (!container) return;
    const empty = container.querySelector(".empty-state");
    if (!empty || empty.dataset.enhanced === "true") return;
    empty.dataset.enhanced = "true";
    empty.insertAdjacentHTML("afterbegin", buildEmptyIcon(panelId));

    const config = PANEL_CONFIG[panelId];
    if (config?.generateButtonId) {
      const actionWrap = document.createElement("div");
      actionWrap.className = "empty-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-solid";
      button.dataset.emptyAction = config.generateButtonId;
      button.textContent = `立即生成${config.label}`;
      actionWrap.append(button);
      empty.append(actionWrap);
    }
  }

  function formatJson(value) {
    return JSON.stringify(value ?? null, null, 2);
  }

  function getState(panelId) {
    const controller = controllers()[panelId];
    return controller?.getState ? controller.getState() : null;
  }

  function getLockedSet(panelId) {
    const state = getState(panelId);
    return new Set(state?.lockedIndices || []);
  }

  function renderCompare(card, panelId, index) {
    const controller = controllers()[panelId];
    if (!controller?.exportResult) return;
    const state = getState(panelId);
    const previous = state?.previousResultsByIndex?.[index];
    const current = controller.exportResult(index);
    const existing = card.querySelector(".card-compare");

    if (!previous || current == null) {
      existing?.remove();
      return;
    }

    const markup = `
      <details class="card-compare">
        <summary>
          <span>对比上次</span>
          <span class="section-meta">槽位 ${index + 1}</span>
        </summary>
        <div class="compare-grid">
          <section class="compare-column">
            <strong>上次</strong>
            <pre>${escapeHtml(formatJson(previous))}</pre>
          </section>
          <section class="compare-column">
            <strong>当前</strong>
            <pre>${escapeHtml(formatJson(current))}</pre>
          </section>
        </div>
      </details>
    `;

    if (existing) {
      existing.outerHTML = markup;
      return;
    }

    card.insertAdjacentHTML("beforeend", markup);
  }

  function decorateCard(panelId, card, index) {
    card.dataset.cardIndex = String(index);
    card.style.setProperty("--panel-accent-rgb", PANEL_CONFIG[panelId]?.accentRgb || PANEL_CONFIG.background.accentRgb);

    if (!card.querySelector(".card-accent")) {
      const accent = document.createElement("div");
      accent.className = "card-accent";
      card.prepend(accent);
    }

    const top = card.querySelector(".card-top");
    if (top && !top.querySelector(".card-actions")) {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      actions.innerHTML = `
        <button class="card-tool" type="button" data-card-action="select">选择此人物</button>
        <button class="card-tool" type="button" data-card-action="lock">锁定</button>
      `;
      top.append(actions);
    }

    const state = getState(panelId);
    const selectedIndex = Number(state?.selectedIndex ?? 0);
    const locked = getLockedSet(panelId);

    card.classList.toggle("is-selected", selectedIndex === index);
    card.classList.toggle("is-locked", locked.has(index));

    const actionSelect = card.querySelector('[data-card-action="select"]');
    const actionLock = card.querySelector('[data-card-action="lock"]');
    if (actionSelect) actionSelect.classList.toggle("is-active", selectedIndex === index);
    if (actionLock) {
      actionLock.classList.toggle("is-active", locked.has(index));
      actionLock.textContent = locked.has(index) ? "已锁定" : "锁定";
    }

    card.querySelectorAll(".field-item").forEach((fieldItem) => {
      const fieldHead = fieldItem.querySelector(".field-head");
      const fieldValue = fieldItem.querySelector(".field-value");
      const fieldName = fieldItem.dataset.fieldName;
      if (!fieldHead || !fieldValue || !fieldName) return;

      let fieldActions = fieldHead.querySelector(".field-actions");
      if (!fieldActions) {
        fieldActions = document.createElement("div");
        fieldActions.className = "field-actions";
        const rerollButton = fieldHead.querySelector(".field-reroll");
        if (rerollButton) fieldActions.append(rerollButton);
        fieldHead.append(fieldActions);
      }

      if (!fieldActions.querySelector('[data-field-action="copy"]')) {
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "field-copy";
        copyButton.dataset.fieldAction = "copy";
        copyButton.setAttribute("aria-label", `复制 ${fieldName}`);
        copyButton.textContent = "复制";
        fieldActions.append(copyButton);
      }

      fieldValue.classList.add("is-editable");
      fieldValue.tabIndex = 0;
      fieldValue.title = "点击编辑字段值";

      if (!fieldItem.querySelector(".field-edit-row")) {
        const editRow = document.createElement("div");
        editRow.className = "field-edit-row";
        fieldItem.append(editRow);
      }
    });

    renderCompare(card, panelId, index);
  }

  function decorateResults(panelId) {
    const container = getResultContainer(panelId);
    if (!container) return;
    const cards = Array.from(container.querySelectorAll(".background-card"));
    if (!cards.length) {
      enhanceEmptyState(panelId);
      return;
    }

    cards.forEach((card, index) => decorateCard(panelId, card, Number(card.dataset.cardIndex || card.dataset.profileIndex || index)));
  }

  function closeFieldEditor(fieldItem) {
    if (!fieldItem) return;
    fieldItem.classList.remove("is-editing");
    delete fieldItem._editorConfig;
    const editRow = fieldItem.querySelector(".field-edit-row");
    if (editRow) editRow.innerHTML = "";
  }

  function closeOtherEditors(exceptItem = null) {
    document.querySelectorAll(".field-item.is-editing").forEach((fieldItem) => {
      if (fieldItem === exceptItem) return;
      closeFieldEditor(fieldItem);
    });
  }

  function renderEditorControl(editRow, editor) {
    if (!editRow || !editor) return null;
    if (editor.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "field-input";
      if (Number.isFinite(Number(editor.min))) input.min = String(editor.min);
      if (Number.isFinite(Number(editor.max))) input.max = String(editor.max);
      input.value = editor.value == null ? "" : String(editor.value);
      if (editor.placeholder) input.placeholder = editor.placeholder;
      editRow.append(input);
      return input;
    }

    const select = document.createElement("select");
    select.className = "field-select";
    if (editor.multiple) {
      select.multiple = true;
      select.size = Math.min(Math.max((editor.options || []).length, 4), 8);
    }

    (editor.options || []).forEach((optionConfig) => {
      const option = document.createElement("option");
      option.value = String(optionConfig.value ?? "");
      option.textContent = String(optionConfig.label ?? optionConfig.value ?? "");
      if (editor.multiple) {
        const selectedValues = new Set((editor.value || []).map((value) => String(value)));
        option.selected = selectedValues.has(option.value);
      } else {
        option.selected = String(editor.value ?? "") === option.value;
      }
      select.append(option);
    });
    editRow.append(select);
    return select;
  }

  function normalizeEditorSubmission(editor, control) {
    if (!editor || !control) return null;
    if (editor.type === "number") {
      return control.value === "" ? "" : Number(control.value);
    }
    if (editor.multiple) {
      return Array.from(control.selectedOptions || []).map((option) => option.value);
    }
    return control.value;
  }

  async function openFieldEditor(fieldValueNode) {
    const fieldItem = fieldValueNode?.closest(".field-item");
    const panel = fieldValueNode?.closest(".workspace-panel");
    const card = fieldValueNode?.closest(".background-card");
    const panelId = panel?.dataset.panel;
    const fieldName = fieldItem?.dataset.fieldName;
    const index = Number(card?.dataset.cardIndex || 0);
    const controller = panelId ? controllers()[panelId] : null;
    if (!fieldItem || !panelId || !fieldName || !controller?.getFieldEditor) return;

    const editor = controller.getFieldEditor(index, fieldName);
    if (!editor) {
      showToast("暂无可编辑候选", `${fieldName} 目前只支持重刷，还没有稳定的手动候选列表。`, panelId);
      return;
    }

    closeOtherEditors(fieldItem);
    const editRow = fieldItem.querySelector(".field-edit-row");
    if (!editRow) return;

    editRow.innerHTML = "";
    const control = renderEditorControl(editRow, editor);
    if (!control) return;

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "field-confirm";
    confirmButton.dataset.fieldAction = "confirm";
    confirmButton.textContent = "✓";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "field-cancel";
    cancelButton.dataset.fieldAction = "cancel";
    cancelButton.textContent = "✕";
    editRow.append(confirmButton, cancelButton);

    fieldItem._editorConfig = editor;
    fieldItem.classList.add("is-editing");
    window.requestAnimationFrame(() => control.focus());
  }

  async function applyFieldEditor(fieldItem) {
    const panel = fieldItem?.closest(".workspace-panel");
    const card = fieldItem?.closest(".background-card");
    const panelId = panel?.dataset.panel;
    const fieldName = fieldItem?.dataset.fieldName;
    const index = Number(card?.dataset.cardIndex || 0);
    const controller = panelId ? controllers()[panelId] : null;
    const editor = fieldItem?._editorConfig;
    const control = fieldItem?.querySelector(".field-select, .field-input");
    if (!fieldItem || !panelId || !fieldName || !controller?.applyFieldValue || !editor || !control) return;

    const nextValue = normalizeEditorSubmission(editor, control);
    const result = await controller.applyFieldValue(index, fieldName, nextValue);
    closeFieldEditor(fieldItem);

    if (result?.skipped) {
      showToast("槽位已锁定", `${PANEL_CONFIG[panelId]?.label || panelId} 的第 ${index + 1} 个卡位当前不会被覆盖。`, panelId);
      return;
    }

    showToast("字段已更新", `${fieldName} 已改为手动选择值，并自动刷新了关联字段。`, panelId);
  }

  async function triggerModuleReroll(button) {
    const panel = button?.closest(".workspace-panel");
    const card = button?.closest(".background-card");
    const section = button?.closest(".card-section");
    const panelId = panel?.dataset.panel;
    const moduleName = button?.dataset.moduleName || section?.dataset.moduleName;
    const index = Number(card?.dataset.cardIndex || 0);
    const controller = panelId ? controllers()[panelId] : null;
    if (!panelId || !moduleName || !controller?.rerollModule) return;

    const result = await controller.rerollModule(index, moduleName);
    if (result?.skipped) {
      showToast("槽位已锁定", `${PANEL_CONFIG[panelId]?.label || panelId} 的第 ${index + 1} 个卡位当前不会被覆盖。`, panelId);
      return;
    }

    const visibleName = section?.querySelector("h5")?.textContent?.trim() || moduleName;
    showToast("模块已重刷", `${visibleName} 已按当前上下文重新生成。`, panelId);
  }

  function enhancePanel(panelId) {
    updateStatsVisibility(panelId);
    enhanceEmptyState(panelId);
    decorateResults(panelId);
  }

  function enhanceAllPanels() {
    Object.keys(PANEL_CONFIG).forEach(enhancePanel);
    const relationshipEmpty = document.querySelector(".relationship-empty");
    if (relationshipEmpty && !relationshipEmpty.querySelector(".empty-icon")) {
      relationshipEmpty.insertAdjacentHTML("afterbegin", buildEmptyIcon("relationship"));
    }
  }

  function globalSelectedIndex() {
    const backgroundState = getState("background");
    if (Number.isFinite(Number(backgroundState?.selectedIndex))) return Number(backgroundState.selectedIndex);
    return 0;
  }

  function syncSelectedIndex(index) {
    const registry = controllers();
    let canonicalIndex = Number(index) || 0;
    if (registry.background?.setSelectedIndex) {
      canonicalIndex = Number(registry.background.setSelectedIndex(canonicalIndex) || 0);
    }

    Object.entries(registry).forEach(([panelId, controller]) => {
      if (panelId === "background") return;
      if (controller?.setSelectedIndex) controller.setSelectedIndex(canonicalIndex);
    });
    updateStatus(`当前工作槽位已切换到第 ${canonicalIndex + 1} 位人物。串联生成会按 ${chainSequenceText()} 的顺序围绕这个槽位工作。${privatePanelsEnabled() ? " 偏好档案可单独补充。" : ""}`);
    enhanceAllPanels();
    return canonicalIndex;
  }

  async function copyText(text, panelId) {
    const content = String(text || "").trim();
    if (!content) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      showToast("已复制字段值", content.length > 24 ? `${content.slice(0, 24)}...` : content, panelId);
    } catch (error) {
      console.warn("复制失败", error);
      showToast("复制失败", "浏览器拒绝了复制请求，请手动复制。", panelId);
    }
  }

  function readBridge() {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_BRIDGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn("读取工作台桥接数据失败", error);
      return {};
    }
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportPackage() {
    const index = globalSelectedIndex();
    const registry = controllers();
    const bridge = readBridge();
    const includePrivate = privatePanelsEnabled();
    const payload = {
      generatedAt: new Date().toISOString(),
      selectedIndex: index,
      bodyAppearance: registry.body?.exportResult?.(index) || null,
      background: registry.background?.exportResult?.(index) || null,
      personality: registry.personality?.exportResult?.(index) || null,
      intimate: includePrivate ? (registry.appearance?.exportResult?.(index) || null) : null,
      fetish: includePrivate ? (registry.fetish?.exportResult?.(index) || null) : null,
      bridgeSummary: {
        privateMode: includePrivate ? "expanded" : "collapsed",
        fetishSeed: bridge.fetishSeed || "",
        activeProfile: bridge.activeProfile || null,
        activePersonalityProfile: bridge.activePersonalityProfile || null,
      },
    };

    downloadJson(`最终人物包_${Date.now()}.json`, payload);
    showToast("导出完成", `已导出第 ${index + 1} 位人物的${includePrivate ? "完整" : "公开版"}人物包。`, "background");
  }

  function extractBodyType(profile) {
    return profile?.["整体轮廓"]?.["体态主型"] || "";
  }

  function spotlightPanel(panelId) {
    const panel = getPanel(panelId);
    if (!panel) return;
    panel.classList.add("is-spotlight");
    window.setTimeout(() => panel.classList.remove("is-spotlight"), 520);
  }

  async function runChainStep(panelId, label, callback) {
    activatePanel(panelId);
    updateStatus(label);
    spotlightPanel(panelId);
    await nextFrame();
    return callback();
  }

  async function handleChainGeneration() {
    const registry = controllers();
    const background = registry.background;
    const personality = registry.personality;
    const body = registry.body;
    const appearance = registry.appearance;
    const includePrivate = privatePanelsEnabled();

    if (!background || !personality || !body || (includePrivate && !appearance)) {
      showToast("无法串联生成", "工作台控制器尚未全部就绪。", "relationship");
      return;
    }

    ui.chainButton.disabled = true;
    ui.exportButton.disabled = true;

    try {
      await runChainStep("background", `步骤 1/${includePrivate ? 4 : 3}：生成人物背景中...`, () => background.generateBatch());
      let selectedIndex = Number(background.getState()?.selectedIndex ?? 0);
      selectedIndex = syncSelectedIndex(selectedIndex);

      const outcomes = [];

      outcomes.push(await runChainStep("personality", `步骤 2/${includePrivate ? 4 : 3}：读取背景并生成性格档案...`, () => {
        personality.setLinkedProfileIndex?.(selectedIndex);
        personality.applyLinkedProfile?.();
        personality.setSelectedIndex?.(selectedIndex);
        return personality.regenerateSlot?.(selectedIndex);
      }));

      outcomes.push(await runChainStep("body", `步骤 3/${includePrivate ? 4 : 3}：读取背景并生成人物外观...`, () => {
        body.setLinkedProfileIndex?.(selectedIndex);
        body.applyLinkedProfile?.();
        body.setSelectedIndex?.(selectedIndex);
        return body.regenerateSlot?.(selectedIndex);
      }));

      if (includePrivate) {
        const bodyType = extractBodyType(body.exportResult?.(selectedIndex));
        if (bodyType) {
          const bodyTypeSelect = document.getElementById("appearanceBodyType");
          if (bodyTypeSelect) bodyTypeSelect.value = bodyType;
        }

        outcomes.push(await runChainStep("appearance", "步骤 4/4：读取人物外观并生成私密档案...", () => {
          appearance.setLinkedProfileIndex?.(selectedIndex);
          appearance.applyLinkedProfile?.();
          appearance.setSelectedIndex?.(selectedIndex);
          return appearance.regenerateSlot?.(selectedIndex);
        }));
      }

      const skippedCount = outcomes.filter((item) => item?.skipped).length;

      activatePanel(includePrivate ? "appearance" : "body");
      updateStatus(`串联生成完成，当前仍围绕第 ${selectedIndex + 1} 位人物槽位工作。${skippedCount ? " 有锁定槽位被保留。" : ""}`);
      showToast(
        "串联生成完成",
        includePrivate
          ? `第 ${selectedIndex + 1} 位人物已沿背景、性格、人物外观和私密模块同步更新。`
          : `第 ${selectedIndex + 1} 位人物已沿背景、性格和人物外观同步更新。`,
        includePrivate ? "appearance" : "body"
      );
    } catch (error) {
      console.error("串联生成失败", error);
      updateStatus("串联生成失败，请打开控制台查看详情。");
      showToast("串联生成失败", error?.message || "请检查控制台日志。", "relationship");
    } finally {
      ui.chainButton.disabled = false;
      ui.exportButton.disabled = false;
      enhanceAllPanels();
    }
  }

  function handleDocumentClick(event) {
    const selectAction = event.target.closest('[data-card-action="select"]');
    if (selectAction) {
      const card = selectAction.closest(".background-card");
      const panel = selectAction.closest(".workspace-panel");
      if (!card || !panel) return;
      syncSelectedIndex(Number(card.dataset.cardIndex || 0));
      return;
    }

    const lockAction = event.target.closest('[data-card-action="lock"]');
    if (lockAction) {
      const card = lockAction.closest(".background-card");
      const panel = lockAction.closest(".workspace-panel");
      const panelId = panel?.dataset.panel;
      const controller = panelId ? controllers()[panelId] : null;
      if (!card || !panelId || !controller?.setLockedIndices) return;
      const locked = getLockedSet(panelId);
      const index = Number(card.dataset.cardIndex || 0);
      if (locked.has(index)) {
        locked.delete(index);
      } else {
        locked.add(index);
      }
      controller.setLockedIndices(Array.from(locked));
      enhancePanel(panelId);
      showToast(locked.has(index) ? "槽位已锁定" : "槽位已解锁", `${PANEL_CONFIG[panelId]?.label || panelId} 的第 ${index + 1} 个卡位${locked.has(index) ? "将在重新生成时保留。" : "会恢复参与生成。"}`, panelId);
      return;
    }

    const moduleReroll = event.target.closest(".module-reroll");
    if (moduleReroll) {
      event.preventDefault();
      event.stopPropagation();
      void triggerModuleReroll(moduleReroll);
      return;
    }

    const copyAction = event.target.closest('[data-field-action="copy"]');
    if (copyAction) {
      const fieldItem = copyAction.closest(".field-item");
      const fieldValue = fieldItem?.querySelector(".field-value");
      const panel = copyAction.closest(".workspace-panel");
      if (!fieldValue) return;
      event.preventDefault();
      event.stopPropagation();
      void copyText(fieldValue.textContent, panel?.dataset.panel || "background");
      return;
    }

    const confirmAction = event.target.closest('[data-field-action="confirm"]');
    if (confirmAction) {
      const fieldItem = confirmAction.closest(".field-item");
      event.preventDefault();
      event.stopPropagation();
      void applyFieldEditor(fieldItem);
      return;
    }

    const cancelAction = event.target.closest('[data-field-action="cancel"]');
    if (cancelAction) {
      const fieldItem = cancelAction.closest(".field-item");
      event.preventDefault();
      event.stopPropagation();
      closeFieldEditor(fieldItem);
      return;
    }

    const fieldValue = event.target.closest(".field-value.is-editable");
    if (fieldValue) {
      event.preventDefault();
      event.stopPropagation();
      void openFieldEditor(fieldValue);
      return;
    }

    const emptyAction = event.target.closest("[data-empty-action]");
    if (emptyAction) {
      const target = document.getElementById(emptyAction.dataset.emptyAction);
      target?.click();
      return;
    }

    const card = event.target.closest(".background-card");
    if (!card) return;
    if (event.target.closest("button, summary, a, input, select, textarea, pre")) return;
    syncSelectedIndex(Number(card.dataset.cardIndex || 0));
  }

  function handleDocumentKeydown(event) {
    const fieldValue = event.target.closest(".field-value.is-editable");
    if (fieldValue && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      void openFieldEditor(fieldValue);
      return;
    }

    const fieldControl = event.target.closest(".field-select, .field-input");
    if (!fieldControl) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeFieldEditor(fieldControl.closest(".field-item"));
      return;
    }
    if (event.key === "Enter" && !fieldControl.matches('select[multiple]')) {
      event.preventDefault();
      void applyFieldEditor(fieldControl.closest(".field-item"));
    }
  }

  function setupTabs() {
    ui.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        window.setTimeout(syncActivePanel, 0);
        updateStatus(`已切换到${PANEL_CONFIG[tab.dataset.panel]?.label || tab.dataset.panel}面板。`);
      });
    });
    syncActivePanel();
  }

  function init() {
    setPrivateMode(false, { announce: false });
    setupTabs();
    refreshAllControlSheets();
    enhanceAllPanels();

    ui.controlSheets.forEach((details) => {
      details.addEventListener("toggle", () => refreshControlSheet(details));
    });

    document.addEventListener("change", () => refreshAllControlSheets());
    document.addEventListener("input", () => refreshAllControlSheets());
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeydown);

    window.addEventListener("workspace:results-rendered", (event) => {
      const panelId = event.detail?.panelId;
      if (!panelId) {
        enhanceAllPanels();
        return;
      }
      refreshAllControlSheets();
      enhancePanel(panelId);
      if (panelId === "personality" || panelId === "background") enhancePanel("appearance");
    });

    ui.chainButton?.addEventListener("click", () => void handleChainGeneration());
    ui.exportButton?.addEventListener("click", () => void handleExportPackage());
    ui.privateToggle?.addEventListener("click", () => setPrivateMode(!privatePanelsEnabled()));

    const selectedIndex = globalSelectedIndex();
    syncSelectedIndex(selectedIndex);
  }

  init();
})();
