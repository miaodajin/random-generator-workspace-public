(() => {
  const DATA = window.INTIMATE_CATALOG_DATA;
  if (!DATA || !DATA["文件"]) {
    console.warn("私密部位数据包未加载。");
    return;
  }

  const ui = {
    count: document.getElementById("appearanceCount"),
    profileSelect: document.getElementById("appearanceProfileSelect"),
    ageGroup: document.getElementById("appearanceAgeGroup"),
    gender: document.getElementById("appearanceGender"),
    bodyType: document.getElementById("appearanceBodyType"),
    seed: document.getElementById("appearanceSeed"),
    generate: document.getElementById("appearanceGenerateButton"),
    useLinked: document.getElementById("appearanceUseLinkedButton"),
    export: document.getElementById("appearanceExportButton"),
    resultMeta: document.getElementById("appearanceResultMeta"),
    results: document.getElementById("appearanceResults"),
    notes: document.getElementById("appearanceNotes"),
    linkSummary: document.getElementById("appearanceLinkSummary"),
    statFields: document.getElementById("appearanceStatFields"),
    statBodyTypes: document.getElementById("appearanceStatBodyTypes"),
    statModes: document.getElementById("appearanceStatModes"),
  };

  if (!ui.profileSelect || !ui.ageGroup || !ui.gender || !ui.bodyType || !ui.seed) {
    return;
  }

  const files = DATA["文件"];
  const references = DATA["联动参考"] || {};
  const fieldDefs = files["字段定义"] || [];
  const baseLibrary = files["候选项基础库"] || {};
  const weightRules = files["年龄与性别权重规则"] || {};
  const derivedRules = files["派生规则"] || {};
  const meta = DATA["元数据"] || {};
  const WORKSPACE_BRIDGE_KEY = "role_generator_workspace_bridge_v1";
  const RANDOM_BODY_TYPE = "__random_body_type__";

  const fieldToBaseKey = {};
  fieldDefs.forEach((field) => {
    const source = String(field["来源"] || "");
    source.split("+").forEach((part) => {
      const trimmed = part.trim();
      if (trimmed.startsWith("候选项_基础库.")) {
        fieldToBaseKey[field["字段名"]] = trimmed.split(".", 2)[1];
      }
    });
  });

  const analFields = fieldDefs
    .filter((field) => field["归属模块"] === "肛门模块")
    .map((field) => field["字段名"]);
  const chestFields = fieldDefs
    .filter((field) => field["归属模块"] === "胸部模块")
    .map((field) => field["字段名"]);
  const genitalFields = fieldDefs
    .filter((field) => field["归属模块"] === "性器官模块")
    .map((field) => field["字段名"]);
  const sharedFields = Array.from(new Set(derivedRules["共享字段"] || []));
  const chestValueFields = chestFields.filter((fieldName) => fieldName !== "胸部模式");
  const genitalValueFields = genitalFields.filter((fieldName) => fieldName !== "性器官模式");
  const distinctFieldGroups = derivedRules["互斥字段组"] || [];
  const rerollMeta = buildRerollMeta();

  const state = {
    bridgeSignature: "",
    results: [],
    selectedIndex: 0,
    lockedIndices: new Set(),
    previousResultsByIndex: {},
  };

  class RNG {
    constructor(seed) {
      this.seed = seed >>> 0;
    }

    rand() {
      let t = this.seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  }

  function hashSeed(input) {
    const text = String(input || "").trim() || `${Date.now()}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function makeSeedValue() {
    return `intimate-${Date.now().toString(36)}`;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildSelect(select, values, defaultLabel) {
    select.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = defaultLabel;
    select.append(auto);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value.value;
      option.textContent = value.label;
      select.append(option);
    });
  }

  function weightedChoiceMap(rng, weightMap) {
    const entries = Object.entries(weightMap || {}).filter(([, weight]) => Number(weight) > 0);
    if (!entries.length) return "";
    const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
    let roll = rng.rand() * total;
    for (const [key, weight] of entries) {
      roll -= Number(weight);
      if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  function weightedChoiceRows(rng, rows, valueKey, weightKey = "weight") {
    if (!rows || !rows.length) return "";
    const weightMap = {};
    rows.forEach((row) => {
      weightMap[row[valueKey]] = Number(row[weightKey] ?? row["权重"] ?? 0);
    });
    if (Object.values(weightMap).reduce((sum, weight) => sum + weight, 0) <= 0) {
      return rows[0][valueKey];
    }
    return weightedChoiceMap(rng, weightMap);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function dispatchResultsRendered() {
    window.dispatchEvent(new CustomEvent("workspace:results-rendered", {
      detail: {
        panelId: "appearance",
        count: state.results.length,
        selectedIndex: state.selectedIndex,
      },
    }));
  }

  function normalizeIndex(index) {
    const numeric = Number(index);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
  }

  function updatePreviousSnapshot(index, value) {
    state.previousResultsByIndex[index] = value == null ? null : deepClone(value);
  }

  function highestLockedIndex() {
    return state.lockedIndices.size ? Math.max(...state.lockedIndices) : -1;
  }

  function selectedIndexWithin(length) {
    if (!length) return 0;
    return Math.max(0, Math.min(state.selectedIndex, length - 1));
  }

  function mergeWeightMaps(...maps) {
    const merged = {};
    maps.forEach((map) => {
      Object.entries(map || {}).forEach(([key, value]) => {
        merged[key] = (merged[key] || 0) + Number(value);
      });
    });
    return merged;
  }

  function buildRerollMeta() {
    const meta = {};
    [...chestFields, ...genitalFields, ...sharedFields, ...analFields].forEach((fieldName) => {
      meta[fieldName] = {
        mode: "solo",
        resets: [fieldName],
        hint: "只重抽这个字段。",
      };
    });
    meta["胸部模式"] = {
      mode: "linked",
      resets: chestFields.slice(),
      hint: "胸部模式会联动胸部模块里的全部字段。",
    };
    meta["性器官模式"] = {
      mode: "linked",
      resets: genitalFields.slice(),
      hint: "性器官模式会联动性器官模块里的全部字段。",
    };
    [
      {
        fields: ["高匹配物理刺激", "低匹配物理刺激"],
        hint: "高低匹配物理刺激会作为一组联动重抽。",
      },
      {
        fields: ["主敏感区", "次敏感区"],
        hint: "主次敏感区会作为一组联动重抽。",
      },
    ].forEach((group) => {
      group.fields.forEach((fieldName) => {
        if (!meta[fieldName]) return;
        meta[fieldName] = {
          mode: "linked",
          resets: group.fields.slice(),
          hint: group.hint,
        };
      });
    });
    return meta;
  }

  function normalizeAgeLabel(value) {
    const labels = references["年龄段"] || [];
    if (!value) return "";
    const cleaned = String(value).trim().replace(/岁/g, "");
    if (labels.includes(cleaned)) return cleaned;

    const numbers = (cleaned.match(/\d+/g) || []).map((item) => Number(item));
    if (!numbers.length) return "";
    if (numbers.length === 1) {
      const age = numbers[0];
      const match = (references["年龄段"] || []).find((label) => {
        const parts = label.split("-").map((item) => Number(item));
        return age >= parts[0] && age <= parts[1];
      });
      return match || "";
    }

    const start = numbers[0];
    const end = numbers[1];
    let best = "";
    let bestOverlap = -1;
    let bestDistance = Infinity;
    (references["年龄段"] || []).forEach((label) => {
      const parts = label.split("-").map((item) => Number(item));
      const overlap = Math.max(0, Math.min(end, parts[1]) - Math.max(start, parts[0]) + 1);
      const midpoint = (start + end) / 2;
      const center = (parts[0] + parts[1]) / 2;
      const distance = Math.abs(center - midpoint);
      if (overlap > bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
        best = label;
        bestOverlap = overlap;
        bestDistance = distance;
      }
    });
    return best;
  }

  function normalizeGenderLabel(value) {
    const labels = references["性别认同"] || [];
    if (!value) return "";
    const cleaned = String(value).trim();
    return labels.includes(cleaned) ? cleaned : "";
  }

  function normalizeOrientationLabel(value) {
    if (!value) return "";
    return String(value).trim();
  }

  function readBridge() {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_BRIDGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.warn("读取人物背景联动桥失败", error);
      return null;
    }
  }

  function syncProfileOptions() {
    const bridge = readBridge();
    const signature = JSON.stringify({
      updatedAt: bridge?.updatedAt || "",
      profiles: (bridge?.profiles || []).map((profile) => `${profile["姓名"] || ""}:${profile["年龄段"] || ""}:${profile["性别认同"] || ""}`),
    });
    if (signature === state.bridgeSignature) return bridge;

    const previous = ui.profileSelect.value;
    state.bridgeSignature = signature;
    ui.profileSelect.innerHTML = "";

    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "不联动，手动控制";
    ui.profileSelect.append(noneOption);

    (bridge?.profiles || []).forEach((profile, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${profile["姓名"] || `人物 ${index + 1}`} · ${profile["年龄段"] || "年龄未定"} · ${profile["性别认同"] || "性别未定"}`;
      ui.profileSelect.append(option);
    });

    if ((bridge?.profiles || []).length && previous !== "" && Number(previous) < bridge.profiles.length) {
      ui.profileSelect.value = previous;
    } else if ((bridge?.profiles || []).length && bridge?.profileIndex != null && Number(bridge.profileIndex) < bridge.profiles.length) {
      ui.profileSelect.value = String(bridge.profileIndex);
    } else if ((bridge?.profiles || []).length) {
      ui.profileSelect.value = "0";
    } else {
      ui.profileSelect.value = "";
    }
    renderLinkSummary(currentLinkedProfile());
    return bridge;
  }

  function currentLinkedProfile() {
    const bridge = readBridge();
    const value = ui.profileSelect.value;
    if (!bridge || value === "") return null;
    return bridge.profiles?.[Number(value)] || null;
  }

  function renderNotes() {
    const notes = [
      ...(meta["说明"] || []),
      "中性过渡模式会对共享字段默认关闭性别认同覆写，只保留必要的基础分布。",
      "体态主型的修长型联动已经补齐，不会再无声回退到纯基础权重。",
      "如果当前联动人物存在匹配的性格桥接摘要，私密页会额外读取情绪模式、依恋模式、强度偏好、新奇探索度、禁忌吸引度。",
    ];
    if (ui.notes) {
      ui.notes.innerHTML = notes.slice(0, 5).map((note, index) => `
        <article class="memo-item">
          <strong>说明 ${String(index + 1).padStart(2, "0")}</strong>
          <p>${escapeHtml(note)}</p>
        </article>
      `).join("");
    }

    ui.statFields.textContent = String(fieldDefs.length);
    ui.statBodyTypes.textContent = String((references["体态主型"] || []).length);
    const chestModes = Object.keys(derivedRules["胸部模式_按性别认同"]?.["女性"] || {}).length;
    const genitalModes = Object.keys(derivedRules["性器官模式_按性别认同"]?.["女性"] || {}).length;
    ui.statModes.textContent = String(chestModes + genitalModes);
  }

  function renderLinkSummary(profile) {
    if (!ui.linkSummary) return;
    const personality = currentLinkedPersonality();
    if (!profile) {
      ui.linkSummary.innerHTML = `
        <article class="fetish-summary-card">
          <strong>当前未联动背景人物</strong>
          <p>你可以直接手动指定年龄段和性别认同，也可以先在人物背景生成器里选一个人物再回来。</p>
          <p>未选择背景人物时，性格桥接规则不会启用。</p>
        </article>
      `;
      return;
    }

    ui.linkSummary.innerHTML = `
      <article class="fetish-summary-card">
        <strong>${escapeHtml(profile["姓名"] || "未命名人物")}</strong>
        <p>${escapeHtml(profile["年龄段"] || "年龄段未定")} · ${escapeHtml(profile["性别认同"] || "性别认同未定")} · ${escapeHtml(profile["性取向"] || "取向未定")} · ${escapeHtml(profile["常住城市"] || "城市未定")}</p>
        <p>${escapeHtml(profile["教育状态"] || "教育状态未定")} · ${escapeHtml(profile["职业大类"] || "职业未定")} · 体态主型仍可手动指定或保持不联动。</p>
        <p>${personality
          ? `已匹配性格桥：${escapeHtml([personality["情绪模式"], personality["依恋模式"], personality["强度偏好"], personality["新奇探索度"], personality["禁忌吸引度"]].filter(Boolean).join(" · "))}`
          : "当前未匹配到可用的性格桥接摘要，私密页只会应用体态联动。"
        }</p>
      </article>
    `;
  }

  function applyLinkedProfileToControls() {
    const profile = currentLinkedProfile();
    if (!profile) {
      renderLinkSummary(null);
      return;
    }
    const age = normalizeAgeLabel(profile["年龄段"]);
    const gender = normalizeGenderLabel(profile["性别认同"]);
    if (age) ui.ageGroup.value = age;
    if (gender) ui.gender.value = gender;
    renderLinkSummary(profile);
  }

  function buildProfileSignature(profile) {
    if (!profile) return "";
    const age = normalizeAgeLabel(profile["年龄段"] || profile["年龄"]);
    const city = String(profile["常住城市"] || profile["所在城市"] || "").trim();
    return [
      String(profile["姓名"] || "").trim(),
      age,
      String(profile["性别认同"] || "").trim(),
      city,
    ].join("::");
  }

  function currentLinkedPersonality() {
    const bridge = readBridge();
    const linkedProfile = currentLinkedProfile();
    const personality = bridge?.activePersonalityProfile;
    const expectedSignature = buildProfileSignature(linkedProfile);
    const actualSignature = personality?.sourceSignature || bridge?.personalityLinkedSignature || "";
    if (!linkedProfile || !personality || !expectedSignature || !actualSignature) {
      return null;
    }
    return expectedSignature === actualSignature ? personality : null;
  }

  function fieldBaseWeights(fieldName) {
    const baseKey = fieldToBaseKey[fieldName];
    const rows = baseLibrary[baseKey] || [];
    const weights = {};
    rows.forEach((row) => {
      weights[row["标识"]] = Number(row["权重"]);
    });
    return weights;
  }

  function matchesCondition(condition, selectedValues, context) {
    if (!condition) return true;
    if (Array.isArray(condition["全部满足"])) {
      return condition["全部满足"].every((entry) => matchesCondition(entry, selectedValues, context));
    }
    return Object.entries(condition).every(([key, expectedValues]) => {
      if (key === "全部满足") return true;
      if (!key.endsWith("属于")) return true;
      const fieldName = key.slice(0, -2);
      const actual = selectedValues[fieldName]
        ?? ({
          "年龄段": context.ageGroup,
          "性别认同": context.gender,
          "体态主型": context.bodyType,
          "情绪模式": context.personalityProfile?.["情绪模式"] || "",
          "依恋模式": context.personalityProfile?.["依恋模式"] || "",
          "强度偏好": context.personalityProfile?.["强度偏好"] || "",
          "新奇探索度": context.personalityProfile?.["新奇探索度"] || "",
          "禁忌吸引度": context.personalityProfile?.["禁忌吸引度"] || "",
        }[fieldName] || "");
      return (expectedValues || []).includes(actual);
    });
  }

  function ruleBoostsForField(fieldName, rules, selectedValues, context) {
    let combined = {};
    (rules || []).forEach((rule) => {
      if (!matchesCondition(rule["条件"], selectedValues, context)) return;
      combined = mergeWeightMaps(combined, rule["提升权重"]?.[fieldName] || {});
    });
    return combined;
  }

  function resolveFieldWeights(fieldName, context, genitalMode, selectedValues = {}) {
    const base = fieldBaseWeights(fieldName);
    const overrides = weightRules["字段覆写"]?.[fieldName] || {};
    const neutralPolicy = derivedRules["中性过渡共享字段策略"] || {};

    const ignoreGender = genitalMode === "中性过渡轮廓型" && (neutralPolicy["忽略性别认同覆写"] || []).includes(fieldName);
    const onlyBase = genitalMode === "中性过渡轮廓型" && (neutralPolicy["仅使用基础权重"] || []).includes(fieldName);
    const allowAge = genitalMode !== "中性过渡轮廓型" || (neutralPolicy["保留年龄段覆写"] || []).includes(fieldName);

    const parts = [base];
    if (!onlyBase) {
      const genderMap = overrides["性别认同"]?.[context.gender];
      const ageMap = overrides["年龄段"]?.[context.ageGroup];
      if (genderMap && !ignoreGender) parts.push(genderMap);
      if (ageMap && allowAge) parts.push(ageMap);
    }

    const externalBoosts = ruleBoostsForField(
      fieldName,
      derivedRules["跨库联动输入规则"] || [],
      selectedValues,
      context,
    );
    const internalBoosts = ruleBoostsForField(
      fieldName,
      derivedRules["联动规则"] || [],
      selectedValues,
      context,
    );
    return mergeWeightMaps(mergeWeightMaps(...parts), externalBoosts, internalBoosts);
  }

  function pickFieldValue(rng, fieldName, context, genitalMode = "", selectedValues = {}) {
    return weightedChoiceMap(rng, resolveFieldWeights(fieldName, context, genitalMode, selectedValues));
  }

  function pickDistinctFieldValue(rng, fieldName, context, genitalMode = "", blockedValues = [], selectedValues = {}) {
    const weights = resolveFieldWeights(fieldName, context, genitalMode, selectedValues);
    const filtered = Object.fromEntries(
      Object.entries(weights).filter(([key, weight]) => Number(weight) > 0 && !blockedValues.includes(key))
    );
    if (Object.keys(filtered).length) {
      return weightedChoiceMap(rng, filtered);
    }
    return weightedChoiceMap(rng, weights);
  }

  function enforceDistinctFields(rng, module, source, context, genitalMode = "") {
    distinctFieldGroups.forEach((group) => {
      const seen = new Set();
      group.forEach((fieldName) => {
        if (!(fieldName in module)) return;
        let value = module[fieldName];
        let attempts = 0;
        while (seen.has(value) && attempts < 12) {
          value = pickDistinctFieldValue(rng, fieldName, context, genitalMode, Array.from(seen), module);
          attempts += 1;
        }
        module[fieldName] = value;
        source.fixedValues[fieldName] = value;
        seen.add(value);
      });
    });
  }

  function determineContext(rng) {
    const linkedProfile = currentLinkedProfile();
    const manualAge = ui.ageGroup.value;
    const manualGender = ui.gender.value;
    const bodySelection = ui.bodyType.value;

    const ageGroup = linkedProfile ? (normalizeAgeLabel(linkedProfile["年龄段"]) || manualAge) : (manualAge || weightedChoiceRows(rng, (references["年龄段"] || []).map((label) => ({ label, weight: 1 })), "label"));
    const gender = linkedProfile ? (normalizeGenderLabel(linkedProfile["性别认同"]) || manualGender) : (manualGender || weightedChoiceRows(rng, (references["性别认同"] || []).map((label) => ({ label, weight: 1 })), "label"));

    let bodyType = "";
    if (bodySelection === RANDOM_BODY_TYPE) {
      bodyType = weightedChoiceRows(rng, references["体态主型候选项"] || [], "标识", "权重");
    } else {
      bodyType = bodySelection || "";
    }

    const personalityProfile = currentLinkedPersonality();

    return {
      ageGroup,
      gender,
      orientation: linkedProfile ? normalizeOrientationLabel(linkedProfile["性取向"]) : "",
      bodyType,
      linkedProfile,
      personalityProfile,
    };
  }

  function chestModeWeightsForContext(context) {
    const weights = { ...(derivedRules["胸部模式_按性别认同"]?.[context.gender] || {}) };
    if (
      context.linkedProfile &&
      context.gender === "男性" &&
      context.orientation === "异性恋"
    ) {
      delete weights["乳房轮廓型"];
      if (!Object.keys(weights).length) {
        return { "胸廓轮廓型": 88, "平胸轮廓型": 12 };
      }
    }
    return weights;
  }

  function createProfileSource(rng) {
    const context = determineContext(rng);
    return {
      ageGroup: context.ageGroup,
      gender: context.gender,
      orientation: context.orientation || "",
      bodyType: context.bodyType,
      linkedProfile: context.linkedProfile ? deepClone(context.linkedProfile) : null,
      personalityProfile: context.personalityProfile ? deepClone(context.personalityProfile) : null,
      fixedValues: {},
    };
  }

  function buildProfileFromSource(rng, source) {
    const nextSource = {
      ageGroup: source.ageGroup,
      gender: source.gender,
      orientation: source.orientation || "",
      bodyType: source.bodyType || "",
      linkedProfile: source.linkedProfile ? deepClone(source.linkedProfile) : null,
      personalityProfile: source.personalityProfile ? deepClone(source.personalityProfile) : null,
      fixedValues: deepClone(source.fixedValues || {}),
    };
    const context = {
      ageGroup: nextSource.ageGroup,
      gender: nextSource.gender,
      orientation: nextSource.orientation,
      bodyType: nextSource.bodyType,
      linkedProfile: nextSource.linkedProfile,
      personalityProfile: nextSource.personalityProfile,
    };
    const selectedValues = {
      "年龄段": nextSource.ageGroup,
      "性别认同": nextSource.gender,
      "体态主型": nextSource.bodyType || "",
      "情绪模式": nextSource.personalityProfile?.["情绪模式"] || "",
      "依恋模式": nextSource.personalityProfile?.["依恋模式"] || "",
      "强度偏好": nextSource.personalityProfile?.["强度偏好"] || "",
      "新奇探索度": nextSource.personalityProfile?.["新奇探索度"] || "",
      "禁忌吸引度": nextSource.personalityProfile?.["禁忌吸引度"] || "",
    };

    const chestModeWeights = chestModeWeightsForContext(context);
    const fixedChestMode = nextSource.fixedValues["胸部模式"];
    const chestMode = fixedChestMode && Object.prototype.hasOwnProperty.call(chestModeWeights, fixedChestMode)
      ? fixedChestMode
      : weightedChoiceMap(rng, chestModeWeights);
    nextSource.fixedValues["胸部模式"] = chestMode;
    selectedValues["胸部模式"] = chestMode;

    const chestModule = { "胸部模式": chestMode };
    (derivedRules["胸部条件字段"]?.[chestMode] || []).forEach((fieldName) => {
      const weights = resolveFieldWeights(fieldName, context, "", selectedValues);
      const fixed = nextSource.fixedValues[fieldName];
      const value = fixed && Object.prototype.hasOwnProperty.call(weights, fixed)
        ? fixed
        : weightedChoiceMap(rng, weights);
      chestModule[fieldName] = value;
      nextSource.fixedValues[fieldName] = value;
      selectedValues[fieldName] = value;
    });

    const genitalModeWeights = derivedRules["性器官模式_按性别认同"]?.[context.gender] || {};
    const fixedGenitalMode = nextSource.fixedValues["性器官模式"];
    const genitalMode = fixedGenitalMode && Object.prototype.hasOwnProperty.call(genitalModeWeights, fixedGenitalMode)
      ? fixedGenitalMode
      : weightedChoiceMap(rng, genitalModeWeights);
    nextSource.fixedValues["性器官模式"] = genitalMode;
    selectedValues["性器官模式"] = genitalMode;

    const genitalModule = { "性器官模式": genitalMode };
    const genitalFields = Array.from(new Set([
      ...(derivedRules["性器官条件字段"]?.[genitalMode] || []),
      ...(derivedRules["共享字段"] || []),
    ]));
    genitalFields.forEach((fieldName) => {
      const weights = resolveFieldWeights(fieldName, context, genitalMode, selectedValues);
      const fixed = nextSource.fixedValues[fieldName];
      const value = fixed && Object.prototype.hasOwnProperty.call(weights, fixed)
        ? fixed
        : weightedChoiceMap(rng, weights);
      genitalModule[fieldName] = value;
      nextSource.fixedValues[fieldName] = value;
      selectedValues[fieldName] = value;
    });
    enforceDistinctFields(rng, genitalModule, nextSource, context, genitalMode);

    const analModule = {};
    analFields.forEach((fieldName) => {
      const weights = resolveFieldWeights(fieldName, context, "", selectedValues);
      const fixed = nextSource.fixedValues[fieldName];
      const value = fixed && Object.prototype.hasOwnProperty.call(weights, fixed)
        ? fixed
        : weightedChoiceMap(rng, weights);
      analModule[fieldName] = value;
      nextSource.fixedValues[fieldName] = value;
      selectedValues[fieldName] = value;
    });

    return {
      "输入上下文": {
        "年龄段": nextSource.ageGroup,
        "性别认同": nextSource.gender,
        "性取向": nextSource.orientation || "",
        "体态主型": nextSource.bodyType || "不联动",
        "情绪模式": nextSource.personalityProfile?.["情绪模式"] || "",
        "依恋模式": nextSource.personalityProfile?.["依恋模式"] || "",
        "强度偏好": nextSource.personalityProfile?.["强度偏好"] || "",
        "新奇探索度": nextSource.personalityProfile?.["新奇探索度"] || "",
        "禁忌吸引度": nextSource.personalityProfile?.["禁忌吸引度"] || "",
        "是否启用性格联动": nextSource.personalityProfile ? "是" : "否",
        "联动人物": nextSource.linkedProfile ? {
          "姓名": nextSource.linkedProfile["姓名"] || "",
          "性取向": nextSource.linkedProfile["性取向"] || "",
          "常住城市": nextSource.linkedProfile["常住城市"] || "",
        } : null,
      },
      "胸部模块": chestModule,
      "性器官模块": genitalModule,
      "肛门模块": analModule,
      "_meta": {
        source: nextSource,
      },
    };
  }

  function readProfileSource(profile) {
    if (profile?._meta?.source) {
      return deepClone(profile._meta.source);
    }

    const source = {
      ageGroup: normalizeAgeLabel(profile?.["输入上下文"]?.["年龄段"]),
      gender: normalizeGenderLabel(profile?.["输入上下文"]?.["性别认同"]),
      orientation: normalizeOrientationLabel(profile?.["输入上下文"]?.["性取向"]),
      bodyType: profile?.["输入上下文"]?.["体态主型"] === "不联动" ? "" : (profile?.["输入上下文"]?.["体态主型"] || ""),
      linkedProfile: profile?.["输入上下文"]?.["联动人物"] ? deepClone(profile["输入上下文"]["联动人物"]) : null,
      personalityProfile: profile?.["输入上下文"]?.["是否启用性格联动"] === "是" ? {
        "情绪模式": profile?.["输入上下文"]?.["情绪模式"] || "",
        "依恋模式": profile?.["输入上下文"]?.["依恋模式"] || "",
        "强度偏好": profile?.["输入上下文"]?.["强度偏好"] || "",
        "新奇探索度": profile?.["输入上下文"]?.["新奇探索度"] || "",
        "禁忌吸引度": profile?.["输入上下文"]?.["禁忌吸引度"] || "",
        "sourceSignature": buildProfileSignature(profile?.["输入上下文"]?.["联动人物"] || null),
      } : null,
      fixedValues: {},
    };

    Object.entries(profile?.["胸部模块"] || {}).forEach(([key, value]) => {
      source.fixedValues[key] = value;
    });
    Object.entries(profile?.["性器官模块"] || {}).forEach(([key, value]) => {
      source.fixedValues[key] = value;
    });
    Object.entries(profile?.["肛门模块"] || {}).forEach(([key, value]) => {
      source.fixedValues[key] = value;
    });
    return source;
  }

  function equalValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function rerollField(profileIndex, fieldName) {
    const current = state.results[profileIndex];
    if (!current) return;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, current);

    const config = rerollMeta[fieldName] || { resets: [fieldName] };
    const currentValue = current?.["胸部模块"]?.[fieldName]
      ?? current?.["性器官模块"]?.[fieldName]
      ?? current?.["肛门模块"]?.[fieldName]
      ?? "";

    let nextProfile = current;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const source = readProfileSource(current);
      config.resets.forEach((resetField) => {
        delete source.fixedValues[resetField];
      });
      const rng = new RNG(hashSeed(`${ui.seed.value || "intimate"}:${profileIndex}:${fieldName}:${Date.now()}:${attempt}:${Math.random()}`));
      nextProfile = buildProfileFromSource(rng, source);
      const nextValue = nextProfile?.["胸部模块"]?.[fieldName]
        ?? nextProfile?.["性器官模块"]?.[fieldName]
        ?? nextProfile?.["肛门模块"]?.[fieldName]
        ?? "";
      if (!equalValue(nextValue, currentValue)) {
        break;
      }
    }

    state.results[profileIndex] = nextProfile;
    state.selectedIndex = profileIndex;
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(state.results[profileIndex]) };
  }

  function findFieldValue(profile, fieldName) {
    return profile?.["胸部模块"]?.[fieldName]
      ?? profile?.["性器官模块"]?.[fieldName]
      ?? profile?.["肛门模块"]?.[fieldName]
      ?? "";
  }

  function visibleModuleFields(profile, moduleName) {
    return Object.keys(profile?.[moduleName] || {});
  }

  function rerollModule(profileIndex, moduleName) {
    const current = state.results[profileIndex];
    if (!current) return null;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, current);

    const resetFields = new Set();
    visibleModuleFields(current, moduleName).forEach((fieldName) => {
      (rerollMeta[fieldName]?.resets || [fieldName]).forEach((resetField) => resetFields.add(resetField));
    });
    if (!resetFields.size) return null;

    const source = readProfileSource(current);
    resetFields.forEach((fieldName) => {
      delete source.fixedValues[fieldName];
    });

    const rng = new RNG(hashSeed(`${ui.seed.value || "intimate"}:${profileIndex}:${moduleName}:module:${Date.now()}:${Math.random()}`));
    state.results[profileIndex] = buildProfileFromSource(rng, source);
    state.selectedIndex = profileIndex;
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(state.results[profileIndex]) };
  }

  function getFieldOptions(profile, fieldName) {
    const source = readProfileSource(profile);
    if (fieldName === "胸部模式") {
      return Object.keys(chestModeWeightsForContext({
        gender: source.gender,
        orientation: source.orientation,
        linkedProfile: source.linkedProfile,
      }) || {}).map((value) => ({ value, label: value }));
    }
    if (fieldName === "性器官模式") {
      return Object.keys(derivedRules["性器官模式_按性别认同"]?.[source.gender] || {}).map((value) => ({ value, label: value }));
    }

    const baseKey = fieldToBaseKey[fieldName];
    const rows = baseLibrary[baseKey] || [];
    return rows
      .map((row) => ({
        value: String(row["标识"] || row["名称"] || ""),
        label: String(row["名称"] || row["标识"] || ""),
      }))
      .filter((row) => row.value);
  }

  function getFieldEditor(profileIndex, fieldName) {
    const profile = state.results[normalizeIndex(profileIndex)];
    if (!profile) return null;
    const options = getFieldOptions(profile, fieldName);
    if (!options.length) return null;
    return {
      type: "select",
      value: String(findFieldValue(profile, fieldName) || ""),
      options,
    };
  }

  function applyFieldValue(profileIndex, fieldName, nextValue) {
    const current = state.results[profileIndex];
    if (!current) return null;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, current);

    const source = readProfileSource(current);
    const config = rerollMeta[fieldName] || { resets: [fieldName] };
    config.resets.forEach((resetField) => {
      if (resetField === fieldName) return;
      delete source.fixedValues[resetField];
    });
    source.fixedValues[fieldName] = String(nextValue ?? "").trim();

    const rng = new RNG(hashSeed(`${ui.seed.value || "intimate"}:${profileIndex}:${fieldName}:manual:${Date.now()}:${Math.random()}`));
    state.results[profileIndex] = buildProfileFromSource(rng, source);
    state.selectedIndex = profileIndex;
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(state.results[profileIndex]) };
  }

  function renderFieldList(profileIndex, fields) {
    return `
      <div class="field-grid">
        ${fields.map(([label, value]) => `
          <div class="field-item" data-field-name="${escapeHtml(label)}">
            <div class="field-head">
              <span class="field-label">${escapeHtml(label)}</span>
              <div class="field-actions">
                ${rerollMeta[label] ? `
                  <button
                    class="field-reroll ${rerollMeta[label].mode === "linked" ? "is-linked" : "is-solo"}"
                    data-intimate-profile-index="${profileIndex}"
                    data-intimate-reroll-field="${escapeHtml(label)}"
                    title="${escapeHtml(rerollMeta[label].hint)}"
                  >
                    ${rerollMeta[label].mode === "linked" ? "联动" : "重roll"}
                  </button>
                ` : ""}
              </div>
            </div>
            <span class="field-value">${escapeHtml(value || "—")}</span>
            <div class="field-edit-row"></div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderResultCard(profile, index) {
    const context = profile["输入上下文"] || {};
    const linked = context["联动人物"];
    const topLine = linked
      ? `${linked["姓名"] || "联动人物"} · ${linked["常住城市"] || "城市未定"}`
      : "手动控制或完全随机";

    return `
      <article class="background-card" data-card-index="${index}">
        <div class="card-top">
          <div>
            <h4>私密档案 ${String(index + 1).padStart(2, "0")}</h4>
            <div class="card-subline">${escapeHtml(topLine)}</div>
          </div>
          <div class="chip-row">
            <span class="value-chip accent">${escapeHtml(context["年龄段"] || "")}</span>
            <span class="value-chip">${escapeHtml(context["性别认同"] || "")}</span>
            <span class="value-chip">${escapeHtml(context["体态主型"] || "")}</span>
          </div>
        </div>

        <div class="card-modules-grid">
          <section class="card-section" data-module-name="胸部模块">
            <div class="section-head-row">
              <h5>胸部模块</h5>
              <button class="module-reroll" type="button" data-module-name="胸部模块">重刷</button>
            </div>
            ${renderFieldList(index, Object.entries(profile["胸部模块"] || {}))}
          </section>

          <section class="card-section" data-module-name="性器官模块">
            <div class="section-head-row">
              <h5>性器官模块</h5>
              <button class="module-reroll" type="button" data-module-name="性器官模块">重刷</button>
            </div>
            ${renderFieldList(index, Object.entries(profile["性器官模块"] || {}))}
          </section>

          <section class="card-section" data-module-name="肛门模块">
            <div class="section-head-row">
              <h5>肛门模块</h5>
              <button class="module-reroll" type="button" data-module-name="肛门模块">重刷</button>
            </div>
            ${renderFieldList(index, Object.entries(profile["肛门模块"] || {}))}
          </section>
        </div>

        <details class="raw-box">
          <summary>查看原始 JSON</summary>
          <pre>${escapeHtml(JSON.stringify(profile, null, 2))}</pre>
        </details>
      </article>
    `;
  }

  function renderResults() {
    if (!state.results.length) {
      ui.results.innerHTML = `
        <div class="empty-state">
          <p class="empty-title">私密档案还没生成</p>
          <p class="empty-copy">先点上面的“生成私密档案”，这里会输出胸部、性器官和肛门模块的完整组合，并在可用时自动叠加性格桥接。</p>
        </div>
      `;
      ui.resultMeta.textContent = "尚未生成";
      dispatchResultsRendered();
      return;
    }
    ui.results.innerHTML = state.results.map((profile, index) => renderResultCard(profile, index)).join("");
    const linked = currentLinkedProfile();
    const personality = currentLinkedPersonality();
    ui.resultMeta.textContent = `${state.results.length} 份档案 · 种子 ${ui.seed.value || "自动"}${linked ? ` · 联动 ${linked["姓名"] || "当前人物"}` : ""}${personality ? " · 性格桥接已启用" : " · 未启用性格桥接"} · 字段右侧支持重roll/联动`;
    dispatchResultsRendered();
  }

  function generateBatch() {
    syncProfileOptions();
    const seedValue = ui.seed.value.trim() || makeSeedValue();
    ui.seed.value = seedValue;
    const rng = new RNG(hashSeed(seedValue));
    const count = 1;
    const previousFull = state.results.map((profile) => deepClone(profile));
    state.previousResultsByIndex = Object.fromEntries(previousFull.map((profile, index) => [index, deepClone(profile)]));
    const targetLength = count;
    const nextResults = Array.from({ length: targetLength }, (_, index) => {
      const itemRng = new RNG(hashSeed(`${seedValue}:${index}:${rng.rand()}`));
      return buildProfileFromSource(itemRng, createProfileSource(itemRng));
    });
    state.lockedIndices.forEach((index) => {
      if (previousFull[index]) nextResults[index] = deepClone(previousFull[index]);
    });
    state.results = nextResults;
    state.selectedIndex = selectedIndexWithin(state.results.length);
    renderLinkSummary(currentLinkedProfile());
    renderResults();
    return deepClone(state.results);
  }

  function exportJson() {
    if (!state.results.length) return;
    const payload = {
      "元信息": {
        "生成时间": new Date().toISOString(),
        "来源": "随机生成器工作台/身体私密生成器",
        "数量": state.results.length,
        "种子": ui.seed.value || "",
      },
      "档案列表": state.results,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `私密档案_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function setSelectedIndex(index) {
    state.selectedIndex = 0;
    renderResults();
    return state.selectedIndex;
  }

  function setLockedIndices(indices) {
    state.lockedIndices = new Set((indices || []).some((value) => normalizeIndex(value) === 0) ? [0] : []);
    renderResults();
  }

  function regenerateSlot(index) {
    const slotIndex = 0;
    if (state.lockedIndices.has(slotIndex)) {
      return { skipped: true, reason: "locked", index: slotIndex };
    }

    syncProfileOptions();
    const seedValue = ui.seed.value.trim() || makeSeedValue();
    ui.seed.value = seedValue;
    const rng = new RNG(hashSeed(seedValue));
    const targetLength = 1;
    const nextResults = Array.from({ length: targetLength }, (_, currentIndex) => {
      if (currentIndex === slotIndex || !state.results[currentIndex]) {
        const itemRng = new RNG(hashSeed(`${seedValue}:${currentIndex}:${rng.rand()}`));
        return buildProfileFromSource(itemRng, createProfileSource(itemRng));
      }
      return state.results[currentIndex];
    });

    updatePreviousSnapshot(slotIndex, state.results[slotIndex] || null);
    state.results = nextResults;
    state.selectedIndex = slotIndex;
    renderLinkSummary(currentLinkedProfile());
    renderResults();
    return { skipped: false, index: slotIndex, profile: deepClone(state.results[slotIndex]) };
  }

  function setLinkedProfileIndex(index) {
    syncProfileOptions();
    ui.profileSelect.value = String(normalizeIndex(index));
    renderLinkSummary(currentLinkedProfile());
  }

  function registerController() {
    const registry = window.generatorWorkspaceControllers || (window.generatorWorkspaceControllers = {});
    registry.appearance = {
      getState() {
        return {
          results: deepClone(state.results),
          selectedIndex: state.selectedIndex,
          lockedIndices: Array.from(state.lockedIndices),
          previousResultsByIndex: deepClone(state.previousResultsByIndex),
        };
      },
      setSelectedIndex,
      generateBatch,
      regenerateSlot,
      setLockedIndices,
      rerollModule,
      getFieldEditor,
      applyFieldValue,
      exportResult(index) {
        return deepClone(state.results[0] || null);
      },
      setLinkedProfileIndex,
      applyLinkedProfile: applyLinkedProfileToControls,
    };
  }

  function setupControls() {
    buildSelect(ui.ageGroup, (references["年龄段"] || []).map((label) => ({ value: label, label })), "随机");
    buildSelect(ui.gender, (references["性别认同"] || []).map((label) => ({ value: label, label })), "随机");
    buildSelect(ui.bodyType, [
      { value: RANDOM_BODY_TYPE, label: "随机体态主型" },
      ...(references["体态主型"] || []).map((label) => ({ value: label, label })),
    ], "不联动");
    syncProfileOptions();
    renderNotes();
    renderLinkSummary(currentLinkedProfile());
    ui.seed.value = makeSeedValue();
    renderResults();
  }

  function bindEvents() {
    ui.profileSelect.addEventListener("change", () => renderLinkSummary(currentLinkedProfile()));
    ui.generate.addEventListener("click", generateBatch);
    ui.useLinked.addEventListener("click", applyLinkedProfileToControls);
    ui.export.addEventListener("click", exportJson);
    ui.results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-intimate-reroll-field]");
      if (!button) return;
      rerollField(Number(button.dataset.intimateProfileIndex), button.dataset.intimateRerollField);
    });
    window.addEventListener("storage", (event) => {
      if (event.key === WORKSPACE_BRIDGE_KEY) {
        syncProfileOptions();
      }
    });
  }

  setupControls();
  registerController();
  bindEvents();
  setInterval(syncProfileOptions, 1200);
})();
