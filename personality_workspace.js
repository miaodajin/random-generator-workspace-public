(() => {
  const DATA = window.CHARACTER_PERSONALITY_DATA;
  if (!DATA || !DATA["文件"]) {
    console.warn("性格数据包未加载。");
    return;
  }

  const ui = {
    count: document.getElementById("personalityCount"),
    profileSelect: document.getElementById("personalityProfileSelect"),
    ageGroup: document.getElementById("personalityAgeGroup"),
    gender: document.getElementById("personalityGender"),
    occupation: document.getElementById("personalityOccupation"),
    socialDensity: document.getElementById("personalitySocialDensity"),
    maritalStatus: document.getElementById("personalityMaritalStatus"),
    seed: document.getElementById("personalitySeed"),
    generate: document.getElementById("personalityGenerateButton"),
    useLinked: document.getElementById("personalityUseLinkedButton"),
    export: document.getElementById("personalityExportButton"),
    resultMeta: document.getElementById("personalityResultMeta"),
    results: document.getElementById("personalityResults"),
    notes: document.getElementById("personalityNotes"),
    summary: document.getElementById("personalitySummary"),
    statModules: document.getElementById("personalityStatModules"),
    statFields: document.getElementById("personalityStatFields"),
    statBridge: document.getElementById("personalityStatBridge"),
  };

  if (!ui.profileSelect || !ui.ageGroup || !ui.gender || !ui.seed) {
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
  const coreModules = moduleOrder.filter((name) => name.startsWith("核心维度_"));
  const interpersonalModule = "人际面向";
  const mbtiModule = "MBTI派生";
  const bridgeModule = "性爱人格桥接";
  const interpersonalFields = fieldGroups[interpersonalModule] || [];
  const bridgeFields = fieldGroups[bridgeModule] || [];
  const mbtiField = (fieldGroups[mbtiModule] || [])[0] || "MBTI速记";
  const WORKSPACE_BRIDGE_KEY = "role_generator_workspace_bridge_v1";
  const bridgeRules = derivedRules["桥接派生规则"] || {};
  const bridgeOptionMap = bridgeRules["桥接字段选项"] || {};

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
  const occupationLabels = deriveConditionValues("职业大类属于");
  const socialDensityLabels = deriveConditionValues("社交密度属于");
  const maritalStatusLabels = deriveConditionValues("婚姻状况属于");
  const rerollMeta = buildRerollMeta();
  const MBTI_OPTIONS = [
    "INTJ", "INTP", "ENTJ", "ENTP",
    "INFJ", "INFP", "ENFJ", "ENFP",
    "ISTJ", "ISFJ", "ESTJ", "ESFJ",
    "ISTP", "ISFP", "ESTP", "ESFP",
  ];

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
    const labels = new Set();
    Object.values(weightRules["字段覆写"] || {}).forEach((fieldRule) => {
      Object.keys(fieldRule?.["按年龄段"] || {}).forEach((label) => labels.add(label));
    });
    return labels.size ? Array.from(labels) : ["18-19", "20-21", "22-24", "25-29", "30-34", "35-39", "40-45"];
  }

  function deriveGenderLabels() {
    const labels = new Set();
    Object.values(weightRules["字段覆写"] || {}).forEach((fieldRule) => {
      Object.keys(fieldRule?.["按性别认同"] || {}).forEach((label) => labels.add(label));
    });
    return labels.size ? Array.from(labels) : ["女性", "男性", "非二元", "跨性别女性", "跨性别男性"];
  }

  function deriveConditionValues(key) {
    const values = new Set();
    (derivedRules["跨库联动输入规则"] || []).forEach((rule) => {
      (rule["条件"]?.[key] || []).forEach((value) => values.add(value));
    });
    return Array.from(values);
  }

  function buildRerollMeta() {
    const metaMap = {};

    coreModules.forEach((moduleName) => {
      const fields = fieldGroups[moduleName] || [];
      const resets = [...fields, ...interpersonalFields, mbtiField, ...bridgeFields];
      fields.forEach((fieldName) => {
        metaMap[fieldName] = {
          mode: "linked",
          resets,
          hint: `${moduleLabel(moduleName)}会联动 MBTI、人际面向和桥接层一起重抽。`,
        };
      });
    });

    interpersonalFields.forEach((fieldName) => {
      metaMap[fieldName] = {
        mode: ["依恋模式", "人际主导性"].includes(fieldName) ? "linked" : "solo",
        resets: ["依恋模式", "人际主导性"].includes(fieldName) ? [fieldName, ...bridgeFields] : [fieldName],
        hint: ["依恋模式", "人际主导性"].includes(fieldName)
          ? "这个字段会联动性爱人格桥接层一起重抽。"
          : "只重抽这个字段。",
      };
    });

    metaMap[mbtiField] = {
      mode: "solo",
      resets: [mbtiField],
      hint: "在当前核心维度不变的情况下，重新派生 MBTI。",
    };

    bridgeFields.forEach((fieldName) => {
      metaMap[fieldName] = {
        mode: "solo",
        resets: [fieldName],
        hint: "在当前性格结构不变的情况下，重新派生这个桥接字段。",
      };
    });

    return metaMap;
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
    return `personality-${Date.now().toString(36)}`;
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

  function randomFromList(rng, values) {
    if (!values.length) return "";
    return values[Math.floor(rng.rand() * values.length)];
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

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function dispatchResultsRendered() {
    window.dispatchEvent(new CustomEvent("workspace:results-rendered", {
      detail: {
        panelId: "personality",
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

  function moduleLabel(moduleName) {
    return String(moduleName).replace(/_/g, " · ");
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

  function normalizeOptionLabel(value, candidates) {
    if (!value) return "";
    const cleaned = String(value).trim();
    return candidates.includes(cleaned) ? cleaned : "";
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

  function summarizeBridgePersonality(profile, sourceSignature) {
    return {
      "情绪模式": profile?.["核心维度_情绪模式"]?.["情绪模式"] || "",
      "依恋模式": profile?.["人际面向"]?.["依恋模式"] || "",
      "强度偏好": profile?.["性爱人格桥接"]?.["强度偏好"] || "",
      "新奇探索度": profile?.["性爱人格桥接"]?.["新奇探索度"] || "",
      "禁忌吸引度": profile?.["性爱人格桥接"]?.["禁忌吸引度"] || "",
      "sourceSignature": sourceSignature,
    };
  }

  function persistPersonalityBridge() {
    if (!state.results.length) return;
    const linked = currentLinkedProfile();
    const sourceSignature = buildProfileSignature(linked);
    const summaries = state.results.map((profile) => summarizeBridgePersonality(profile, sourceSignature));
    const activeIndex = selectedIndexWithin(summaries.length);
    const nextPayload = {
      ...(readBridge() || {}),
      version: 2,
      updatedAt: new Date().toISOString(),
      personalityProfiles: summaries,
      personalityProfileIndex: activeIndex,
      activePersonalityProfile: summaries[activeIndex] || null,
      personalityLinkedSignature: sourceSignature,
    };
    try {
      window.localStorage.setItem(WORKSPACE_BRIDGE_KEY, JSON.stringify(nextPayload));
    } catch (error) {
      console.warn("写入性格联动桥失败", error);
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
    renderSummary(currentLinkedProfile());
    return bridge;
  }

  function renderNotes() {
    const notes = [
      ...(meta["说明"] || []),
      "MBTI 在这里是派生层，来自核心维度，不是单独乱抽。",
      "性爱人格桥接层只提供偏置，不会直接替代偏好标签本身。",
      "如果联动了人物背景，职业、婚姻和社交密度会参与性格权重修正。",
    ];
    if (ui.notes) {
      ui.notes.innerHTML = notes.slice(0, 6).map((note, index) => `
        <article class="memo-item">
          <strong>说明 ${String(index + 1).padStart(2, "0")}</strong>
          <p>${escapeHtml(note)}</p>
        </article>
      `).join("");
    }

    ui.statModules.textContent = String(moduleOrder.length);
    ui.statFields.textContent = String(fieldDefs.length);
    ui.statBridge.textContent = String(bridgeFields.length);
  }

  function renderSummary(profile) {
    if (!ui.summary) return;
    if (!profile) {
      ui.summary.innerHTML = `
        <article class="fetish-summary-card">
          <strong>当前未联动背景人物</strong>
          <p>你可以完全手动指定年龄段、性别认同、职业和婚姻，也可以先在人物背景生成器里选一个人物再回来。</p>
        </article>
      `;
      return;
    }

    ui.summary.innerHTML = `
      <article class="fetish-summary-card">
        <strong>${escapeHtml(profile["姓名"] || "未命名人物")}</strong>
        <p>${escapeHtml(profile["年龄段"] || "年龄未定")} · ${escapeHtml(profile["性别认同"] || "性别未定")} · ${escapeHtml(profile["常住城市"] || "城市未定")}</p>
        <p>${escapeHtml(profile["职业大类"] || "职业未定")} · ${escapeHtml(profile["婚姻状况"] || "婚姻未定")} · ${escapeHtml(profile["社交密度"] || "社交密度未定")}</p>
      </article>
    `;
  }

  function applyLinkedProfileToControls() {
    const profile = currentLinkedProfile();
    if (!profile) {
      renderSummary(null);
      return;
    }
    const ageGroup = normalizeAgeLabel(profile["年龄段"]);
    const gender = normalizeGenderLabel(profile["性别认同"]);
    const occupation = String(profile["职业大类"] || "").trim();
    const socialDensity = String(profile["社交密度"] || "").trim();
    const maritalStatus = String(profile["婚姻状况"] || "").trim();
    if (ageGroup) ui.ageGroup.value = ageGroup;
    if (gender) ui.gender.value = gender;
    if (occupationLabels.includes(occupation)) ui.occupation.value = occupation;
    if (socialDensityLabels.includes(socialDensity)) ui.socialDensity.value = socialDensity;
    if (maritalStatusLabels.includes(maritalStatus)) ui.maritalStatus.value = maritalStatus;
    renderSummary(profile);
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
      if (!key.endsWith("属于")) return true;
      const fieldName = key.slice(0, -2);
      const actual = selectedValues[fieldName]
        ?? ({
          "年龄段": context.ageGroup,
          "性别认同": context.gender,
          "职业大类": context.occupation,
          "社交密度": context.socialDensity,
          "婚姻状况": context.maritalStatus,
        }[fieldName] || "");
      return (expectedValues || []).includes(actual);
    });
  }

  function ruleBoostsForField(fieldName, selectedValues, context) {
    let combined = {};
    [
      ...(derivedRules["跨库联动输入规则"] || []),
      ...(derivedRules["联动规则"] || []),
    ].forEach((rule) => {
      if (!matchesCondition(rule["条件"], selectedValues, context)) return;
      combined = mergeWeightMaps(combined, rule["提升权重"]?.[fieldName] || {});
    });
    return combined;
  }

  function resolveFieldWeights(fieldName, selectedValues, context) {
    const base = fieldBaseWeights(fieldName);
    const overrides = weightRules["字段覆写"]?.[fieldName] || {};
    const genderMap = overrides["按性别认同"]?.[context.gender] || {};
    const ageMap = overrides["按年龄段"]?.[context.ageGroup] || {};
    const boosts = ruleBoostsForField(fieldName, selectedValues, context);
    return mergeWeightMaps(base, genderMap, ageMap, boosts);
  }

  function pickFieldValue(rng, fieldName, selectedValues, context) {
    return weightedChoiceMap(rng, resolveFieldWeights(fieldName, selectedValues, context));
  }

  function deriveMbti(rng, selectedValues) {
    const mbtiRules = derivedRules["MBTI派生规则"] || {};
    const axisDefinitions = mbtiRules["轴定义"] || {};
    const noiseProbability = Number(mbtiRules["随机噪声概率"] || 0);
    return ["E_I", "S_N", "T_F", "J_P"].map((axisKey) => {
      const axis = axisDefinitions[axisKey] || {};
      const score = (axis["来源字段"] || []).reduce((sum, fieldName) => {
        const mapping = axis["分值映射"]?.[fieldName] || {};
        return sum + Number(mapping[selectedValues[fieldName]] || 0);
      }, 0);
      let letter = "";
      if (score > 0) {
        letter = axis["高分方向"] || "";
      } else if (score < 0) {
        letter = axis["低分方向"] || "";
      } else {
        letter = rng.rand() < 0.5 ? (axis["高分方向"] || "") : (axis["低分方向"] || "");
      }
      if (score !== 0 && noiseProbability > 0 && rng.rand() < noiseProbability) {
        letter = letter === axis["高分方向"] ? axis["低分方向"] : axis["高分方向"];
      }
      return letter;
    }).join("");
  }

  function bridgeFieldWeights(fieldName, selectedValues) {
    const options = bridgeOptionMap[fieldName] || [];
    let weights = Object.fromEntries(options.map((label) => [label, 1]));
    const contributions = bridgeRules["来源贡献"]?.[fieldName] || {};
    Object.entries(contributions).forEach(([sourceField, valueMap]) => {
      const sourceValue = selectedValues[sourceField];
      weights = mergeWeightMaps(weights, valueMap?.[sourceValue] || {});
    });
    return weights;
  }

  function createProfileSource(rng) {
    const linkedProfile = currentLinkedProfile();
    return {
      ageGroup: linkedProfile ? (normalizeAgeLabel(linkedProfile["年龄段"]) || ui.ageGroup.value || randomFromList(rng, ageGroupLabels)) : (ui.ageGroup.value || randomFromList(rng, ageGroupLabels)),
      gender: linkedProfile ? (normalizeGenderLabel(linkedProfile["性别认同"]) || ui.gender.value || randomFromList(rng, genderLabels)) : (ui.gender.value || randomFromList(rng, genderLabels)),
      occupation: linkedProfile ? String(linkedProfile["职业大类"] || "").trim() : String(ui.occupation.value || "").trim(),
      socialDensity: linkedProfile ? String(linkedProfile["社交密度"] || "").trim() : String(ui.socialDensity.value || "").trim(),
      maritalStatus: linkedProfile ? String(linkedProfile["婚姻状况"] || "").trim() : String(ui.maritalStatus.value || "").trim(),
      linkedProfile: linkedProfile ? deepClone(linkedProfile) : null,
      fixedValues: {},
    };
  }

  function buildProfileFromSource(rng, source) {
    const nextSource = {
      ageGroup: source.ageGroup || randomFromList(rng, ageGroupLabels),
      gender: source.gender || randomFromList(rng, genderLabels),
      occupation: source.occupation || "",
      socialDensity: source.socialDensity || "",
      maritalStatus: source.maritalStatus || "",
      linkedProfile: source.linkedProfile ? deepClone(source.linkedProfile) : null,
      fixedValues: deepClone(source.fixedValues || {}),
    };
    const context = {
      ageGroup: nextSource.ageGroup,
      gender: nextSource.gender,
      occupation: nextSource.occupation,
      socialDensity: nextSource.socialDensity,
      maritalStatus: nextSource.maritalStatus,
      linkedProfile: nextSource.linkedProfile,
    };

    const profile = {
      "输入上下文": {
        "年龄段": nextSource.ageGroup,
        "性别认同": nextSource.gender,
        "职业大类": nextSource.occupation || "",
        "社交密度": nextSource.socialDensity || "",
        "婚姻状况": nextSource.maritalStatus || "",
        "联动人物": nextSource.linkedProfile ? {
          "姓名": nextSource.linkedProfile["姓名"] || "",
          "常住城市": nextSource.linkedProfile["常住城市"] || "",
          "职业大类": nextSource.linkedProfile["职业大类"] || "",
        } : null,
      },
    };
    const selectedValues = {};

    coreModules.forEach((moduleName) => {
      const moduleFields = fieldGroups[moduleName] || [];
      const moduleData = {};
      moduleFields.forEach((fieldName) => {
        const weights = resolveFieldWeights(fieldName, selectedValues, context);
        const fixed = nextSource.fixedValues[fieldName];
        const value = fixed && Object.prototype.hasOwnProperty.call(weights, fixed)
          ? fixed
          : weightedChoiceMap(rng, weights);
        moduleData[fieldName] = value;
        selectedValues[fieldName] = value;
        nextSource.fixedValues[fieldName] = value;
      });
      profile[moduleName] = moduleData;
    });

    const fixedMbti = nextSource.fixedValues[mbtiField];
    const mbtiValue = /^[EI][SN][TF][JP]$/.test(String(fixedMbti || "")) ? fixedMbti : deriveMbti(rng, selectedValues);
    profile[mbtiModule] = { [mbtiField]: mbtiValue };
    selectedValues[mbtiField] = mbtiValue;
    nextSource.fixedValues[mbtiField] = mbtiValue;

    const interpersonalData = {};
    interpersonalFields.forEach((fieldName) => {
      const weights = resolveFieldWeights(fieldName, selectedValues, context);
      const fixed = nextSource.fixedValues[fieldName];
      const value = fixed && Object.prototype.hasOwnProperty.call(weights, fixed)
        ? fixed
        : weightedChoiceMap(rng, weights);
      interpersonalData[fieldName] = value;
      selectedValues[fieldName] = value;
      nextSource.fixedValues[fieldName] = value;
    });
    profile[interpersonalModule] = interpersonalData;

    const bridgeData = {};
    bridgeFields.forEach((fieldName) => {
      const weights = bridgeFieldWeights(fieldName, selectedValues);
      const fixed = nextSource.fixedValues[fieldName];
      const value = fixed && Object.prototype.hasOwnProperty.call(weights, fixed)
        ? fixed
        : weightedChoiceMap(rng, weights);
      bridgeData[fieldName] = value;
      selectedValues[fieldName] = value;
      nextSource.fixedValues[fieldName] = value;
    });
    profile[bridgeModule] = bridgeData;

    profile["_meta"] = { source: nextSource };
    return profile;
  }

  function readProfileSource(profile) {
    if (profile?._meta?.source) {
      return deepClone(profile._meta.source);
    }
    return {
      ageGroup: normalizeAgeLabel(profile?.["输入上下文"]?.["年龄段"]),
      gender: normalizeGenderLabel(profile?.["输入上下文"]?.["性别认同"]),
      occupation: String(profile?.["输入上下文"]?.["职业大类"] || "").trim(),
      socialDensity: String(profile?.["输入上下文"]?.["社交密度"] || "").trim(),
      maritalStatus: String(profile?.["输入上下文"]?.["婚姻状况"] || "").trim(),
      linkedProfile: profile?.["输入上下文"]?.["联动人物"] ? deepClone(profile["输入上下文"]["联动人物"]) : null,
      fixedValues: {},
    };
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
    const currentValue = findFieldValue(current, fieldName);

    let nextProfile = current;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const source = readProfileSource(current);
      config.resets.forEach((resetField) => {
        delete source.fixedValues[resetField];
      });
      const rng = new RNG(hashSeed(`${ui.seed.value || "personality"}:${profileIndex}:${fieldName}:${Date.now()}:${attempt}:${Math.random()}`));
      nextProfile = buildProfileFromSource(rng, source);
      const nextValue = findFieldValue(nextProfile, fieldName);
      if (!equalValue(nextValue, currentValue)) {
        break;
      }
    }

    state.results[profileIndex] = nextProfile;
    state.selectedIndex = profileIndex;
    persistPersonalityBridge();
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(state.results[profileIndex]) };
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

    const source = readProfileSource(current);
    resetFields.forEach((fieldName) => {
      delete source.fixedValues[fieldName];
    });

    const rng = new RNG(hashSeed(`${ui.seed.value || "personality"}:${profileIndex}:${moduleName}:module:${Date.now()}:${Math.random()}`));
    state.results[profileIndex] = buildProfileFromSource(rng, source);
    state.selectedIndex = profileIndex;
    persistPersonalityBridge();
    renderResults();
    return { skipped: false, index: profileIndex, profile: deepClone(state.results[profileIndex]) };
  }

  function findFieldValue(profile, fieldName) {
    for (const moduleName of moduleOrder) {
      if (profile?.[moduleName] && Object.prototype.hasOwnProperty.call(profile[moduleName], fieldName)) {
        return profile[moduleName][fieldName];
      }
    }
    return "";
  }

  function getFieldOptions(fieldName) {
    if (fieldName === mbtiField) {
      return MBTI_OPTIONS.map((value) => ({ value, label: value }));
    }
    if (bridgeOptionMap[fieldName]?.length) {
      return bridgeOptionMap[fieldName].map((value) => ({ value, label: value }));
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
    const options = getFieldOptions(fieldName);
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

    const rng = new RNG(hashSeed(`${ui.seed.value || "personality"}:${profileIndex}:${fieldName}:manual:${Date.now()}:${Math.random()}`));
    state.results[profileIndex] = buildProfileFromSource(rng, source);
    state.selectedIndex = profileIndex;
    persistPersonalityBridge();
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
                    data-personality-profile-index="${profileIndex}"
                    data-personality-reroll-field="${escapeHtml(label)}"
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
    const linked = profile["输入上下文"]?.["联动人物"];
    const mbtiValue = profile[mbtiModule]?.[mbtiField] || "";
    const topLine = linked
      ? `${linked["姓名"] || "联动人物"} · ${linked["常住城市"] || "城市未定"}`
      : "手动控制或完全随机";
    const temperament = profile["核心维度_社交能量"]?.["社交能量"] || "";
    const emotion = profile["核心维度_情绪模式"]?.["情绪模式"] || "";
    const bridge = profile[bridgeModule]?.["主客体光谱"] || "";

    return `
      <article class="background-card" data-card-index="${index}">
        <div class="card-top">
          <div>
            <h4>性格档案 ${String(index + 1).padStart(2, "0")}</h4>
            <div class="card-subline">${escapeHtml(topLine)}</div>
            <p>${escapeHtml([temperament, emotion, bridge].filter(Boolean).join(" · "))}</p>
          </div>
          <div class="chip-row">
            <span class="value-chip accent">${escapeHtml(mbtiValue || "MBTI")}</span>
            <span class="value-chip">${escapeHtml(profile["输入上下文"]?.["年龄段"] || "")}</span>
            <span class="value-chip">${escapeHtml(profile["输入上下文"]?.["性别认同"] || "")}</span>
          </div>
        </div>

        <div class="card-modules-grid">
          ${moduleOrder.map((moduleName) => `
            <section class="card-section" data-module-name="${escapeHtml(moduleName)}">
              <div class="section-head-row">
                <h5>${escapeHtml(moduleLabel(moduleName))}</h5>
                <button class="module-reroll" type="button" data-module-name="${escapeHtml(moduleName)}">重刷</button>
              </div>
              ${renderFieldList(index, Object.entries(profile[moduleName] || {}))}
            </section>
          `).join("")}
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
          <p class="empty-title">性格档案还没生成</p>
          <p class="empty-copy">先点上面的“生成性格档案”，这里会把核心维度、MBTI、人际面向和桥接层全部展开成卡片。</p>
        </div>
      `;
      ui.resultMeta.textContent = "尚未生成";
      dispatchResultsRendered();
      return;
    }
    ui.results.innerHTML = state.results.map((profile, index) => renderResultCard(profile, index)).join("");
    const linked = currentLinkedProfile();
    ui.resultMeta.textContent = `${state.results.length} 份档案 · 种子 ${ui.seed.value || "自动"}${linked ? ` · 联动 ${linked["姓名"] || "当前人物"}` : ""} · 字段右侧支持重roll/联动`;
    dispatchResultsRendered();
  }

  function generateBatch() {
    syncProfileOptions();
    const seedValue = ui.seed.value.trim() || makeSeedValue();
    ui.seed.value = seedValue;
    const count = 1;
    const previous = state.results.map((profile) => deepClone(profile));
    state.previousResultsByIndex = Object.fromEntries(previous.map((profile, index) => [index, deepClone(profile)]));
    const targetLength = count;
    const nextResults = Array.from({ length: targetLength }, (_, index) => {
      const itemRng = new RNG(hashSeed(`${seedValue}:${index}:${Math.random()}`));
      return buildProfileFromSource(itemRng, createProfileSource(itemRng));
    });
    state.lockedIndices.forEach((index) => {
      if (previous[index]) nextResults[index] = deepClone(previous[index]);
    });
    state.results = nextResults;
    state.selectedIndex = selectedIndexWithin(state.results.length);
    persistPersonalityBridge();
    renderSummary(currentLinkedProfile());
    renderResults();
    return deepClone(state.results);
  }

  function exportJson() {
    if (!state.results.length) return;
    const payload = {
      "元信息": {
        "生成时间": new Date().toISOString(),
        "来源": "随机生成器工作台/性格生成器",
        "数量": state.results.length,
        "种子": ui.seed.value || "",
      },
      "档案列表": state.results,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `性格档案_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function setSelectedIndex(index) {
    state.selectedIndex = 0;
    persistPersonalityBridge();
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
    const nextResults = Array.from({ length: targetLength }, (_, currentIndex) => {
      if (currentIndex === slotIndex || !state.results[currentIndex]) {
        const itemRng = new RNG(hashSeed(`${seedValue}:${currentIndex}:${Math.random()}`));
        return buildProfileFromSource(itemRng, createProfileSource(itemRng));
      }
      return state.results[currentIndex];
    });

    updatePreviousSnapshot(slotIndex, state.results[slotIndex] || null);
    state.results = nextResults;
    state.selectedIndex = slotIndex;
    persistPersonalityBridge();
    renderSummary(currentLinkedProfile());
    renderResults();
    return { skipped: false, index: slotIndex, profile: deepClone(state.results[slotIndex]) };
  }

  function setLinkedProfileIndex(index) {
    syncProfileOptions();
    ui.profileSelect.value = String(normalizeIndex(index));
    renderSummary(currentLinkedProfile());
  }

  function registerController() {
    const registry = window.generatorWorkspaceControllers || (window.generatorWorkspaceControllers = {});
    registry.personality = {
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
    buildSelect(ui.ageGroup, ageGroupLabels.map((label) => ({ value: label, label })), "随机");
    buildSelect(ui.gender, genderLabels.map((label) => ({ value: label, label })), "随机");
    buildSelect(ui.occupation, occupationLabels.map((label) => ({ value: label, label })), "不指定");
    buildSelect(ui.socialDensity, socialDensityLabels.map((label) => ({ value: label, label })), "不指定");
    buildSelect(ui.maritalStatus, maritalStatusLabels.map((label) => ({ value: label, label })), "不指定");
    syncProfileOptions();
    renderNotes();
    renderSummary(currentLinkedProfile());
    ui.seed.value = makeSeedValue();
    renderResults();
  }

  function bindEvents() {
    ui.profileSelect.addEventListener("change", () => renderSummary(currentLinkedProfile()));
    ui.generate.addEventListener("click", generateBatch);
    ui.useLinked.addEventListener("click", applyLinkedProfileToControls);
    ui.export.addEventListener("click", exportJson);
    ui.results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-personality-reroll-field]");
      if (!button) return;
      rerollField(Number(button.dataset.personalityProfileIndex), button.dataset.personalityRerollField);
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
