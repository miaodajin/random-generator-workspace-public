(() => {
  "use strict";

  const DATA = window.ROLE_GENERATOR_DATA;
  if (!DATA) {
    console.warn("偏好档案前端数据未加载。");
    return;
  }

  const WORKSPACE_BRIDGE_KEY = "role_generator_workspace_bridge_v1";
  const RECYCLE_STORAGE_KEY = "fetish_workspace.recycle.v1";
  const TREE_STORAGE_KEY = "fetish_workspace.tree.v1";
  const CUSTOM_ARCH_STORAGE_KEY = "fetish_workspace.custom_archetypes.v1";
  const slotOrder = ["identity", "orientation", "content", "context", "props", "limits"];
  const slotLabels = {
    identity: "角色身份",
    orientation: "取向标签",
    content: "行为偏好",
    context: "场景偏好",
    props: "道具",
    limits: "边界标签",
  };
  const roleLabelMap = {
    S: "支配倾向",
    M: "服从倾向",
    Switch: "双向切换",
  };
  const roleValueByLabel = Object.fromEntries(
    Object.entries(roleLabelMap).map(([value, label]) => [label, value])
  );

  const ui = {
    roleClass: document.getElementById("fetishRoleClass"),
    archetypeSelect: document.getElementById("fetishArchetypeSelect"),
    profileSelect: document.getElementById("fetishProfileSelect"),
    seedBridge: document.getElementById("fetishSeedBridge"),
    seed: document.getElementById("fetishSeed"),
    includeReviewed: document.getElementById("fetishIncludeReviewed"),
    generate: document.getElementById("fetishGenerateButton"),
    randomSeed: document.getElementById("fetishRandomSeedButton"),
    export: document.getElementById("fetishExportButton"),
    applyBridge: document.getElementById("fetishApplyBridgeButton"),
    reset: document.getElementById("fetishReloadFrameButton"),
    resultMeta: document.getElementById("fetishResultMeta"),
    results: document.getElementById("fetishResults"),
    statTotal: document.getElementById("fetishStatTotal"),
    statPool: document.getElementById("fetishStatPool"),
    statLocks: document.getElementById("fetishStatLocks"),
    lockCountBadge: document.getElementById("fetishLockCountBadge"),
    lockSummary: document.getElementById("fetishLockSummary"),
    tagTreeSearch: document.getElementById("fetishTagTreeSearch"),
    tagTreeCount: document.getElementById("fetishTagTreeCount"),
    tagTree: document.getElementById("fetishTagTree"),
    trashCount: document.getElementById("fetishTrashCount"),
    trashList: document.getElementById("fetishTrashList"),
    emptyTrash: document.getElementById("fetishEmptyTrashButton"),
    customArchName: document.getElementById("fetishCustomArchName"),
    customArchRole: document.getElementById("fetishCustomArchRole"),
    addCustomArch: document.getElementById("fetishAddCustomArchButton"),
    customArchList: document.getElementById("fetishCustomArchList"),
  };

  if (!ui.roleClass || !ui.archetypeSelect || !ui.results) {
    return;
  }

  const defaultPools = DATA.default_pools || {};
  const reviewedPools = DATA.reviewed_pools || {};
  const catalogEntries = DATA.catalog_entries || [];
  const catalogAllEntries = DATA.catalog_all_entries || catalogEntries;
  const archetypeMap = DATA.archetypes || {};
  const subbucketLabel = DATA.subbucket_zh || {};
  const catalogById = new Map(catalogEntries.map((entry) => [entry.id, entry]));
  const catalogAllById = new Map(catalogAllEntries.map((entry) => [entry.id, entry]));

  const flatArchetypes = [];
  Object.entries(archetypeMap).forEach(([roleClass, rows]) => {
    (rows || []).forEach((row, index) => {
      flatArchetypes.push({
        id: `${roleClass}:${index}`,
        roleClass,
        label: `${roleLabelMap[roleClass]} · ${row["名称"] || `原型 ${index + 1}`}`,
        data: row,
      });
    });
  });

  const state = {
    results: [],
    selectedIndex: 0,
    lockedIndices: new Set(),
    previousResultsByIndex: {},
    bridgeProfile: null,
    bridgeSeed: "",
    customArchetypes: [],
    recycle: {
      trashed: new Map(),
      purged: new Set(),
    },
    tree: {
      broadOpen: new Set(),
      subOpen: new Set(),
    },
    lockState: Object.fromEntries(slotOrder.map((slot) => [slot, []])),
  };

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function hash(text) {
    let seed = 2166136261;
    const input = String(text || "").trim() || `${Date.now()}`;
    for (let index = 0; index < input.length; index += 1) {
      seed ^= input.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
  }

  function mulberry32(seed) {
    return () => {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRng(seedValue) {
    const seed = seedValue ? hash(seedValue) : Math.floor(Math.random() * 0xffffffff);
    return {
      seed,
      rand: mulberry32(seed),
    };
  }

  function randomInt(rng, min, max) {
    return Math.floor(rng.rand() * (max - min + 1)) + min;
  }

  function choice(rng, rows) {
    return rows && rows.length ? rows[Math.floor(rng.rand() * rows.length)] : null;
  }

  function sample(rng, rows, count) {
    if (!rows || !rows.length || count <= 0) return [];
    const copy = [...rows];
    const output = [];
    while (copy.length && output.length < count) {
      output.push(copy.splice(Math.floor(rng.rand() * copy.length), 1)[0]);
    }
    return output;
  }

  function appendUnique(target, rows, keyFn = (item) => item) {
    const known = new Set(target.map((item) => keyFn(item)));
    rows.forEach((row) => {
      const key = keyFn(row);
      if (!key || known.has(key)) return;
      target.push(row);
      known.add(key);
    });
  }

  function currentPools() {
    return ui.includeReviewed.checked ? reviewedPools : defaultPools;
  }

  function bucketValues(pools, layer, bucket, subbucket) {
    return (((pools[layer] || {})[bucket] || {})[subbucket] || []);
  }

  function canUseLocalStorage() {
    try {
      const key = "__fetish_workspace_probe__";
      window.localStorage.setItem(key, "1");
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  const storageEnabled = canUseLocalStorage();

  function readStorage(key, fallback) {
    if (!storageEnabled) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    if (!storageEnabled) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("写入本地存储失败", key, error);
    }
  }

  function labelForEntry(entry, withStatus = false) {
    if (!entry) return "";
    const candidates = [
      entry.display_name,
      entry.resolved_name_cn,
      entry.resolved_name_en,
      entry.id,
      "（未分类条目）",
    ];
    const base = candidates.find((value) => {
      const text = String(value || "").trim();
      return text && text !== "未命名";
    }) || "（未分类条目）";
    if (withStatus && entry.name_status === "english_only") return `${base}（待译）`;
    return base;
  }

  function totalLocks() {
    return slotOrder.reduce((sum, slot) => sum + state.lockState[slot].length, 0);
  }

  function currentArchetype() {
    const selected = ui.archetypeSelect.value;
    if (selected.startsWith("custom:")) {
      const index = Number(selected.split(":")[1]);
      return state.customArchetypes[index] || null;
    }
    return flatArchetypes.find((item) => item.id === selected) || null;
  }

  function getLockedEntries(slot) {
    const fromState = state.lockState[slot] || [];
    const fromCustom = currentArchetype()?.seedLocks?.[slot] || [];
    return [...fromState, ...fromCustom].filter(Boolean);
  }

  function isEntryRecycled(entry) {
    if (!entry) return false;
    return state.recycle.trashed.has(entry.id) || state.recycle.purged.has(entry.id);
  }

  function visibleCatalogEntries() {
    return catalogEntries.filter((entry) => {
      if (!entry.allow_lock) return false;
      if (entry.review_state === "forbidden") return false;
      if (isEntryRecycled(entry)) return false;
      return ui.includeReviewed.checked ? entry.reviewed_visible : entry.default_visible;
    });
  }

  function roleAndArchetypeForGeneration(rng) {
    const selected = currentArchetype();
    const actualRole = selected?.roleClass || (ui.roleClass.value === "随机" ? choice(rng, ["S", "M", "Switch"]) : ui.roleClass.value) || "Switch";
    const fallback = choice(rng, archetypeMap[actualRole] || []) || { "名称": "随机原型", "维度": {}, "取向种子": [], "偏好子类": {} };
    if (selected?.data) {
      return { roleClass: selected.roleClass, archetype: selected.data };
    }
    return { roleClass: actualRole, archetype: fallback };
  }

  function tagObject(label, intensity, extra = {}) {
    return {
      "标签": label,
      "强度": intensity,
      ...extra,
    };
  }

  function contentObject(label, category, intensity, reviewState) {
    return {
      "标签": label,
      "类别": category,
      "强度": intensity,
      "审核状态": reviewState,
    };
  }

  function buildPersona(rng, roleClass, archetype) {
    const metrics = {};
    Object.entries(archetype["维度"] || {}).forEach(([label, range]) => {
      metrics[label] = `${randomInt(rng, range[0], range[1])}%`;
    });
    return {
      "角色类别": roleLabelMap[roleClass] || roleClass,
      "原型": archetype["名称"] || "随机原型",
      "经验值": `${randomInt(rng, 18, 92)}%`,
      "沟通明确度": `${randomInt(rng, 52, 96)}%`,
      "事后照护需求": `${randomInt(rng, 20, 95)}%`,
      "隐私偏好": `${randomInt(rng, 35, 96)}%`,
      "维度评分": metrics,
    };
  }

  function pickIdentity(pools, rng) {
    const base = bucketValues(pools, "character_metadata", "identity_tags", "identity")
      .map((entry) => labelForEntry(entry, true));
    const output = [
      tagObject("成年", "100%"),
      tagObject("合意", "100%"),
      tagObject("研究角色", "100%"),
    ];
    appendUnique(output, sample(rng, base.map((value) => tagObject(value, "100%")), 2), (item) => item["标签"]);
    appendUnique(output, getLockedEntries("identity").map((entry) => tagObject(labelForEntry(entry, true), "100%")), (item) => item["标签"]);
    return output;
  }

  function pickOrientation(pools, rng, roleClass, archetype) {
    const available = bucketValues(pools, "generator_core", "orientation_tags", "orientation")
      .map((entry) => labelForEntry(entry, true));
    const output = [];
    appendUnique(output, (archetype["取向种子"] || []).map((value) => tagObject(value, `${randomInt(rng, 62, 94)}%`)), (item) => item["标签"]);
    appendUnique(output, sample(rng, available.map((value) => tagObject(value, `${randomInt(rng, 55, 98)}%`)), roleClass === "Switch" ? 3 : 2), (item) => item["标签"]);
    appendUnique(output, getLockedEntries("orientation").map((entry) => tagObject(labelForEntry(entry, true), `${entry.intensity || randomInt(rng, 66, 96)}%`)), (item) => item["标签"]);
    return output;
  }

  function pickContent(pools, rng, archetype) {
    const output = [];
    const used = new Set();
    const pushEntry = (entry, category) => {
      const label = labelForEntry(entry, true);
      if (!label || used.has(label)) return;
      used.add(label);
      output.push(contentObject(
        label,
        category || entry.subbucket_zh || subbucketLabel[entry.subbucket] || "内容",
        `${entry.intensity || randomInt(rng, 28, 96)}%`,
        entry.review_state_zh || "已通过"
      ));
    };

    Object.entries(archetype["偏好子类"] || {}).forEach(([subbucket, desired]) => {
      const entries = bucketValues(pools, "generator_core", "content_tags", subbucket);
      sample(rng, entries, Math.max(1, Math.min(entries.length, Math.ceil(Number(desired || 1) / 2)))).forEach((entry) => {
        pushEntry(entry, subbucketLabel[subbucket] || entry.subbucket_zh);
      });
    });

    const fallback = Object.values((pools.generator_core || {}).content_tags || {}).flat();
    sample(rng, fallback, 8).forEach((entry) => pushEntry(entry, entry.subbucket_zh));
    getLockedEntries("content").forEach((entry) => pushEntry(entry, entry.subbucket_zh));
    return output.slice(0, 12);
  }

  function pickContext(pools, rng) {
    const groups = [
      "group_structure",
      "relationship_context",
      "recording_context",
      "reproductive_context",
      "first_time_context",
      "coercion_fantasy_context",
    ];
    const profile = {};
    groups.forEach((subbucket) => {
      const rows = bucketValues(pools, "character_metadata", "context_profile", subbucket);
      const picked = sample(rng, rows, rows.length > 4 ? 2 : 1)
        .map((entry) => labelForEntry(entry, true))
        .filter(Boolean);
      if (picked.length) profile[subbucketLabel[subbucket] || subbucket] = picked;
    });

    getLockedEntries("context").forEach((entry) => {
      const label = entry.subbucket_zh || entry.lock_slot_zh || "附加情境";
      if (!profile[label]) profile[label] = [];
      if (!profile[label].includes(labelForEntry(entry, true))) {
        profile[label].push(labelForEntry(entry, true));
      }
    });
    return profile;
  }

  function pickProps(pools, rng) {
    const groups = [
      "barrier_or_safety_item",
      "restraint_or_mouth_item",
      "covering_or_masking_item",
      "device_or_machine",
      "fluid_or_surface_modifier",
      "behavioral_modifier",
      "tool_or_device",
    ];
    const values = sample(rng, groups.flatMap((subbucket) => bucketValues(pools, "character_metadata", "prop_modifier_tags", subbucket)), 3)
      .map((entry) => labelForEntry(entry, true));
    appendUnique(values, getLockedEntries("props").map((entry) => labelForEntry(entry, true)));
    return values;
  }

  function pickLimits(pools, rng) {
    const values = sample(rng, bucketValues(pools, "generator_core", "limit_tags", "limits"), 3)
      .map((entry) => tagObject(labelForEntry(entry, true), "100%"));
    appendUnique(values, [tagObject("排除非合意内容", "100%")], (item) => item["标签"]);
    appendUnique(values, getLockedEntries("limits").map((entry) => tagObject(labelForEntry(entry, true), "100%")), (item) => item["标签"]);
    return values;
  }

  function generateOne(seedValue, index) {
    const rng = createRng(`${seedValue}:${index}:${state.bridgeSeed}:${Math.random()}`);
    const pools = currentPools();
    const selection = roleAndArchetypeForGeneration(rng);
    return {
      "人格档案": buildPersona(rng, selection.roleClass, selection.archetype),
      "身份标签": pickIdentity(pools, rng),
      "取向标签": pickOrientation(pools, rng, selection.roleClass, selection.archetype),
      "内容标签": pickContent(pools, rng, selection.archetype),
      "情境档案": pickContext(pools, rng),
      "道具": pickProps(pools, rng),
      "限制标签": pickLimits(pools, rng),
      "输入上下文": {
        "联动人物": deepClone(state.bridgeProfile),
        "联动种子": state.bridgeSeed,
      },
    };
  }

  function resolveSelectionForRole(role, rng) {
    const selected = currentArchetype();
    if (selected?.data) {
      return { roleClass: selected.roleClass, archetype: selected.data };
    }

    const persona = role?.["人格档案"] || {};
    const roleClass = roleValueByLabel[persona["角色类别"]]
      || (ui.roleClass.value === "随机" ? choice(rng, ["S", "M", "Switch"]) : ui.roleClass.value)
      || "Switch";
    const matched = (archetypeMap[roleClass] || []).find((item) => (item["名称"] || "随机原型") === persona["原型"]);
    const fallback = choice(rng, archetypeMap[roleClass] || []) || { "名称": "随机原型", "维度": {}, "取向种子": [], "偏好子类": {} };
    return { roleClass, archetype: matched || fallback };
  }

  function roleTitle(role, index) {
    const persona = role["人格档案"] || {};
    const linked = role["输入上下文"]?.["联动人物"];
    return linked?.["姓名"] || persona["原型"] || `偏好档案 ${index + 1}`;
  }

  function roleSubline(role) {
    const persona = role["人格档案"] || {};
    const linked = role["输入上下文"]?.["联动人物"];
    const parts = [
      persona["角色类别"],
      persona["原型"],
      linked?.["年龄"] != null ? `${linked["年龄"]}岁` : "",
      linked?.["性别认同"],
      linked?.["常住城市"],
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function countContext(profile) {
    return Object.values(profile || {}).reduce((sum, rows) => sum + ((rows || []).length || 0), 0);
  }

  function renderPills(rows, prefix = "") {
    if (!rows || !rows.length) return `<div class="empty-state-inline">暂无</div>`;
    return `<div class="pills">${rows.map((row) => `
      <button class="pill pill-removable" type="button" data-role-remove-tag="${esc(row["标签"] || row)}">
        ${prefix ? `<span class="pill-prefix">${esc(prefix)}</span>` : ""}
        <span>${esc(row["标签"] || row)}</span>
        ${row["强度"] ? `<span class="pill-pct">${esc(row["强度"])}</span>` : ""}
        <span class="pill-x">✕</span>
      </button>
    `).join("")}</div>`;
  }

  function renderContext(profile) {
    const rows = Object.entries(profile || {}).filter(([, values]) => Array.isArray(values) && values.length);
    if (!rows.length) return `<div class="empty-state-inline">暂无</div>`;
    return `<div class="kv-list">${rows.map(([label, values]) => `
      <div class="kv-row">
        <span class="kv-label">${esc(label)}</span>
        <span class="kv-value">${esc(values.join("、"))}</span>
      </div>
    `).join("")}</div>`;
  }

  function renderContent(rows) {
    if (!rows || !rows.length) return `<div class="empty-state-inline">暂无</div>`;
    return `<div class="content-list">${rows.map((row) => `
      <button class="content-row content-removable" type="button" data-role-remove-tag="${esc(row["标签"])}">
        <div>
          <div class="tag-name">${esc(row["标签"])} <span class="pill-pct">${esc(row["强度"] || "")}</span></div>
          <div class="tag-cat">${esc(row["类别"] || "")}</div>
        </div>
        <span class="tag-state">${esc(row["审核状态"] || "")}</span>
      </button>
    `).join("")}</div>`;
  }

  function renderRoleSection(title, moduleName, body) {
    return `
      <section class="card-section" data-module-name="${esc(moduleName)}">
        <div class="section-head-row">
          <h5>${esc(title)}</h5>
          <button class="module-reroll" type="button" data-module-name="${esc(moduleName)}">重刷</button>
        </div>
        ${body}
      </section>
    `;
  }

  function renderCard(role, index) {
    const persona = role["人格档案"] || {};
    const metrics = Object.entries(persona["维度评分"] || {}).slice(0, 4);
    const metricSummary = metrics.map(([label, value]) => `${label} ${value}`).join(" · ");
    return `
      <article class="background-card role-card" data-card-index="${index}">
        <div class="card-top role-card-head">
          <div>
            <div class="role-badge">${esc(persona["角色类别"] || "偏好档案")}</div>
            <h3>${esc(roleTitle(role, index))}</h3>
            <div class="role-card-sub">${esc(roleSubline(role) || `偏好档案 ${index + 1}`)}</div>
            ${metricSummary ? `<p>${esc(metricSummary)}</p>` : ""}
          </div>
          <div class="chip-row">
            <span class="value-chip accent">${esc(persona["原型"] || "随机原型")}</span>
            <span class="value-chip">${esc(role["输入上下文"]?.["联动人物"]?.["性别认同"] || "未联动")}</span>
          </div>
        </div>

        <div class="card-modules-grid">
          ${renderRoleSection("角色身份", "角色身份", renderPills(role["身份标签"]))}
          ${renderRoleSection("取向标签", "取向标签", renderPills(role["取向标签"]))}
          ${renderRoleSection("行为偏好", "行为偏好", renderContent(role["内容标签"]))}
          ${renderRoleSection("场景偏好", "场景偏好", renderContext(role["情境档案"]))}
          ${renderRoleSection("边界与道具", "边界与道具", renderPills(role["限制标签"], "边界") + renderPills((role["道具"] || []).map((label) => ({ "标签": label })), "道具"))}
        </div>
      </article>
    `;
  }

  function dispatchResultsRendered() {
    window.dispatchEvent(new CustomEvent("workspace:results-rendered", {
      detail: {
        panelId: "fetish",
        count: state.results.length,
        selectedIndex: state.selectedIndex,
      },
    }));
  }

  function renderResults() {
    if (!state.results.length) {
      ui.results.innerHTML = `
        <div class="empty-state">
          <p class="empty-title">偏好档案还没生成</p>
          <p class="empty-copy">点击上面的“生成偏好档案”，这里会生成角色身份、取向标签、行为偏好、场景偏好和边界道具卡。</p>
        </div>
      `;
      ui.resultMeta.textContent = "尚未生成";
      dispatchResultsRendered();
      return;
    }

    ui.results.innerHTML = state.results.map((role, index) => renderCard(role, index)).join("");
    ui.resultMeta.textContent = `${state.results.length} 份偏好档案 · 种子 ${ui.seed.value || "自动"}${state.bridgeProfile ? ` · 联动 ${state.bridgeProfile["姓名"] || "当前人物"}` : ""} · 锁定标签 ${totalLocks()}`;
    dispatchResultsRendered();
  }

  function highestLockedIndex() {
    return state.lockedIndices.size ? Math.max(...state.lockedIndices) : -1;
  }

  function normalizeIndex(index) {
    const numeric = Number(index);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
  }

  function selectedIndexWithin(length) {
    if (!length) return 0;
    return Math.max(0, Math.min(state.selectedIndex, length - 1));
  }

  function updatePreviousSnapshot(index, value) {
    state.previousResultsByIndex[index] = value == null ? null : deepClone(value);
  }

  function generateBatch() {
    const seedValue = ui.seed.value.trim() || `fetish-${Date.now().toString(36)}`;
    ui.seed.value = seedValue;
    const count = 1;
    const previous = state.results.map((role) => deepClone(role));
    state.previousResultsByIndex = Object.fromEntries(previous.map((role, index) => [index, deepClone(role)]));

    const targetLength = count;
    const nextResults = Array.from({ length: targetLength }, (_, index) => generateOne(seedValue, index));
    state.lockedIndices.forEach((index) => {
      if (previous[index]) nextResults[index] = deepClone(previous[index]);
    });

    state.results = nextResults;
    state.selectedIndex = 0;
    renderStats();
    renderResults();
    return deepClone(state.results);
  }

  function rerollModule(profileIndex, moduleName) {
    const slotIndex = 0;
    const current = state.results[slotIndex];
    if (!current) return null;
    if (state.lockedIndices.has(slotIndex)) {
      return { skipped: true, reason: "locked", index: slotIndex };
    }

    updatePreviousSnapshot(slotIndex, current);
    const seedValue = ui.seed.value.trim() || `fetish-${Date.now().toString(36)}`;
    ui.seed.value = seedValue;
    const rng = createRng(`${seedValue}:${slotIndex}:${state.bridgeSeed}:${moduleName}:${Date.now()}`);
    const pools = currentPools();
    const selection = resolveSelectionForRole(current, rng);
    const next = deepClone(current);

    next["输入上下文"] = {
      "联动人物": deepClone(state.bridgeProfile),
      "联动种子": state.bridgeSeed,
    };

    switch (moduleName) {
      case "角色身份":
      case "身份标签":
        next["身份标签"] = pickIdentity(pools, rng);
        break;
      case "取向标签":
        next["取向标签"] = pickOrientation(pools, rng, selection.roleClass, selection.archetype);
        break;
      case "行为偏好":
      case "内容标签":
        next["内容标签"] = pickContent(pools, rng, selection.archetype);
        break;
      case "场景偏好":
      case "情境档案":
        next["情境档案"] = pickContext(pools, rng);
        break;
      case "边界与道具":
      case "限制与道具":
        next["限制标签"] = pickLimits(pools, rng);
        next["道具"] = pickProps(pools, rng);
        break;
      default:
        return null;
    }

    state.results = [next];
    state.selectedIndex = 0;
    renderStats();
    renderResults();
    return { skipped: false, index: slotIndex, profile: deepClone(next) };
  }

  function removeTagFromRole(cardIndex, tagName) {
    const role = state.results[normalizeIndex(cardIndex)];
    if (!role || !tagName) return;

    ["身份标签", "取向标签", "限制标签"].forEach((key) => {
      role[key] = (role[key] || []).filter((item) => item["标签"] !== tagName);
    });
    role["内容标签"] = (role["内容标签"] || []).filter((item) => item["标签"] !== tagName);
    role["道具"] = (role["道具"] || []).filter((label) => label !== tagName);
    Object.keys(role["情境档案"] || {}).forEach((key) => {
      role["情境档案"][key] = (role["情境档案"][key] || []).filter((label) => label !== tagName);
      if (!role["情境档案"][key].length) delete role["情境档案"][key];
    });

    renderResults();
  }

  function renderLockSummary() {
    if (ui.lockCountBadge) ui.lockCountBadge.textContent = String(totalLocks());
    if (!ui.lockSummary) return;

    const filled = slotOrder.filter((slot) => state.lockState[slot].length);
    if (!filled.length) {
      ui.lockSummary.innerHTML = `<p class="empty-copy">点击右侧标签树的 + 按钮，把条目加入当前生成组合。</p>`;
      return;
    }

    ui.lockSummary.innerHTML = filled.map((slot) => `
      <div class="lock-slot">
        <div class="lock-slot-head">${esc(slotLabels[slot])}（${state.lockState[slot].length}）</div>
        <div class="lock-chips">
          ${state.lockState[slot].map((entry) => `
            <button class="lock-chip" type="button" data-action="remove-lock" data-slot="${esc(slot)}" data-id="${esc(entry.id)}">
              <span>${esc(labelForEntry(entry, true))}</span>
              <span class="remove">✕</span>
            </button>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  function addLock(entry) {
    if (!entry || !entry.allow_lock) return;
    const slot = entry.lock_slot;
    if (!slot || !state.lockState[slot]) return;
    if (!state.lockState[slot].some((item) => item.id === entry.id)) {
      state.lockState[slot].push(entry);
    }
    renderLockSummary();
    renderStats();
    renderTagTree(ui.tagTreeSearch.value);
  }

  function removeLock(slot, id) {
    if (!state.lockState[slot]) return;
    state.lockState[slot] = state.lockState[slot].filter((entry) => entry.id !== id);
    renderLockSummary();
    renderStats();
    renderTagTree(ui.tagTreeSearch.value);
  }

  function persistRecycle() {
    writeStorage(RECYCLE_STORAGE_KEY, {
      trashed: Array.from(state.recycle.trashed.values()),
      purged: Array.from(state.recycle.purged.values()),
    });
  }

  function recycleSnapshot(entry) {
    return {
      id: entry.id,
      display_name: labelForEntry(entry, false),
      resolved_name_cn: entry.resolved_name_cn || "",
      resolved_name_en: entry.resolved_name_en || "",
      broad_category_zh: entry.broad_category_zh || "其他",
      bucket_zh: entry.bucket_zh || "未分类",
      subbucket_zh: entry.subbucket_zh || "未分类",
      removedAt: new Date().toISOString(),
    };
  }

  function renderTrashList() {
    if (ui.trashCount) ui.trashCount.textContent = String(state.recycle.trashed.size);
    if (!ui.trashList) return;
    if (!state.recycle.trashed.size) {
      ui.trashList.innerHTML = `<p class="empty-copy">回收站为空。</p>`;
      return;
    }

    ui.trashList.innerHTML = Array.from(state.recycle.trashed.values())
      .sort((left, right) => String(right.removedAt).localeCompare(String(left.removedAt)))
      .map((entry) => `
        <div class="trash-item">
          <strong>${esc(entry.display_name || entry.resolved_name_cn || entry.resolved_name_en)}</strong>
          <span class="section-meta">${esc(entry.broad_category_zh)} · ${esc(entry.subbucket_zh)}</span>
          <div class="trash-actions">
            <button class="trash-button" type="button" data-action="restore-trash" data-id="${esc(entry.id)}">恢复</button>
            <button class="trash-button" type="button" data-action="purge-trash" data-id="${esc(entry.id)}">彻底删除</button>
          </div>
        </div>
      `).join("");
  }

  function moveToTrash(entry) {
    if (!entry) return;
    state.recycle.trashed.set(entry.id, recycleSnapshot(entry));
    state.recycle.purged.delete(entry.id);
    slotOrder.forEach((slot) => {
      state.lockState[slot] = state.lockState[slot].filter((item) => item.id !== entry.id);
    });
    persistRecycle();
    renderLockSummary();
    renderStats();
    renderTagTree(ui.tagTreeSearch.value);
    renderTrashList();
  }

  function restoreTrash(entryId) {
    state.recycle.trashed.delete(entryId);
    state.recycle.purged.delete(entryId);
    persistRecycle();
    renderStats();
    renderTagTree(ui.tagTreeSearch.value);
    renderTrashList();
  }

  function purgeTrash(entryId) {
    state.recycle.trashed.delete(entryId);
    state.recycle.purged.add(entryId);
    persistRecycle();
    renderStats();
    renderTagTree(ui.tagTreeSearch.value);
    renderTrashList();
  }

  function emptyTrash() {
    state.recycle.trashed.forEach((_, id) => state.recycle.purged.add(id));
    state.recycle.trashed.clear();
    persistRecycle();
    renderStats();
    renderTagTree(ui.tagTreeSearch.value);
    renderTrashList();
  }

  function persistTreeState() {
    writeStorage(TREE_STORAGE_KEY, {
      broadOpen: Array.from(state.tree.broadOpen),
      subOpen: Array.from(state.tree.subOpen),
    });
  }

  function buildTagTree(query) {
    const filter = String(query || "").trim().toLowerCase();
    const groups = new Map();
    const rows = visibleCatalogEntries().filter((entry) => {
      if (!filter) return true;
      const hay = [
        entry.display_name,
        entry.resolved_name_cn,
        entry.resolved_name_en,
        entry.broad_category_zh,
        entry.bucket_zh,
        entry.subbucket_zh,
      ].join(" ").toLowerCase();
      return hay.includes(filter);
    });

    rows.forEach((entry) => {
      const broad = entry.broad_category_zh || "其他";
      const sub = entry.subbucket_zh || "未分类";
      if (!groups.has(broad)) groups.set(broad, new Map());
      const subMap = groups.get(broad);
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub).push(entry);
    });

    return { groups, total: rows.length };
  }

  function renderTagTree(query = "") {
    if (!ui.tagTree) return;
    const tree = buildTagTree(query);
    if (ui.tagTreeCount) ui.tagTreeCount.textContent = `${tree.total} 可用`;

    if (!tree.total) {
      ui.tagTree.innerHTML = `<p class="empty-copy">没有匹配的标签。</p>`;
      return;
    }

    const lockedIds = new Set(slotOrder.flatMap((slot) => state.lockState[slot].map((entry) => entry.id)));
    const filter = String(query || "").trim();
    const markup = [];

    tree.groups.forEach((subMap, broad) => {
      const broadKey = broad;
      const broadOpen = filter ? true : state.tree.broadOpen.has(broadKey);
      markup.push(`<details class="tt-cat"${broadOpen ? " open" : ""} data-level="broad" data-key="${esc(broadKey)}">`);
      markup.push(`<summary>${esc(broad)} <span class="tt-num">${Array.from(subMap.values()).reduce((sum, rows) => sum + rows.length, 0)}</span></summary>`);
      subMap.forEach((entries, sub) => {
        const subKey = `${broad}:::${sub}`;
        const subOpen = filter ? true : state.tree.subOpen.has(subKey);
        markup.push(`<details class="tt-sub"${subOpen ? " open" : ""} data-level="sub" data-key="${esc(subKey)}">`);
        markup.push(`<summary>${esc(sub)} <span class="tt-num">${entries.length}</span></summary>`);
        markup.push(`<div class="tt-sub-group">`);
        entries
          .sort((left, right) => labelForEntry(left).localeCompare(labelForEntry(right), "zh-CN"))
          .forEach((entry) => {
            const isLocked = lockedIds.has(entry.id);
            markup.push(`
              <div class="tt-tag${isLocked ? " tt-locked" : ""}">
                <span class="tt-tag-name">${esc(labelForEntry(entry, true))}</span>
                <div class="tt-tag-actions">
                  <button class="tt-tag-add" type="button" data-action="tree-add" data-id="${esc(entry.id)}"${isLocked ? " disabled" : ""}>${isLocked ? "已加" : "+"}</button>
                  <button class="tt-tag-trash" type="button" data-action="tree-trash" data-id="${esc(entry.id)}">回收</button>
                </div>
              </div>
            `);
          });
        markup.push(`</div></details>`);
      });
      markup.push(`</details>`);
    });

    ui.tagTree.innerHTML = markup.join("");
  }

  function renderStats() {
    const allVisible = catalogAllEntries.filter((entry) => !isEntryRecycled(entry));
    const poolVisible = visibleCatalogEntries();
    if (ui.statTotal) ui.statTotal.textContent = String(allVisible.length);
    if (ui.statPool) ui.statPool.textContent = String(poolVisible.length);
    if (ui.statLocks) ui.statLocks.textContent = String(totalLocks());
  }

  function renderCustomArchetypes() {
    if (!ui.customArchList) return;
    if (!state.customArchetypes.length) {
      ui.customArchList.innerHTML = `<p class="empty-copy">还没有自定义原型。</p>`;
      return;
    }
    ui.customArchList.innerHTML = state.customArchetypes.map((entry, index) => `
      <div class="custom-arch-item">
        <strong>${esc(entry.data["名称"] || `自定义原型 ${index + 1}`)}</strong>
        <span class="section-meta">${esc(roleLabelMap[entry.roleClass] || entry.roleClass)} · 锁定 ${Object.values(entry.seedLocks || {}).reduce((sum, rows) => sum + rows.length, 0)} 项</span>
        <div class="custom-arch-actions">
          <button class="trash-button" type="button" data-action="apply-custom-arch" data-index="${index}">应用</button>
          <button class="trash-button" type="button" data-action="delete-custom-arch" data-index="${index}">删除</button>
        </div>
      </div>
    `).join("");
  }

  function persistCustomArchetypes() {
    writeStorage(CUSTOM_ARCH_STORAGE_KEY, state.customArchetypes);
  }

  function updateArchetypeSelect() {
    const roleClass = ui.roleClass.value || "随机";
    const options = [
      {
        value: "",
        label: roleClass === "随机" ? "随机匹配" : "该类别内随机",
      },
    ];

    flatArchetypes
      .filter((entry) => roleClass === "随机" || entry.roleClass === roleClass)
      .forEach((entry) => {
        options.push({ value: entry.id, label: entry.label });
      });

    state.customArchetypes
      .filter((entry) => roleClass === "随机" || entry.roleClass === roleClass)
      .forEach((entry, index) => {
        options.push({
          value: `custom:${index}`,
          label: `★ ${roleLabelMap[entry.roleClass]} · ${entry.data["名称"] || `自定义原型 ${index + 1}`}`,
        });
      });

    const current = ui.archetypeSelect.value;
    ui.archetypeSelect.innerHTML = options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join("");
    if (options.some((option) => option.value === current)) {
      ui.archetypeSelect.value = current;
    }
  }

  function createCustomArchetype() {
    const name = String(ui.customArchName.value || "").trim();
    if (!name) return;
    const roleClass = ui.customArchRole.value || "Switch";
    const base = currentArchetype()?.data || { "名称": name, "维度": {}, "取向种子": [], "偏好子类": {} };
    const seedLocks = Object.fromEntries(slotOrder.map((slot) => [slot, deepClone(state.lockState[slot])]));

    state.customArchetypes.push({
      roleClass,
      data: {
        ...deepClone(base),
        "名称": name,
      },
      seedLocks,
    });
    ui.customArchName.value = "";
    persistCustomArchetypes();
    updateArchetypeSelect();
    renderCustomArchetypes();
  }

  function exportJson() {
    if (!state.results.length) return;
    const blob = new Blob([JSON.stringify(state.results, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `偏好档案_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function syncBridgeContext(applySeed = false) {
    const bridge = readStorage(WORKSPACE_BRIDGE_KEY, {});
    const profiles = Array.isArray(bridge.profiles) ? bridge.profiles : [];
    const selectedIndex = Number(ui.profileSelect?.value ?? bridge.profileIndex ?? 0) || 0;
    state.bridgeProfile = profiles[selectedIndex] || bridge.activeProfile || null;
    state.bridgeSeed = String(bridge.fetishSeed || "");
    if (ui.seedBridge) ui.seedBridge.value = state.bridgeSeed;
    if (applySeed && state.bridgeSeed) ui.seed.value = state.bridgeSeed;
    if (state.results.length) renderResults();
  }

  function resetPanel() {
    state.results = [];
    state.previousResultsByIndex = {};
    state.lockedIndices.clear();
    ui.seed.value = `fetish-${Date.now().toString(36)}`;
    renderStats();
    renderResults();
  }

  function setSelectedIndex(index) {
    state.selectedIndex = 0;
    return state.selectedIndex;
  }

  function setLockedIndices(indices) {
    state.lockedIndices = new Set((indices || []).some((value) => normalizeIndex(value) === 0) ? [0] : []);
    renderResults();
  }

  function registerController() {
    const registry = window.generatorWorkspaceControllers || (window.generatorWorkspaceControllers = {});
    registry.fetish = {
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
      setLockedIndices,
      rerollModule,
      exportResult(index) {
        return deepClone(state.results[0] || null);
      },
    };
  }

  function bindEvents() {
    ui.generate.addEventListener("click", generateBatch);
    ui.randomSeed.addEventListener("click", () => {
      ui.seed.value = `fetish-${Date.now().toString(36)}`;
      generateBatch();
    });
    ui.export.addEventListener("click", exportJson);
    ui.applyBridge.addEventListener("click", () => syncBridgeContext(true));
    ui.reset.addEventListener("click", resetPanel);
    ui.roleClass.addEventListener("change", updateArchetypeSelect);
    ui.includeReviewed.addEventListener("change", () => {
      renderStats();
      renderTagTree(ui.tagTreeSearch.value);
    });
    ui.tagTreeSearch.addEventListener("input", () => renderTagTree(ui.tagTreeSearch.value));
    ui.emptyTrash?.addEventListener("click", emptyTrash);
    ui.addCustomArch?.addEventListener("click", createCustomArchetype);
    ui.profileSelect?.addEventListener("change", () => syncBridgeContext(false));

    ui.lockSummary?.addEventListener("click", (event) => {
      const button = event.target.closest('[data-action="remove-lock"]');
      if (!button) return;
      removeLock(button.dataset.slot, button.dataset.id);
    });

    ui.tagTree?.addEventListener("toggle", (event) => {
      const details = event.target.closest("details[data-level]");
      if (!details) return;
      const key = details.dataset.key;
      if (details.dataset.level === "broad") {
        if (details.open) state.tree.broadOpen.add(key);
        else state.tree.broadOpen.delete(key);
      } else {
        if (details.open) state.tree.subOpen.add(key);
        else state.tree.subOpen.delete(key);
      }
      persistTreeState();
    }, true);

    ui.tagTree?.addEventListener("click", (event) => {
      const addButton = event.target.closest('[data-action="tree-add"]');
      if (addButton) {
        const entry = catalogById.get(addButton.dataset.id) || catalogAllById.get(addButton.dataset.id);
        if (entry) addLock(entry);
        return;
      }
      const trashButton = event.target.closest('[data-action="tree-trash"]');
      if (trashButton) {
        const entry = catalogById.get(trashButton.dataset.id) || catalogAllById.get(trashButton.dataset.id);
        if (entry) moveToTrash(entry);
      }
    });

    ui.trashList?.addEventListener("click", (event) => {
      const restoreButton = event.target.closest('[data-action="restore-trash"]');
      if (restoreButton) {
        restoreTrash(restoreButton.dataset.id);
        return;
      }
      const purgeButton = event.target.closest('[data-action="purge-trash"]');
      if (purgeButton) purgeTrash(purgeButton.dataset.id);
    });

    ui.customArchList?.addEventListener("click", (event) => {
      const applyButton = event.target.closest('[data-action="apply-custom-arch"]');
      if (applyButton) {
        ui.archetypeSelect.value = `custom:${applyButton.dataset.index}`;
        return;
      }
      const deleteButton = event.target.closest('[data-action="delete-custom-arch"]');
      if (!deleteButton) return;
      state.customArchetypes.splice(Number(deleteButton.dataset.index), 1);
      persistCustomArchetypes();
      updateArchetypeSelect();
      renderCustomArchetypes();
    });

    ui.results.addEventListener("click", (event) => {
      const removable = event.target.closest("[data-role-remove-tag]");
      if (!removable) return;
      const card = removable.closest(".background-card");
      removeTagFromRole(Number(card?.dataset.cardIndex || 0), removable.dataset.roleRemoveTag);
    });

    window.addEventListener("workspace:bridge-updated", () => syncBridgeContext(false));
  }

  function init() {
    const recycle = readStorage(RECYCLE_STORAGE_KEY, null);
    if (recycle?.trashed) {
      recycle.trashed.forEach((entry) => state.recycle.trashed.set(entry.id, entry));
    }
    if (recycle?.purged) {
      recycle.purged.forEach((entryId) => state.recycle.purged.add(entryId));
    }

    const tree = readStorage(TREE_STORAGE_KEY, null);
    if (tree?.broadOpen) tree.broadOpen.forEach((key) => state.tree.broadOpen.add(key));
    if (tree?.subOpen) tree.subOpen.forEach((key) => state.tree.subOpen.add(key));

    state.customArchetypes = readStorage(CUSTOM_ARCH_STORAGE_KEY, []);

    updateArchetypeSelect();
    renderStats();
    renderLockSummary();
    renderTagTree();
    renderTrashList();
    renderCustomArchetypes();
    syncBridgeContext(false);
    registerController();
    bindEvents();
  }

  init();
})();
