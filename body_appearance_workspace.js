(() => {
  const DATA = window.CHARACTER_BODY_APPEARANCE_DATA;
  if (!DATA || !DATA["文件"]) {
    console.warn("身体外观数据包未加载。");
    return;
  }

  const ui = {
    count: document.getElementById("bodyAppearanceCount"),
    profileSelect: document.getElementById("bodyAppearanceProfileSelect"),
    ageGroup: document.getElementById("bodyAppearanceAgeGroup"),
    gender: document.getElementById("bodyAppearanceGender"),
    bodyType: document.getElementById("bodyAppearanceBodyType"),
    seed: document.getElementById("bodyAppearanceSeed"),
    generate: document.getElementById("bodyAppearanceGenerateButton"),
    useLinked: document.getElementById("bodyAppearanceUseLinkedButton"),
    export: document.getElementById("bodyAppearanceExportButton"),
    resultMeta: document.getElementById("bodyAppearanceResultMeta"),
    results: document.getElementById("bodyAppearanceResults"),
    notes: document.getElementById("bodyAppearanceNotes"),
    summary: document.getElementById("bodyAppearanceSummary"),
    statModules: document.getElementById("bodyAppearanceStatModules"),
    statFields: document.getElementById("bodyAppearanceStatFields"),
    statLinks: document.getElementById("bodyAppearanceStatLinks"),
  };

  if (!ui.profileSelect || !ui.ageGroup || !ui.gender || !ui.bodyType || !ui.seed) {
    return;
  }

  const files = DATA["文件"];
  const meta = DATA["元数据"] || {};
  const fieldDefs = files["字段定义"] || [];
  const baseLibrary = files["候选项基础库"] || {};
  const weightRules = files["年龄与性别权重规则"] || {};
  const derivedRules = files["派生规则"] || {};
  const fieldGroups = derivedRules["字段分组"] || {};
  const moduleOrder = derivedRules["模块顺序"] || Object.keys(fieldGroups);
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

  const ageGroupLabels = deriveAgeGroupLabels();
  const genderLabels = deriveGenderLabels();
  const bodyTypeRows = baseLibrary["体态主型"] || [];
  const bodyTypeLabels = bodyTypeRows.map((row) => row["名称"] || row["标识"]).filter(Boolean);
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

  function deriveAgeGroupLabels() {
    const ruleAges = Object.keys(derivedRules["面部标记规则"]?.["触发概率_按年龄段"] || {});
    if (ruleAges.length) return ruleAges;
    const overrideAges = new Set();
    Object.values(weightRules["字段覆写"] || {}).forEach((fieldRule) => {
      Object.keys(fieldRule?.["年龄段"] || {}).forEach((label) => overrideAges.add(label));
    });
    return overrideAges.size ? Array.from(overrideAges) : ["18-19", "20-21", "22-24", "25-29", "30-34", "35-39", "40-45"];
  }

  function deriveGenderLabels() {
    const firstField = Object.values(weightRules["字段覆写"] || {}).find((fieldRule) => fieldRule?.["性别认同"]);
    const labels = Object.keys(firstField?.["性别认同"] || {});
    return labels.length ? labels : ["女性", "男性", "非二元", "跨性别女性", "跨性别男性"];
  }

  function buildRerollMeta() {
    const defaults = {};
    fieldDefs.forEach((field) => {
      defaults[field["字段名"]] = {
        mode: "solo",
        resets: [field["字段名"]],
        hint: "只重抽这个字段。",
      };
    });

    const linked = {
      "体态主型": {
        mode: "linked",
        resets: [
          "体态主型", "身高区间", "肩胯关系", "颈线", "锁骨显现",
          "腹部轮廓", "臀型", "臀量感", "臀部突出度", "臀部紧实度", "髋凹显现",
          "腿型", "大腿量感", "小腿线条", "腿轴", "脚踝纤细度",
          "手型", "手指长度", "足型",
        ],
        hint: "体态主型是上游字段，会带动整体轮廓、腹臀腿、手足相关部位一起变化。",
      },
      "身高区间": {
        mode: "linked",
        resets: ["身高区间", "颈线", "腿型", "脚踝纤细度"],
        hint: "身高区间会联动颈线与腿部比例感。",
      },
      "肩胯关系": {
        mode: "linked",
        resets: ["肩胯关系", "臀型", "臀量感", "臀部突出度", "髋凹显现"],
        hint: "肩胯关系会联动臀部结构。",
      },
      "脸型": {
        mode: "linked",
        resets: ["脸型", "口腔大小"],
        hint: "脸型会联动口腔大小的分布。",
      },
      "唇形": {
        mode: "linked",
        resets: ["唇形", "唇部质感", "唇色"],
        hint: "唇形会联动唇部质感和唇色倾向。",
      },
      "口腔大小": {
        mode: "linked",
        resets: ["口腔大小", "舌头大小", "咽喉深度感"],
        hint: "口腔大小会带动舌头大小和咽喉深度感。",
      },
      "臀型": {
        mode: "linked",
        resets: ["臀型", "臀量感", "臀部突出度", "臀部紧实度", "髋凹显现"],
        hint: "臀型会联动臀部量感、突出度和髋凹显现。",
      },
      "腿型": {
        mode: "linked",
        resets: ["腿型", "大腿量感", "小腿线条", "腿轴", "脚踝纤细度"],
        hint: "腿型会带动整条腿的线条和脚踝表现。",
      },
      "手型": {
        mode: "linked",
        resets: ["手型", "手指长度", "骨节显现", "指甲形态"],
        hint: "手型会联动手指比例、骨节和指甲感觉。",
      },
      "足型": {
        mode: "linked",
        resets: ["足型", "足弓", "趾型"],
        hint: "足型会联动足弓和趾型。",
      },
    };

    Object.entries(linked).forEach(([field, config]) => {
      defaults[field] = config;
    });
    return defaults;
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
    return `body-${Date.now().toString(36)}`;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function dispatchResultsRendered() {
    window.dispatchEvent(new CustomEvent("workspace:results-rendered", {
      detail: {
        panelId: "body",
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
    state.previousResultsByIndex[index] = value == null ? null : deepClone(exportableProfile(value));
  }

  function highestLockedIndex() {
    return state.lockedIndices.size ? Math.max(...state.lockedIndices) : -1;
  }

  function selectedIndexWithin(length) {
    if (!length) return 0;
    return Math.max(0, Math.min(state.selectedIndex, length - 1));
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

  function mergeWeightMaps(parts) {
    const merged = {};
    (parts || []).forEach(({ map, factor }) => {
      Object.entries(map || {}).forEach(([key, value]) => {
        merged[key] = (merged[key] || 0) + Number(value) * Number(factor ?? 1);
      });
    });
    return merged;
  }

  function normalizeWeightMap(map) {
    const entries = Object.entries(map || {}).filter(([, value]) => Number(value) > 0);
    if (!entries.length) return {};
    const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
    return Object.fromEntries(entries.map(([key, value]) => [key, Number(value) / total * 100]));
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeAgeLabel(value) {
    if (!value) return "";
    const cleaned = String(value).replace(/岁/g, "").trim();
    return ageGroupLabels.includes(cleaned) ? cleaned : "";
  }

  function normalizeGenderLabel(value) {
    if (!value) return "";
    const cleaned = String(value).trim();
    return genderLabels.includes(cleaned) ? cleaned : "";
  }

  function readBridge() {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_BRIDGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("读取人物背景联动桥失败", error);
      return null;
    }
  }

  function currentLinkedProfile() {
    const bridge = readBridge();
    const value = ui.profileSelect.value;
    if (!bridge || value === "") return null;
    return bridge.profiles?.[Number(value)] || null;
  }

  function syncProfileOptions() {
    const bridge = readBridge();
    const signature = JSON.stringify({
      updatedAt: bridge?.updatedAt || "",
      profileIndex: bridge?.profileIndex ?? "",
      profiles: (bridge?.profiles || []).map((profile) => `${profile["姓名"] || ""}:${profile["年龄段"] || ""}:${profile["性别认同"] || ""}`),
    });
    if (signature === state.bridgeSignature) return bridge;

    state.bridgeSignature = signature;
    const previous = ui.profileSelect.value;
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

    const preferred = previous !== "" ? previous : (bridge?.profileIndex != null ? String(bridge.profileIndex) : "");
    if (preferred !== "" && Number(preferred) < (bridge?.profiles || []).length) {
      ui.profileSelect.value = preferred;
    } else {
      ui.profileSelect.value = "";
    }
    renderLinkSummary(currentLinkedProfile());
    return bridge;
  }

  function renderLinkSummary(profile) {
    if (!ui.summary) return;
    if (!profile) {
      ui.summary.innerHTML = `
        <article class="fetish-summary-card">
          <strong>当前未联动背景人物</strong>
          <p>你可以直接手动指定年龄段、性别认同与体态主型，也可以先回到人物背景页选一个人物再回来。</p>
        </article>
      `;
      return;
    }

    ui.summary.innerHTML = `
      <article class="fetish-summary-card">
        <strong>${escapeHtml(profile["姓名"] || "未命名人物")}</strong>
        <p>${escapeHtml(profile["年龄段"] || "年龄段未定")} · ${escapeHtml(profile["性别认同"] || "性别认同未定")} · ${escapeHtml(profile["常住城市"] || "城市未定")}</p>
        <p>${escapeHtml(profile["教育状态"] || "教育状态未定")} · ${escapeHtml(profile["职业大类"] || "职业未定")} · 身体外观会跟随年龄段与性别认同，体态主型仍可单独锁定或保持随机。</p>
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

  function renderNotes() {
    const notes = [
      ...(meta["说明"] || []),
      "字段右侧支持重roll；上游结构字段会带动相关下游字段一起刷新。",
      "当前页面不包含胸部、性器官、肛门，这三类继续留在私密部位生成器里。",
    ];
    if (ui.notes) {
      ui.notes.innerHTML = notes.slice(0, 5).map((note, index) => `
        <article class="memo-item">
          <strong>说明 ${String(index + 1).padStart(2, "0")}</strong>
          <p>${escapeHtml(note)}</p>
        </article>
      `).join("");
    }

    ui.statModules.textContent = String(moduleOrder.length);
    ui.statFields.textContent = String(fieldDefs.length);
    ui.statLinks.textContent = String((derivedRules["联动规则"] || []).length);
  }

  function fieldBaseWeights(fieldName) {
    const baseKey = fieldToBaseKey[fieldName];
    const rows = baseLibrary[baseKey] || [];
    return Object.fromEntries(rows.map((row) => [row["标识"], Number(row["权重"] || 0)]));
  }

  function resolveFieldWeights(fieldName, source, currentValues) {
    const base = fieldBaseWeights(fieldName);
    const overrides = weightRules["字段覆写"]?.[fieldName] || {};
    const genderMap = overrides["性别认同"]?.[source.gender] || null;
    const ageMap = overrides["年龄段"]?.[source.ageGroup] || null;
    const parts = [];

    if (genderMap && ageMap) {
      parts.push({ map: genderMap, factor: 0.5 }, { map: ageMap, factor: 0.5 });
    } else if (genderMap) {
      parts.push({ map: genderMap, factor: 1 });
    } else if (ageMap) {
      parts.push({ map: ageMap, factor: 1 });
    } else {
      parts.push({ map: base, factor: 1 });
    }

    const merged = mergeWeightMaps(parts);
    const boosted = applyLinkBoosts(fieldName, merged, currentValues);
    return normalizeWeightMap(boosted);
  }

  function applyLinkBoosts(fieldName, baseMap, currentValues) {
    const merged = Object.assign({}, baseMap);
    (derivedRules["联动规则"] || []).forEach((rule) => {
      if (!matchesLinkRule(rule, currentValues)) return;
      const boosts = rule["提升权重"]?.[fieldName] || null;
      if (!boosts) return;
      Object.entries(boosts).forEach(([key, value]) => {
        merged[key] = (merged[key] || 0) + Number(value);
      });
    });
    return merged;
  }

  function matchesLinkRule(rule, currentValues) {
    const conditions = rule["条件"] || {};
    return Object.entries(conditions).every(([key, values]) => {
      const fieldName = key.replace(/属于$/, "");
      return values.includes(currentValues[fieldName]);
    });
  }

  function generateFaceMarks(rng, source) {
    const fixed = source.fixedValues["面部标记"];
    if (Array.isArray(fixed)) return fixed.slice();

    const rules = derivedRules["面部标记规则"] || {};
    const probability = Number(rules["触发概率_按年龄段"]?.[source.ageGroup] ?? 0);
    if (rng.rand() > probability) return [];

    const maxCount = Number(rules["最大标记数"] || 2);
    const countLabel = weightedChoiceMap(rng, rules["触发后数量权重"] || {});
    const desiredCount = Math.min(maxCount, countLabel === "两个" ? 2 : 1);
    const rows = deepClone(baseLibrary[fieldToBaseKey["面部标记"]] || []);
    const picks = [];

    while (rows.length && picks.length < desiredCount) {
      const weightMap = Object.fromEntries(rows.map((row) => [row["标识"], Number(row["权重"] || 0)]));
      const picked = weightedChoiceMap(rng, weightMap);
      if (!picked) break;
      picks.push(picked);
      const nextIndex = rows.findIndex((row) => row["标识"] === picked);
      if (nextIndex >= 0) rows.splice(nextIndex, 1);
    }
    return picks;
  }

  function createSourceFromControls(rng) {
    const linkedProfile = currentLinkedProfile();
    const source = {
      ageGroup: linkedProfile ? (normalizeAgeLabel(linkedProfile["年龄段"]) || ui.ageGroup.value || weightedChoiceMap(rng, Object.fromEntries(ageGroupLabels.map((label) => [label, 1])))) : (ui.ageGroup.value || weightedChoiceMap(rng, Object.fromEntries(ageGroupLabels.map((label) => [label, 1])))),
      gender: linkedProfile ? (normalizeGenderLabel(linkedProfile["性别认同"]) || ui.gender.value || weightedChoiceMap(rng, Object.fromEntries(genderLabels.map((label) => [label, 1])))) : (ui.gender.value || weightedChoiceMap(rng, Object.fromEntries(genderLabels.map((label) => [label, 1])))),
      linkedProfile: linkedProfile ? {
        姓名: linkedProfile["姓名"] || "",
        年龄: linkedProfile["年龄"] || "",
        年龄段: linkedProfile["年龄段"] || "",
        性别认同: linkedProfile["性别认同"] || "",
        常住城市: linkedProfile["常住城市"] || "",
        成长地区: linkedProfile["成长地区"] || "",
      } : null,
      fixedValues: {},
    };

    if (ui.bodyType.value && ui.bodyType.value !== RANDOM_BODY_TYPE) {
      source.fixedValues["体态主型"] = ui.bodyType.value;
    }
    return source;
  }

  function buildAppearanceFromSource(rng, source) {
    const nextSource = {
      ageGroup: source.ageGroup,
      gender: source.gender,
      linkedProfile: source.linkedProfile ? deepClone(source.linkedProfile) : null,
      fixedValues: deepClone(source.fixedValues || {}),
    };

    const flatValues = {};
    fieldDefs.forEach((field) => {
      const fieldName = field["字段名"];
      if (fieldName === "面部标记") {
        const marks = generateFaceMarks(rng, nextSource);
        flatValues[fieldName] = marks;
        nextSource.fixedValues[fieldName] = marks.slice();
        return;
      }

      const weights = resolveFieldWeights(fieldName, nextSource, flatValues);
      const fixed = nextSource.fixedValues[fieldName];
      const value = fixed && Object.prototype.hasOwnProperty.call(weights, fixed)
        ? fixed
        : weightedChoiceMap(rng, weights);

      flatValues[fieldName] = value;
      nextSource.fixedValues[fieldName] = value;
    });

    const profile = {
      "输入上下文": {
        "年龄段": nextSource.ageGroup,
        "性别认同": nextSource.gender,
        "联动人物": nextSource.linkedProfile ? deepClone(nextSource.linkedProfile) : null,
      },
    };

    moduleOrder.forEach((moduleName) => {
      const fieldsInModule = fieldGroups[moduleName] || [];
      profile[moduleName] = Object.fromEntries(fieldsInModule.map((fieldName) => [fieldName, flatValues[fieldName] ?? (fieldName === "面部标记" ? [] : "")]));
    });

    profile._meta = {
      source: nextSource,
      flatValues,
    };
    return profile;
  }

  function readAppearanceSource(profile) {
    if (profile?._meta?.source) {
      return deepClone(profile._meta.source);
    }

    const source = {
      ageGroup: normalizeAgeLabel(profile?.["输入上下文"]?.["年龄段"]),
      gender: normalizeGenderLabel(profile?.["输入上下文"]?.["性别认同"]),
      linkedProfile: profile?.["输入上下文"]?.["联动人物"] ? deepClone(profile["输入上下文"]["联动人物"]) : null,
      fixedValues: {},
    };

    Object.values(fieldGroups).flat().forEach((fieldName) => {
      for (const moduleName of moduleOrder) {
        if (profile?.[moduleName] && Object.prototype.hasOwnProperty.call(profile[moduleName], fieldName)) {
          source.fixedValues[fieldName] = deepClone(profile[moduleName][fieldName]);
          break;
        }
      }
    });
    return source;
  }

  function equalBodyValue(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
      return JSON.stringify(left || []) === JSON.stringify(right || []);
    }
    return left === right;
  }

  function rerollField(profileIndex, fieldName) {
    const current = state.results[profileIndex];
    if (!current) return;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, current);

    const config = rerollMeta[fieldName] || { resets: [fieldName], mode: "solo" };
    const currentValue = current?._meta?.flatValues?.[fieldName];
    let nextProfile = current;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const source = readAppearanceSource(current);
      config.resets.forEach((resetField) => {
        delete source.fixedValues[resetField];
      });
      const rng = new RNG(hashSeed(`${ui.seed.value || "body"}:${profileIndex}:${fieldName}:${Date.now()}:${attempt}:${Math.random()}`));
      nextProfile = buildAppearanceFromSource(rng, source);
      if (!equalBodyValue(nextProfile?._meta?.flatValues?.[fieldName], currentValue)) {
        break;
      }
    }

    state.results[profileIndex] = nextProfile;
    state.selectedIndex = profileIndex;
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(exportableProfile(state.results[profileIndex])) };
  }

  function rerollModule(profileIndex, moduleName) {
    const current = state.results[profileIndex];
    if (!current) return null;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, current);

    const resetFields = new Set();
    (fieldGroups[moduleName] || []).forEach((fieldName) => {
      (rerollMeta[fieldName]?.resets || [fieldName]).forEach((resetField) => resetFields.add(resetField));
    });
    if (!resetFields.size) return null;

    const source = readAppearanceSource(current);
    resetFields.forEach((fieldName) => {
      delete source.fixedValues[fieldName];
    });

    const rng = new RNG(hashSeed(`${ui.seed.value || "body"}:${profileIndex}:${moduleName}:module:${Date.now()}:${Math.random()}`));
    state.results[profileIndex] = buildAppearanceFromSource(rng, source);
    state.selectedIndex = profileIndex;
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(exportableProfile(state.results[profileIndex])) };
  }

  function getFieldOptions(fieldName) {
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
    const options = getFieldOptions(fieldName);
    if (!options.length) return null;
    const currentValue = deepClone(profile?._meta?.flatValues?.[fieldName] ?? "");
    return {
      type: "select",
      multiple: Array.isArray(currentValue),
      value: Array.isArray(currentValue) ? currentValue : String(currentValue ?? ""),
      options,
    };
  }

  function applyFieldValue(profileIndex, fieldName, nextValue) {
    const current = state.results[profileIndex];
    if (!current) return null;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, current);

    const source = readAppearanceSource(current);
    const config = rerollMeta[fieldName] || { resets: [fieldName] };
    config.resets.forEach((resetField) => {
      if (resetField === fieldName) return;
      delete source.fixedValues[resetField];
    });
    source.fixedValues[fieldName] = Array.isArray(nextValue)
      ? nextValue.map((value) => String(value || "").trim()).filter(Boolean)
      : String(nextValue ?? "").trim();

    const rng = new RNG(hashSeed(`${ui.seed.value || "body"}:${profileIndex}:${fieldName}:manual:${Date.now()}:${Math.random()}`));
    state.results[profileIndex] = buildAppearanceFromSource(rng, source);
    state.selectedIndex = profileIndex;
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(exportableProfile(state.results[profileIndex])) };
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
                    data-body-profile-index="${profileIndex}"
                    data-body-reroll-field="${escapeHtml(label)}"
                    title="${escapeHtml(rerollMeta[label].hint)}"
                  >
                    ${rerollMeta[label].mode === "linked" ? "联动" : "重roll"}
                  </button>
                ` : ""}
              </div>
            </div>
            <span class="field-value">${Array.isArray(value) ? escapeHtml((value || []).join(" / ") || "—") : escapeHtml(value || "—")}</span>
            <div class="field-edit-row"></div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderResultCard(profile, index) {
    const context = profile["输入上下文"] || {};
    const linked = context["联动人物"];
    const title = linked ? `${linked["姓名"] || "联动人物"} 的外观候选` : `身体外观 ${String(index + 1).padStart(2, "0")}`;
    const subline = linked
      ? `${linked["常住城市"] || "城市未定"}常住 · ${linked["成长地区"] || "成长地区未定"}成长`
      : "独立随机 / 手动控制";
    const bodyType = profile?.["整体轮廓"]?.["体态主型"] || "";

    return `
      <article class="background-card" data-card-index="${index}">
        <div class="card-top">
          <div>
            <h4>${escapeHtml(title)}</h4>
            <div class="card-subline">${escapeHtml(subline)}</div>
          </div>
          <div class="chip-row">
            <span class="value-chip accent">${escapeHtml(context["年龄段"] || "")}</span>
            <span class="value-chip">${escapeHtml(context["性别认同"] || "")}</span>
            <span class="value-chip">${escapeHtml(bodyType || "体态未定")}</span>
          </div>
        </div>

        <div class="card-modules-grid">
          ${moduleOrder.map((moduleName) => `
            <section class="card-section" data-module-name="${escapeHtml(moduleName)}">
              <div class="section-head-row">
                <h5>${escapeHtml(moduleName)}</h5>
                <button class="module-reroll" type="button" data-module-name="${escapeHtml(moduleName)}">重刷</button>
              </div>
              ${renderFieldList(index, Object.entries(profile[moduleName] || {}))}
            </section>
          `).join("")}
        </div>

        <details class="raw-box">
          <summary>查看原始 JSON</summary>
          <pre>${escapeHtml(JSON.stringify(exportableProfile(profile), null, 2))}</pre>
        </details>
      </article>
    `;
  }

  function renderResults() {
    if (!state.results.length) {
      ui.results.innerHTML = `
        <div class="empty-state">
          <p class="empty-title">身体外观还没生成</p>
          <p class="empty-copy">先点上面的“生成身体外观”，这里会按整体轮廓、面部、头发、口腔、体成分、腹臀腿、手足输出完整外观档案。</p>
        </div>
      `;
      ui.resultMeta.textContent = "尚未生成";
      dispatchResultsRendered();
      return;
    }

    ui.results.innerHTML = state.results.map((profile, index) => renderResultCard(profile, index)).join("");
    const linked = currentLinkedProfile();
    ui.resultMeta.textContent = `${state.results.length} 份外观档案 · 种子 ${ui.seed.value || "自动"}${linked ? ` · 联动 ${linked["姓名"] || "当前人物"}` : ""}`;
    dispatchResultsRendered();
  }

  function generateBatch() {
    syncProfileOptions();
    const seedValue = ui.seed.value.trim() || makeSeedValue();
    ui.seed.value = seedValue;
    const count = 1;
    const previousFull = state.results.map((profile) => deepClone(profile));
    state.previousResultsByIndex = Object.fromEntries(previousFull.map((profile, index) => [index, deepClone(exportableProfile(profile))]));
    const targetLength = count;
    const rootRng = new RNG(hashSeed(seedValue));
    const baseSource = createSourceFromControls(rootRng);
    const nextResults = Array.from({ length: targetLength }, (_, index) => {
      const rng = new RNG(hashSeed(`${seedValue}:${index}:${rootRng.rand()}`));
      return buildAppearanceFromSource(rng, baseSource);
    });
    state.lockedIndices.forEach((index) => {
      if (previousFull[index]) nextResults[index] = deepClone(previousFull[index]);
    });
    state.results = nextResults;
    state.selectedIndex = selectedIndexWithin(state.results.length);
    renderLinkSummary(currentLinkedProfile());
    renderResults();
    return state.results.map(exportableProfile);
  }

  function exportableProfile(profile) {
    const output = {
      "输入上下文": profile["输入上下文"],
    };
    moduleOrder.forEach((moduleName) => {
      output[moduleName] = profile[moduleName];
    });
    return output;
  }

  function exportJson() {
    if (!state.results.length) return;
    const payload = {
      "元信息": {
        "生成时间": new Date().toISOString(),
        "来源": "随机生成器工作台/身体外观生成器",
        "数量": state.results.length,
        "种子": ui.seed.value || "",
      },
      "档案列表": state.results.map(exportableProfile),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `身体外观档案_${Date.now()}.json`;
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
    const targetLength = 1;
    const rootRng = new RNG(hashSeed(seedValue));
    const baseSource = createSourceFromControls(rootRng);
    const nextResults = Array.from({ length: targetLength }, (_, currentIndex) => {
      if (currentIndex === slotIndex || !state.results[currentIndex]) {
        const rng = new RNG(hashSeed(`${seedValue}:${currentIndex}:${rootRng.rand()}`));
        return buildAppearanceFromSource(rng, baseSource);
      }
      return state.results[currentIndex];
    });

    updatePreviousSnapshot(slotIndex, state.results[slotIndex] || null);
    state.results = nextResults;
    state.selectedIndex = slotIndex;
    renderLinkSummary(currentLinkedProfile());
    renderResults();
    return { skipped: false, index: slotIndex, profile: deepClone(exportableProfile(state.results[slotIndex])) };
  }

  function setLinkedProfileIndex(index) {
    syncProfileOptions();
    ui.profileSelect.value = String(normalizeIndex(index));
    renderLinkSummary(currentLinkedProfile());
  }

  function registerController() {
    const registry = window.generatorWorkspaceControllers || (window.generatorWorkspaceControllers = {});
    registry.body = {
      getState() {
        return {
          results: state.results.map((profile) => deepClone(exportableProfile(profile))),
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
        return state.results[0] ? deepClone(exportableProfile(state.results[0])) : null;
      },
      setLinkedProfileIndex,
      applyLinkedProfile: applyLinkedProfileToControls,
    };
  }

  function setupControls() {
    buildSelect(ui.ageGroup, ageGroupLabels.map((label) => ({ value: label, label })), "随机");
    buildSelect(ui.gender, genderLabels.map((label) => ({ value: label, label })), "随机");
    buildSelect(ui.bodyType, [
      { value: RANDOM_BODY_TYPE, label: "随机体态主型" },
      ...bodyTypeLabels.map((label) => ({ value: label, label })),
    ], "不锁定");
    syncProfileOptions();
    renderLinkSummary(currentLinkedProfile());
    renderNotes();
    ui.seed.value = makeSeedValue();
    renderResults();
  }

  function bindEvents() {
    ui.profileSelect.addEventListener("change", () => renderLinkSummary(currentLinkedProfile()));
    ui.generate.addEventListener("click", generateBatch);
    ui.useLinked.addEventListener("click", applyLinkedProfileToControls);
    ui.export.addEventListener("click", exportJson);
    ui.results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-body-reroll-field]");
      if (!button) return;
      rerollField(Number(button.dataset.bodyProfileIndex), button.dataset.bodyRerollField);
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
