(() => {
  const BG_DATA = window.CHARACTER_BACKGROUND_DATA;
  const NAME_DATA = window.ROLE_GENERATOR_NAME_DATA;

  if (!BG_DATA || !BG_DATA.files) {
    console.error("人物背景数据包未加载。");
    return;
  }

  const files = BG_DATA.files;
  const baseLib = files["候选项_基础库.json"];
  const cityPool = files["城市池.json"];
  const cityMeta = files["城市元数据.json"];
  const fieldDefs = files["字段定义.json"];
  const studentTypes = files["学生类型库.json"].student_types;
  const rulesCity = files["规则_城市派生.json"];
  const rulesAgeEdu = files["规则_年龄与教育.json"];
  const rulesAgeMarital = files["规则_年龄与婚姻.json"];
  const rulesJob = files["规则_年龄教育与职业.json"];
  const rulesDerived = files["规则_派生.json"];

  const ui = {
    tabs: Array.from(document.querySelectorAll(".generator-tab")),
    panels: Array.from(document.querySelectorAll(".workspace-panel")),
    count: document.getElementById("bgCount"),
    ageGroup: document.getElementById("bgAgeGroup"),
    gender: document.getElementById("bgGender"),
    cityTier: document.getElementById("bgCityTier"),
    growthRegion: document.getElementById("bgGrowthRegion"),
    seed: document.getElementById("bgSeed"),
    generate: document.getElementById("bgGenerateButton"),
    randomSeed: document.getElementById("bgRandomSeedButton"),
    export: document.getElementById("bgExportButton"),
    resultMeta: document.getElementById("bgResultMeta"),
    results: document.getElementById("backgroundResults"),
    notes: document.getElementById("bgNotes"),
    statCities: document.getElementById("bgStatCities"),
    statRegions: document.getElementById("bgStatRegions"),
    statFields: document.getElementById("bgStatFields"),
    fetishProfileSelect: document.getElementById("fetishProfileSelect"),
    fetishSeedBridge: document.getElementById("fetishSeedBridge"),
    fetishApplyBridgeButton: document.getElementById("fetishApplyBridgeButton"),
    fetishReloadFrameButton: document.getElementById("fetishReloadFrameButton"),
    fetishSummary: document.getElementById("fetishSummary"),
  };

  const state = {
    backgrounds: [],
    activeFetishProfileIndex: 0,
    lockedIndices: new Set(),
    previousResultsByIndex: {},
  };

  const WORKSPACE_BRIDGE_KEY = "role_generator_workspace_bridge_v1";
  const occupationLabels = rulesJob["职业大类标签"] || {};
  const occupationIdByLabel = Object.fromEntries(
    Object.entries(occupationLabels).map(([id, label]) => [label, id])
  );
  const REROLL_FIELD_META = {
    "姓名": { mode: "solo", hint: "只更换姓名，保留当前年龄与性别语境。" },
    "年龄": { mode: "linked", hint: "年龄会联动恋爱状态、居住状态和生活阶段。" },
    "年龄段": { mode: "linked", hint: "年龄段会联动年龄、教育、职业、关系与生活节奏。" },
    "性别认同": { mode: "linked", hint: "性别认同会联动性取向与姓名。" },
    "性取向": { mode: "solo", hint: "会在当前性别认同约束下重新抽取。" },
    "城市层级": { mode: "linked", hint: "城市层级会联动常住城市、居住环境与语言习惯。" },
    "常住城市": { mode: "linked", hint: "常住城市会联动语言习惯。" },
    "成长地区": { mode: "linked", hint: "成长地区会联动地域文化背景、家庭环境、成长环境与语言习惯。" },
    "居住环境": { mode: "solo", hint: "会在当前年龄、职业与城市层级约束下重抽。" },
    "教育状态": { mode: "linked", hint: "教育状态会联动职业、学生类型、活动节奏、作息与居住状态。" },
    "专业方向": { mode: "linked", hint: "专业方向会在当前教育状态约束下重抽，并轻度影响职业与节奏。" },
    "职业大类": { mode: "linked", hint: "职业大类会联动活动节奏、居住环境、作息与社交密度。" },
    "学生类型": { mode: "linked", hint: "学生类型来自教育状态，点击会联动重抽教育链。" },
    "主活动节奏": { mode: "linked", hint: "主活动节奏会联动作息类型。" },
    "婚姻状况": { mode: "linked", hint: "婚姻状况会联动恋爱状态与居住状态。" },
    "恋爱状态": { mode: "linked", hint: "恋爱状态会联动居住状态。" },
    "居住状态": { mode: "solo", hint: "会在当前年龄、婚姻、恋爱与教育约束下重抽。" },
    "地域文化背景": { mode: "solo", hint: "会在当前成长地区约束下重抽。" },
    "家庭环境": { mode: "solo", hint: "会在当前成长地区约束下重抽。" },
    "成长环境": { mode: "solo", hint: "会在当前成长地区约束下重抽。" },
    "语言习惯": { mode: "solo", hint: "会在当前成长地区与常住城市语境下重抽。" },
    "生活阶段": { mode: "linked", hint: "生活阶段来自年龄与教育状态，点击会联动重抽年龄阶段链。" },
    "作息类型": { mode: "solo", hint: "会在当前活动节奏约束下重抽。" },
    "社交密度": { mode: "solo", hint: "会在当前职业约束下重抽。" },
  };
  const BACKGROUND_FIELD_GROUPS = {
    "基础身份": ["姓名", "年龄", "年龄段", "性别认同", "性取向"],
    "城市与成长": ["城市层级", "常住城市", "成长地区", "居住环境", "成长环境", "语言习惯"],
    "教育与职业": ["教育状态", "学生类型", "专业方向", "职业大类", "生活阶段", "主活动节奏", "作息类型"],
    "关系与居住": ["婚姻状况", "恋爱状态", "居住状态", "社交密度"],
    "背景底色": ["地域文化背景", "家庭环境"],
  };
  const EDUCATION_ID_BY_STUDENT_TYPE_ID = Object.fromEntries(
    Object.entries(rulesDerived.student_type_by_education_state || {}).map(([educationId, studentTypeId]) => [studentTypeId, educationId])
  );
  const COMPLETED_EDUCATION_FALLBACK = {
    college_in_progress: "college_grad",
    bachelor_in_progress: "bachelor_grad",
    master_in_progress: "master_grad",
    doctor_in_progress: "doctor_grad",
  };
  const BACKGROUND_EXTRA_FIELDS = ["专业方向"];
  const MAJOR_DIRECTIONS = [
    { id: "computing", label: "计算机" },
    { id: "data_science", label: "数据科学" },
    { id: "economics", label: "经济学" },
    { id: "marketing", label: "市场营销" },
    { id: "journalism", label: "新闻传播" },
    { id: "chinese_literature", label: "汉语言文学" },
    { id: "translation", label: "英语" },
    { id: "psychology", label: "心理学" },
    { id: "education", label: "教育学" },
    { id: "law", label: "法学" },
    { id: "clinical_medicine", label: "临床医学" },
    { id: "nursing", label: "护理学" },
    { id: "pharmacy", label: "药学" },
    { id: "architecture", label: "建筑学" },
    { id: "design", label: "设计" },
    { id: "tourism_hospitality", label: "旅游与酒店管理" },
    { id: "rehabilitation", label: "康复治疗" },
    { id: "preschool_education", label: "学前教育" },
    { id: "mechanical_manufacturing", label: "机械制造与自动化" },
    { id: "public_administration", label: "公共管理" },
    { id: "sports_science", label: "体育" },
    { id: "arts", label: "艺术" },
  ];
  const LEGACY_MAJOR_ID_MAP = {
    software_engineering: "computing",
    computer_science: "computing",
    finance: "economics",
    accounting: "economics",
    e_commerce: "marketing",
    visual_design: "design",
    animation_media: "design",
    industrial_design: "design",
  };
  const LEGACY_MAJOR_LABEL_MAP = {
    软件工程: "computing",
    计算机科学与技术: "computing",
    "计算机/软件工程": "computing",
    金融学: "economics",
    会计学: "economics",
    "英语/翻译": "translation",
    电子商务: "marketing",
    视觉传达: "design",
    动画与数字媒体: "design",
    工业设计: "design",
    体育学: "sports_science",
    艺术学: "arts",
  };
  const MAJOR_RULES_VOCATIONAL = {
    nursing: 16,
    preschool_education: 14,
    marketing: 16,
    tourism_hospitality: 12,
    rehabilitation: 10,
    mechanical_manufacturing: 18,
    design: 14,
    sports_science: 8,
    arts: 6,
  };
  const MAJOR_RULES_COLLEGE = {
    computing: 18,
    marketing: 18,
    economics: 14,
    nursing: 12,
    design: 14,
    tourism_hospitality: 8,
    rehabilitation: 8,
    preschool_education: 6,
    sports_science: 6,
    arts: 8,
  };
  const MAJOR_RULES_BACHELOR = {
    computing: 20,
    data_science: 6,
    economics: 14,
    marketing: 10,
    journalism: 6,
    chinese_literature: 6,
    translation: 5,
    psychology: 6,
    education: 6,
    law: 6,
    clinical_medicine: 5,
    nursing: 5,
    pharmacy: 4,
    architecture: 3,
    design: 10,
    sports_science: 4,
    arts: 5,
  };
  const MAJOR_RULES_MASTER = {
    computing: 16,
    data_science: 8,
    economics: 10,
    marketing: 4,
    journalism: 6,
    psychology: 9,
    education: 8,
    law: 7,
    clinical_medicine: 8,
    pharmacy: 6,
    architecture: 4,
    design: 8,
    public_administration: 8,
    sports_science: 4,
    arts: 4,
  };
  const MAJOR_RULES_DOCTOR = {
    computing: 14,
    data_science: 8,
    psychology: 9,
    education: 9,
    law: 7,
    clinical_medicine: 10,
    pharmacy: 8,
    design: 4,
    public_administration: 7,
    sports_science: 4,
    arts: 4,
  };
  const MAJOR_DIRECTION_RULES = {
    vocational_grad: MAJOR_RULES_VOCATIONAL,
    college_in_progress: MAJOR_RULES_COLLEGE,
    college_grad: MAJOR_RULES_COLLEGE,
    bachelor_in_progress: MAJOR_RULES_BACHELOR,
    bachelor_grad: MAJOR_RULES_BACHELOR,
    master_in_progress: MAJOR_RULES_MASTER,
    master_grad: MAJOR_RULES_MASTER,
    doctor_in_progress: MAJOR_RULES_DOCTOR,
    doctor_grad: MAJOR_RULES_DOCTOR,
  };
  const MAJOR_DIRECTION_OCCUPATION_BIAS = {
    computing: { tech: 70, office: 12, freelance: 8, public_sector: 6, education: 4 },
    data_science: { tech: 58, office: 20, public_sector: 12, education: 5, freelance: 5 },
    economics: { office: 60, public_sector: 14, self_employed: 8, retail: 6, freelance: 4, unemployed: 8 },
    marketing: { office: 34, retail: 20, self_employed: 18, creative: 12, tech: 8, service: 4, freelance: 4 },
    journalism: { creative: 46, office: 14, freelance: 20, education: 6, public_sector: 6, unemployed: 8 },
    chinese_literature: { education: 30, creative: 24, public_sector: 20, office: 12, freelance: 8, unemployed: 6 },
    translation: { office: 24, education: 24, creative: 18, service: 12, freelance: 12, unemployed: 10 },
    psychology: { education: 28, medical: 20, office: 20, public_sector: 12, freelance: 8, unemployed: 12 },
    education: { education: 62, public_sector: 20, office: 10, service: 4, unemployed: 4 },
    law: { public_sector: 36, office: 30, self_employed: 10, education: 6, freelance: 6, unemployed: 12 },
    clinical_medicine: { medical: 76, public_sector: 8, education: 6, office: 4, unemployed: 6 },
    nursing: { medical: 74, service: 10, public_sector: 6, education: 4, unemployed: 6 },
    pharmacy: { medical: 60, tech: 12, office: 10, public_sector: 8, unemployed: 10 },
    architecture: { office: 24, tech: 24, creative: 24, self_employed: 12, public_sector: 6, unemployed: 10 },
    design: { creative: 52, freelance: 14, tech: 10, manufacturing: 8, office: 8, self_employed: 4, unemployed: 4 },
    tourism_hospitality: { service: 56, office: 10, retail: 12, self_employed: 6, unemployed: 16 },
    rehabilitation: { medical: 46, education: 12, service: 14, office: 8, unemployed: 20 },
    preschool_education: { education: 66, service: 10, public_sector: 8, office: 6, unemployed: 10 },
    mechanical_manufacturing: { manufacturing: 68, tech: 12, office: 6, self_employed: 6, unemployed: 8 },
    public_administration: { public_sector: 60, office: 20, education: 8, self_employed: 4, unemployed: 8 },
    sports_science: { education: 28, service: 24, medical: 14, self_employed: 12, public_sector: 8, freelance: 6, unemployed: 8 },
    arts: { creative: 54, freelance: 18, education: 10, service: 8, self_employed: 6, office: 4 },
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

  const SURNAMES = [
    "王","李","张","刘","陈","杨","黄","赵","吴","周","徐","孙","马","胡","朱","郭",
    "何","林","罗","高","郑","梁","谢","宋","唐","韩","许","邓","冯","曹","彭","曾",
    "萧","田","董","潘","袁","蔡","蒋","余","于","杜","叶","程","苏","魏","吕","丁",
    "沈","任","姚","卢","傅","钟","姜","崔","谭","廖","范","汪","陆","金","石","戴",
    "贾","韦","夏","邱","方","侯","邹","熊","孟","秦","白","江","阎","薛","尹","段",
    "雷","龙","史","贺","顾","毛","郝","龚","邵","万","覃","武","钱","乔","赖","文"
  ];

  const COMPOUND_SURNAMES = [
    "欧阳","上官","司马","诸葛","夏侯","司徒","尉迟","公孙",
    "慕容","令狐","宇文","独孤","南宫","东方","司空","长孙"
  ];

  const LEGACY_F = ["婷","雪","梅","芳","丽","敏","静","燕","玲","娟","琳","莹","倩","怡","雅","萍","蕾","薇","颖","露","瑶","诗","梦","语","涵","妍","欣","悦","萱","菲","璇","晴"];
  const LEGACY_M = ["伟","强","磊","军","勇","杰","涛","明","辉","鹏","飞","超","峰","浩","宇","轩","博","然","昊","睿","晨","旭","阳","刚","毅","锋","恒","泽","凯","翔","志","文"];
  const LEADING_PENALTY = new Set(["一", "之", "子", "士", "其", "以", "乃"]);

  const lists = {
    ageGroups: byId(baseLib.age_groups),
    genders: byId(baseLib.gender_identities),
    orientations: byId(baseLib.orientations),
    cityTiers: byId(baseLib.city_tiers),
    growthRegions: byId(baseLib.growth_regions),
    livingEnvironments: byId(baseLib.living_environments),
    educationStates: byId(baseLib.education_states),
    occupations: byId(baseLib.occupation_groups),
    maritalStatuses: byId(baseLib.marital_statuses),
    relationshipStatuses: byId(baseLib.relationship_statuses),
    livingStatuses: byId(baseLib.living_statuses),
    regionalBackgrounds: byId(baseLib.regional_backgrounds),
    familyBackgrounds: byId(baseLib.family_backgrounds),
    growthEnvironments: byId(baseLib.growth_environments),
    languageStyles: byId(baseLib.language_styles),
    activityPatterns: byId(baseLib.activity_patterns),
    sleepPatterns: byId(baseLib.sleep_patterns),
    socialDensity: byId(baseLib.social_density),
    studentTypes: byId(studentTypes),
    majorDirections: byId(MAJOR_DIRECTIONS),
    lifeStages: byId(rulesDerived.life_stage_rules),
  };

  function byId(rows) {
    return Object.fromEntries((rows || []).map((row) => [row.id, row]));
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

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function randomInt(rng, min, max) {
    return Math.floor(rng.rand() * (max - min + 1)) + min;
  }

  function choice(rng, rows) {
    return rows[Math.floor(rng.rand() * rows.length)];
  }

  function weightedChoice(rng, rows) {
    if (!rows || !rows.length) return null;
    let total = 0;
    rows.forEach((row) => { total += Number(row.weight || 0); });
    if (!total) return rows[0];
    let roll = rng.rand() * total;
    for (const row of rows) {
      roll -= Number(row.weight || 0);
      if (roll <= 0) return row;
    }
    return rows[rows.length - 1];
  }

  function weightedChoiceMap(rng, weightMap) {
    return weightedChoice(rng, Object.entries(weightMap || {}).map(([key, weight]) => ({ key, weight })))?.key || null;
  }

  function chooseDifferent(currentValue, producer, isEqual = (left, right) => left === right, attempts = 12) {
    let last = producer();
    for (let i = 0; i < attempts; i += 1) {
      if (!isEqual(last, currentValue)) return last;
      last = producer();
    }
    return last;
  }

  function pickDifferentWeightedKey(rng, weightMap, currentId) {
    return chooseDifferent(currentId, () => weightedChoiceMap(rng, weightMap));
  }

  function pickDifferentChoice(rng, rows, currentValue) {
    return chooseDifferent(currentValue, () => choice(rng, rows));
  }

  function pickDifferentInt(rng, min, max, currentValue) {
    if (max <= min) return min;
    return chooseDifferent(currentValue, () => randomInt(rng, min, max));
  }

  function getRuleWeights(rules, ctx) {
    return pickRule(rules, ctx)?.weights || null;
  }

  function pickPreservingId(rng, currentId, weightMap) {
    if (currentId && weightMap && Object.prototype.hasOwnProperty.call(weightMap, currentId)) {
      return currentId;
    }
    return weightedChoiceMap(rng, weightMap);
  }

  function findIdByLabel(rows, label) {
    const hit = (rows || []).find((row) => row.label === label);
    return hit ? hit.id : null;
  }

  function seedForAction(profileIndex, fieldKey) {
    return `${ui.seed.value || "bg"}:${profileIndex}:${fieldKey}:${Date.now()}:${Math.random()}`;
  }

  function matchesRule(rule, ctx) {
    const when = rule.when || {};
    if (when.age_min != null && Number(ctx.age) < Number(when.age_min)) return false;
    if (when.age_max != null && Number(ctx.age) > Number(when.age_max)) return false;
    if (when.occupation_group_in && !when.occupation_group_in.includes(ctx.occupation_group)) return false;
    if (when.city_tier_in && !when.city_tier_in.includes(ctx.city_tier)) return false;
    if (when.marital_status_in && !when.marital_status_in.includes(ctx.marital_status)) return false;
    if (when.relationship_status_in && !when.relationship_status_in.includes(ctx.relationship_status)) return false;
    if (when.education_state_in && !when.education_state_in.includes(ctx.education_state)) return false;
    return true;
  }

  function pickRule(rules, ctx) {
    const ordered = [...(rules || [])].sort((a, b) => (a.priority || 999) - (b.priority || 999));
    return ordered.find((rule) => matchesRule(rule, ctx)) || null;
  }

  function pickFromRuleList(rng, rules, ctx) {
    const rule = pickRule(rules, ctx);
    return rule ? weightedChoiceMap(rng, rule.weights) : null;
  }

  function mergeWeightMaps(parts) {
    const merged = {};
    parts.forEach(({ map, factor }) => {
      if (!map) return;
      Object.entries(map).forEach(([key, value]) => {
        merged[key] = (merged[key] || 0) + Number(value) * factor;
      });
    });
    return merged;
  }

  function sourceWeightsByAge(age) {
    if (age <= 24) return [{ key: "modern", weight: 58 }, { key: "scholarly", weight: 20 }, { key: "classical", weight: 10 }, { key: "historical", weight: 12 }];
    if (age <= 32) return [{ key: "modern", weight: 50 }, { key: "scholarly", weight: 20 }, { key: "classical", weight: 14 }, { key: "historical", weight: 16 }];
    return [{ key: "modern", weight: 42 }, { key: "scholarly", weight: 20 }, { key: "classical", weight: 18 }, { key: "historical", weight: 20 }];
  }

  function pickSurname(rng) {
    return rng.rand() < 0.035 ? choice(rng, COMPOUND_SURNAMES) : choice(rng, SURNAMES);
  }

  function fallbackName(rng, gender) {
    const surname = pickSurname(rng);
    const pool = gender === "女性" ? LEGACY_F : gender === "男性" ? LEGACY_M : choice(rng, [LEGACY_F, LEGACY_M]);
    const count = rng.rand() < 0.72 ? 2 : 1;
    let given = "";
    for (let i = 0; i < count; i += 1) given += choice(rng, pool);
    return surname + given;
  }

  function tonePreferenceScore(tone, gender) {
    if (!tone) return 0;
    if (gender === "女性") {
      if (tone === 1) return 15;
      if (tone === 3) return 8;
      if (tone === 2) return 3;
      return -3;
    }
    if (gender === "男性") {
      if (tone === 2 || tone === 4) return 12;
      if (tone === 3) return 5;
      return -2;
    }
    return tone === 3 ? 8 : 4;
  }

  function tailPreferenceScore(char, gender) {
    const tails = NAME_DATA?.preferred_tail_chars;
    if (!tails) return 0;
    if (gender === "女性" && tails.feminine.includes(char)) return 10;
    if (gender === "男性" && tails.masculine.includes(char)) return 10;
    if (tails.neutral.includes(char)) return 5;
    return 0;
  }

  function scoreGivenName(name, surname, gender, charMeta) {
    const chars = name.split("");
    const first = charMeta[chars[0]];
    const second = charMeta[chars[1]];
    let score = 100;
    if (!first || !second) return score;
    score += tonePreferenceScore(second.tone, gender);
    score += tailPreferenceScore(chars[1], gender);
    score += Math.min(8, Math.log10((first.count || 10) + 1) * 2);
    score += Math.min(8, Math.log10((second.count || 10) + 1) * 2);
    if (chars[0] === chars[1]) score -= 18;
    if (surname.includes(chars[0]) || surname.includes(chars[1])) score -= 10;
    if (LEADING_PENALTY.has(chars[0])) score -= 8;
    if (first.initial_category && second.initial_category && first.initial_category === second.initial_category) score -= 4;
    if (first.final_category && second.final_category && first.final_category === second.final_category) score -= 3;
    return score;
  }

  function generateName(rng, profile) {
    if (!NAME_DATA?.given_name_pools || !NAME_DATA?.char_meta) return fallbackName(rng, profile.gender);
    const surname = pickSurname(rng);
    const source = weightedChoice(rng, sourceWeightsByAge(profile.age))?.key || "modern";
    const sourceKeys = [...new Set([source, "modern", "scholarly", "classical", "historical"])];
    const candidates = [];
    sourceKeys.forEach((sourceKey, index) => {
      const pool = NAME_DATA.given_name_pools[sourceKey] || [];
      const sampleSize = index === 0 ? 150 : 36;
      for (let i = 0; i < sampleSize; i += 1) {
        const given = pool[Math.floor(rng.rand() * pool.length)];
        if (!given || given.length !== 2) continue;
        candidates.push({ given, score: scoreGivenName(given, surname, profile.gender, NAME_DATA.char_meta) });
      }
    });
    if (!candidates.length) return fallbackName(rng, profile.gender);
    candidates.sort((a, b) => b.score - a.score);
    const finalists = candidates.slice(0, 14);
    const picked = weightedChoice(rng, finalists.map((row, index) => ({ item: row, weight: Math.max(1, 36 - index * 2 + Math.max(0, row.score - 100)) })));
    return picked?.item ? surname + picked.item.given : fallbackName(rng, profile.gender);
  }

  function labelFor(map, id) {
    return map[id]?.label || id || "";
  }

  function buildSelect(select, rows, defaultLabel = "随机") {
    select.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = defaultLabel;
    select.append(auto);
    rows.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.label;
      select.append(option);
    });
  }

  function setupControls() {
    buildSelect(ui.ageGroup, baseLib.age_groups);
    buildSelect(ui.gender, baseLib.gender_identities);
    buildSelect(ui.cityTier, baseLib.city_tiers);
    buildSelect(ui.growthRegion, baseLib.growth_regions);
  }

  function renderNotes() {
    const notes = BG_DATA.metadata?.notes || [];
    if (ui.notes) {
      ui.notes.innerHTML = notes.slice(0, 6).map((note, index) => `
        <article class="memo-item">
          <strong>规则 ${String(index + 1).padStart(2, "0")}</strong>
          <p>${escapeHtml(note)}</p>
        </article>
      `).join("");
    }
    ui.statCities.textContent = Object.values(cityPool).reduce((sum, rows) => sum + rows.length, 0);
    ui.statRegions.textContent = baseLib.growth_regions.length;
    ui.statFields.textContent = fieldDefs.length + BACKGROUND_EXTRA_FIELDS.length;
  }

  function stripMeta(profile) {
    if (!profile) return null;
    const copy = deepClone(profile);
    delete copy._meta;
    return copy;
  }

  function dispatchResultsRendered() {
    window.dispatchEvent(new CustomEvent("workspace:results-rendered", {
      detail: {
        panelId: "background",
        count: state.backgrounds.length,
        selectedIndex: state.activeFetishProfileIndex,
      },
    }));
  }

  function updatePreviousSnapshot(index, value) {
    state.previousResultsByIndex[index] = value == null ? null : deepClone(value);
  }

  function currentFixedControls() {
    return {
      ageGroup: ui.ageGroup.value,
      gender: ui.gender.value,
      cityTier: ui.cityTier.value,
      growthRegion: ui.growthRegion.value,
    };
  }

  function optionsFromRows(rows) {
    return (rows || [])
      .map((row) => ({ value: row.label, label: row.label }))
      .filter((row) => row.value);
  }

  function optionsFromIds(idList, listMap) {
    return (idList || [])
      .map((id) => {
        const label = labelFor(listMap, id);
        return label ? { value: label, label } : null;
      })
      .filter(Boolean);
  }

  function ensureCurrentOption(options, currentValue) {
    const value = String(currentValue || "").trim();
    if (!value) return options;
    if (options.some((option) => option.value === value)) return options;
    return [{ value, label: value }, ...options];
  }

  function normalizeMajorId(majorId) {
    const value = String(majorId || "").trim();
    if (!value) return null;
    return LEGACY_MAJOR_ID_MAP[value] || value;
  }

  function findMajorDirectionId(value) {
    const label = String(value || "").trim();
    if (!label) return null;
    return normalizeMajorId(findIdByLabel(MAJOR_DIRECTIONS, label) || LEGACY_MAJOR_LABEL_MAP[label] || null);
  }

  function getMajorDirectionWeightMap(educationId) {
    return MAJOR_DIRECTION_RULES[educationId] || {};
  }

  function isStudyEducation(educationId) {
    return Boolean((rulesDerived.student_type_by_education_state || {})[educationId]);
  }

  function getMajorDirectionOptions(educationId) {
    const options = optionsFromIds(Object.keys(getMajorDirectionWeightMap(educationId)), lists.majorDirections);
    return options.length ? options : [{ value: "", label: "当前教育状态不设专业方向" }];
  }

  function blendOccupationWeights(baseWeights, majorId) {
    const baseMap = baseWeights || {};
    const majorBias = MAJOR_DIRECTION_OCCUPATION_BIAS[normalizeMajorId(majorId)] || null;
    if (!majorBias) return baseMap;

    const allowedKeys = Object.keys(baseMap);
    if (!allowedKeys.length) return majorBias;

    const relatedMap = Object.fromEntries(
      Object.entries(majorBias).filter(([key]) => allowedKeys.includes(key))
    );
    if (!Object.keys(relatedMap).length) return baseMap;

    const unrelatedMap = Object.fromEntries(
      Object.entries(baseMap).filter(([key]) => !Object.prototype.hasOwnProperty.call(relatedMap, key))
    );

    if (!Object.keys(unrelatedMap).length) {
      return relatedMap;
    }

    const merged = mergeWeightMaps([
      { map: relatedMap, factor: 0.8 },
      { map: unrelatedMap, factor: 0.2 },
    ]);

    return Object.fromEntries(
      allowedKeys
        .map((key) => [key, Number(merged[key] || 0)])
        .filter(([, weight]) => weight > 0)
    );
  }

  function setAgeOnSource(source, age) {
    const numeric = Math.max(18, Math.min(45, Number(age) || 18));
    source.age = numeric;
    const ageGroup = (baseLib.age_groups || []).find((row) => numeric >= Number(row.min) && numeric <= Number(row.max));
    if (ageGroup) source.ageGroupId = ageGroup.id;
  }

  function ensureAgeWithinEducation(source, educationId) {
    const education = lists.educationStates[educationId];
    if (!education) {
      source.educationId = educationId;
      return;
    }
    let age = Number(source.age);
    if (!Number.isFinite(age)) age = Number(education.min_age || 18);
    if (education.min_age != null && age < Number(education.min_age)) age = Number(education.min_age);
    if (education.max_age != null && age > Number(education.max_age)) age = Number(education.max_age);
    setAgeOnSource(source, age);
    source.educationId = educationId;
  }

  function pickClosestEducationId(age, educationIds) {
    let bestId = educationIds[0] || "";
    let bestDistance = Number.POSITIVE_INFINITY;
    educationIds.forEach((educationId) => {
      const education = lists.educationStates[educationId];
      if (!education) return;
      let adjustedAge = Number.isFinite(Number(age)) ? Number(age) : Number(education.min_age || 18);
      if (education.min_age != null && adjustedAge < Number(education.min_age)) adjustedAge = Number(education.min_age);
      if (education.max_age != null && adjustedAge > Number(education.max_age)) adjustedAge = Number(education.max_age);
      const distance = Number.isFinite(Number(age)) ? Math.abs(adjustedAge - Number(age)) : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = educationId;
      }
    });
    return bestId;
  }

  function applyLifeStageChoice(source, stageLabel) {
    const stageRule = (rulesDerived.life_stage_rules || []).find((rule) => rule.label === stageLabel);
    if (!stageRule) return;
    const currentAge = Number(source.age);

    if (stageRule.id === "study_phase") {
      const candidates = Object.keys(rulesDerived.student_type_by_education_state || {});
      const educationId = pickClosestEducationId(currentAge, candidates);
      if (educationId) ensureAgeWithinEducation(source, educationId);
      return;
    }

    const minAge = Number(stageRule.when?.age_min ?? 18);
    const maxAge = Number(stageRule.when?.age_max ?? 45);
    const clampedAge = Number.isFinite(currentAge) ? Math.max(minAge, Math.min(maxAge, currentAge)) : minAge;
    setAgeOnSource(source, clampedAge);

    if (COMPLETED_EDUCATION_FALLBACK[source.educationId]) {
      source.educationId = COMPLETED_EDUCATION_FALLBACK[source.educationId];
    }
    if (source.educationId) ensureAgeWithinEducation(source, source.educationId);
  }

  function buildNameOptions(source, currentValue) {
    const picked = new Set([String(currentValue || "").trim()].filter(Boolean));
    const gender = labelFor(lists.genders, source.genderId) || "女性";
    const age = Number.isFinite(Number(source.age)) ? Number(source.age) : 25;

    for (let attempt = 0; attempt < 36 && picked.size < 10; attempt += 1) {
      const rng = new RNG(hashSeed(`${ui.seed.value || "background"}:name:${gender}:${age}:${attempt}:${Date.now()}`));
      picked.add(generateName(rng, { gender, age }));
    }

    return Array.from(picked).map((value) => ({ value, label: value }));
  }

  function resolveBackgroundFieldOptions(source, fieldName, profile) {
    switch (fieldName) {
      case "姓名":
        return buildNameOptions(source, profile?.姓名);
      case "年龄": {
        const ageGroup = lists.ageGroups[source.ageGroupId];
        const min = Number(ageGroup?.min ?? 18);
        const max = Number(ageGroup?.max ?? 45);
        return Array.from({ length: max - min + 1 }, (_, index) => {
          const value = String(min + index);
          return { value, label: value };
        });
      }
      case "年龄段":
        return optionsFromRows(baseLib.age_groups);
      case "性别认同":
        return optionsFromRows(baseLib.gender_identities);
      case "性取向":
        return optionsFromIds(Object.keys(rulesDerived.orientation_by_gender[source.genderId] || {}), lists.orientations);
      case "城市层级":
        return optionsFromRows(baseLib.city_tiers);
      case "常住城市":
        return (cityPool[source.cityTierId] || []).map((value) => ({ value, label: value }));
      case "成长地区":
        return optionsFromRows(baseLib.growth_regions);
      case "居住环境":
        return optionsFromIds(
          Object.keys(getRuleWeights(rulesDerived.living_environment_rules, {
            age: source.age,
            occupation_group: source.occupationId,
            city_tier: source.cityTierId,
          }) || {}),
          lists.livingEnvironments
        );
      case "教育状态":
        return optionsFromIds(Object.keys(rulesAgeEdu[source.ageGroupId] || {}), lists.educationStates);
      case "专业方向":
        return getMajorDirectionOptions(source.educationId);
      case "职业大类": {
        if (isStudyEducation(source.educationId)) {
          return [{ value: "学生", label: "学生" }];
        }
        const occupationWeights = (((rulesJob["按年龄段与教育状态的职业权重"] || {})[source.ageGroupId] || {})[source.educationId]) || {};
        return optionsFromIds(Object.keys(blendOccupationWeights(occupationWeights, source.majorId)), lists.occupations).map((option) => ({
          value: occupationLabels[occupationIdByLabel[option.value]] || option.value,
          label: occupationLabels[occupationIdByLabel[option.value]] || option.value,
        }));
      }
      case "学生类型":
        return optionsFromRows(studentTypes);
      case "生活阶段":
        return optionsFromIds(Object.keys(lists.lifeStages), lists.lifeStages);
      case "主活动节奏": {
        const activityWeights = source.occupationId === "student"
          ? (rulesDerived.activity_pattern_rules.student_by_education_state[source.educationId] || {})
          : (rulesDerived.activity_pattern_rules.occupation_group_default[source.occupationId] || {});
        return optionsFromIds(Object.keys(activityWeights), lists.activityPatterns);
      }
      case "婚姻状况":
        return optionsFromIds(Object.keys(rulesAgeMarital[source.ageGroupId] || {}), lists.maritalStatuses);
      case "恋爱状态":
        return optionsFromRows(baseLib.relationship_statuses);
      case "居住状态":
        return optionsFromIds(
          Object.keys(getRuleWeights(rulesDerived.living_status_rules, {
            age: source.age,
            marital_status: source.maritalId,
            relationship_status: source.relationshipId,
            education_state: source.educationId,
          }) || {}),
          lists.livingStatuses
        );
      case "地域文化背景":
        return optionsFromIds(Object.keys(rulesCity["成长地区地域文化背景派生规则"][source.growthRegionId] || {}), lists.regionalBackgrounds);
      case "家庭环境":
        return optionsFromIds(Object.keys(rulesCity["成长地区家庭环境派生规则"][source.growthRegionId] || {}), lists.familyBackgrounds);
      case "成长环境":
        return optionsFromIds(Object.keys(rulesCity["成长地区成长环境派生规则"][source.growthRegionId] || {}), lists.growthEnvironments);
      case "语言习惯":
        return optionsFromIds(Object.keys(buildLanguageWeightMap(source.growthRegionId, source.cityName) || {}), lists.languageStyles);
      case "作息类型":
        return optionsFromIds(Object.keys(rulesDerived.sleep_pattern_by_activity_pattern[source.activityId] || {}), lists.sleepPatterns);
      case "社交密度":
        return optionsFromIds(
          Object.keys(getRuleWeights(rulesDerived.social_density_rules, { occupation_group: source.occupationId }) || {}),
          lists.socialDensity
        );
      default:
        return [];
    }
  }

  function clearBackgroundFieldForReroll(source, fieldKey) {
    switch (fieldKey) {
      case "姓名":
        source.name = null;
        break;
      case "年龄":
        source.age = null;
        source.relationshipId = null;
        source.livingEnvironmentId = null;
        source.livingStatusId = null;
        break;
      case "年龄段":
        source.ageGroupId = null;
        source.age = null;
        source.educationId = null;
        source.majorId = null;
        source.occupationId = null;
        source.activityId = null;
        source.maritalId = null;
        source.relationshipId = null;
        source.livingEnvironmentId = null;
        source.livingStatusId = null;
        source.sleepId = null;
        source.socialId = null;
        source.name = null;
        break;
      case "性别认同":
        source.genderId = null;
        source.orientationId = null;
        source.name = null;
        break;
      case "性取向":
        source.orientationId = null;
        break;
      case "城市层级":
        source.cityTierId = null;
        source.cityName = null;
        source.livingEnvironmentId = null;
        source.languageId = null;
        break;
      case "常住城市":
        source.cityName = null;
        source.languageId = null;
        break;
      case "成长地区":
        source.growthRegionId = null;
        source.regionalBackgroundId = null;
        source.familyBackgroundId = null;
        source.growthEnvironmentId = null;
        source.languageId = null;
        break;
      case "居住环境":
        source.livingEnvironmentId = null;
        break;
      case "教育状态":
      case "学生类型":
        source.educationId = null;
        source.majorId = null;
        source.occupationId = null;
        source.activityId = null;
        source.livingStatusId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "专业方向":
        source.majorId = null;
        source.occupationId = null;
        source.activityId = null;
        source.livingEnvironmentId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "职业大类":
        source.occupationId = null;
        source.activityId = null;
        source.livingEnvironmentId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "主活动节奏":
        source.activityId = null;
        source.sleepId = null;
        break;
      case "婚姻状况":
        source.maritalId = null;
        source.relationshipId = null;
        source.livingStatusId = null;
        break;
      case "恋爱状态":
        source.maritalId = "single";
        source.relationshipId = null;
        source.livingStatusId = null;
        break;
      case "居住状态":
        source.livingStatusId = null;
        break;
      case "地域文化背景":
        source.regionalBackgroundId = null;
        break;
      case "家庭环境":
        source.familyBackgroundId = null;
        break;
      case "成长环境":
        source.growthEnvironmentId = null;
        break;
      case "语言习惯":
        source.languageId = null;
        break;
      case "生活阶段":
        source.age = null;
        source.educationId = null;
        source.majorId = null;
        source.occupationId = null;
        source.activityId = null;
        source.relationshipId = null;
        source.livingEnvironmentId = null;
        source.livingStatusId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "作息类型":
        source.sleepId = null;
        break;
      case "社交密度":
        source.socialId = null;
        break;
      default:
        break;
    }
  }

  function applyBackgroundFieldChoice(source, fieldKey, nextValue) {
    const value = Array.isArray(nextValue) ? String(nextValue[0] || "").trim() : String(nextValue ?? "").trim();
    clearBackgroundFieldForReroll(source, fieldKey);

    switch (fieldKey) {
      case "姓名":
        source.name = value;
        break;
      case "年龄":
        setAgeOnSource(source, Number(value));
        break;
      case "年龄段":
        source.ageGroupId = findIdByLabel(baseLib.age_groups, value) || source.ageGroupId;
        source.age = null;
        break;
      case "性别认同":
        source.genderId = findIdByLabel(baseLib.gender_identities, value) || source.genderId;
        break;
      case "性取向":
        source.orientationId = findIdByLabel(baseLib.orientations, value) || source.orientationId;
        break;
      case "城市层级":
        source.cityTierId = findIdByLabel(baseLib.city_tiers, value) || source.cityTierId;
        break;
      case "常住城市":
        source.cityName = value;
        break;
      case "成长地区":
        source.growthRegionId = findIdByLabel(baseLib.growth_regions, value) || source.growthRegionId;
        break;
      case "居住环境":
        source.livingEnvironmentId = findIdByLabel(baseLib.living_environments, value) || source.livingEnvironmentId;
        break;
      case "教育状态":
        ensureAgeWithinEducation(source, findIdByLabel(baseLib.education_states, value) || source.educationId);
        break;
      case "学生类型": {
        const studentTypeId = findIdByLabel(studentTypes, value);
        const educationId = EDUCATION_ID_BY_STUDENT_TYPE_ID[studentTypeId];
        if (educationId) ensureAgeWithinEducation(source, educationId);
        break;
      }
      case "专业方向":
        source.majorId = findMajorDirectionId(value);
        break;
      case "职业大类":
        source.occupationId = isStudyEducation(source.educationId) ? "student" : (occupationIdByLabel[value] || source.occupationId);
        break;
      case "生活阶段":
        applyLifeStageChoice(source, value);
        break;
      case "主活动节奏":
        source.activityId = findIdByLabel(baseLib.activity_patterns, value) || source.activityId;
        break;
      case "婚姻状况":
        source.maritalId = findIdByLabel(baseLib.marital_statuses, value) || source.maritalId;
        break;
      case "恋爱状态":
        source.maritalId = "single";
        source.relationshipId = findIdByLabel(baseLib.relationship_statuses, value) || source.relationshipId;
        break;
      case "居住状态":
        source.livingStatusId = findIdByLabel(baseLib.living_statuses, value) || source.livingStatusId;
        break;
      case "地域文化背景":
        source.regionalBackgroundId = findIdByLabel(baseLib.regional_backgrounds, value) || source.regionalBackgroundId;
        break;
      case "家庭环境":
        source.familyBackgroundId = findIdByLabel(baseLib.family_backgrounds, value) || source.familyBackgroundId;
        break;
      case "成长环境":
        source.growthEnvironmentId = findIdByLabel(baseLib.growth_environments, value) || source.growthEnvironmentId;
        break;
      case "语言习惯":
        source.languageId = findIdByLabel(baseLib.language_styles, value) || source.languageId;
        break;
      case "作息类型":
        source.sleepId = findIdByLabel(baseLib.sleep_patterns, value) || source.sleepId;
        break;
      case "社交密度":
        source.socialId = findIdByLabel(baseLib.social_density, value) || source.socialId;
        break;
      default:
        break;
    }
  }

  function createBackgroundAtIndex(seedValue, index, fixed = currentFixedControls()) {
    const rng = new RNG(hashSeed(`${seedValue}:${index}:${Math.random()}`));
    return generateBackground(rng, fixed);
  }

  function highestLockedIndex() {
    return state.lockedIndices.size ? Math.max(...state.lockedIndices) : -1;
  }

  function selectedIndexWithin(length) {
    if (!length) return 0;
    return Math.max(0, Math.min(state.activeFetishProfileIndex, length - 1));
  }

  function populateFetishProfiles() {
    if (!ui.fetishProfileSelect) return;
    ui.fetishProfileSelect.innerHTML = "";
    if (!state.backgrounds.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "先生成人物背景";
      ui.fetishProfileSelect.append(option);
      ui.fetishProfileSelect.disabled = true;
      return;
    }

    ui.fetishProfileSelect.disabled = false;
    state.backgrounds.forEach((profile, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${profile.姓名} · ${profile.年龄} 岁 · ${profile.常住城市}`;
      ui.fetishProfileSelect.append(option);
    });

    if (state.activeFetishProfileIndex >= state.backgrounds.length) {
      state.activeFetishProfileIndex = 0;
    }
    ui.fetishProfileSelect.value = String(state.activeFetishProfileIndex);
  }

  function renderFetishSummary(profile) {
    if (!ui.fetishSummary) return;
    if (!profile) {
      ui.fetishSummary.innerHTML = `
        <article class="fetish-summary-card">
          <strong>还没有联动人物</strong>
          <p>先在“人物背景生成器”里生成档案，这里才能把当前人物同步给偏好页。</p>
        </article>
      `;
      return;
    }

    ui.fetishSummary.innerHTML = `
      <article class="fetish-summary-card">
        <strong>${escapeHtml(profile.姓名)}</strong>
        <p>${escapeHtml(profile.年龄)} 岁 · ${escapeHtml(profile.性别认同)} · ${escapeHtml(profile.常住城市)} 常住 / ${escapeHtml(profile.成长地区)} 成长</p>
        <p>${escapeHtml(profile.教育状态)} · ${escapeHtml(profile.职业大类)} · ${escapeHtml(profile.地域文化背景)}</p>
      </article>
    `;
  }

  function buildWorkspaceBridgePayload() {
    let existing = {};
    try {
      existing = JSON.parse(window.localStorage.getItem(WORKSPACE_BRIDGE_KEY) || "{}");
    } catch (error) {
      existing = {};
    }
    const profiles = state.backgrounds.map(stripMeta);
    const active = profiles[state.activeFetishProfileIndex] || profiles[0] || null;
    return {
      ...existing,
      version: 2,
      updatedAt: new Date().toISOString(),
      fetishSeed: ui.seed.value.trim(),
      profileIndex: state.activeFetishProfileIndex,
      profiles,
      activeProfile: active,
    };
  }

  function persistWorkspaceBridge() {
    const payload = buildWorkspaceBridgePayload();
    try {
      window.localStorage.setItem(WORKSPACE_BRIDGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("写入工作台联动桥失败", error);
    }
    if (ui.fetishSeedBridge) {
      ui.fetishSeedBridge.value = payload.fetishSeed || "";
    }
    renderFetishSummary(payload.activeProfile);
    window.dispatchEvent(new CustomEvent("workspace:bridge-updated", {
      detail: payload,
    }));
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;");
  }

  function makeSeedValue() {
    return `bg-${Math.floor(Math.random() * 1e9)}`;
  }

  function buildLanguageWeightMap(growthRegionId, cityName) {
    const baseMap = rulesCity["成长地区语言习惯基础规则"][growthRegionId] || {};
    const cityInfo = cityMeta[cityName] || {};
    const zoneMap = rulesCity["常住城市语言区参考规则"][cityInfo["语言区"]] || {};
    const cityMap = rulesCity["常住城市语言修正规则"][cityName] || null;
    return cityMap
      ? mergeWeightMaps([{ map: baseMap, factor: 0.35 }, { map: zoneMap, factor: 0.25 }, { map: cityMap, factor: 0.4 }])
      : mergeWeightMaps([{ map: baseMap, factor: 0.6 }, { map: zoneMap, factor: 0.4 }]);
  }

  function deriveLanguageId(rng, growthRegionId, cityName) {
    return weightedChoiceMap(rng, buildLanguageWeightMap(growthRegionId, cityName));
  }

  function deriveLifeStage(ctx) {
    const rule = pickRule(rulesDerived.life_stage_rules, ctx);
    return rule?.id || "entry_phase";
  }

  function createBackgroundSource(rng, fixed = {}) {
    const ageGroup = fixed.ageGroup ? lists.ageGroups[fixed.ageGroup] : weightedChoice(rng, baseLib.age_groups);
    const gender = fixed.gender ? lists.genders[fixed.gender] : weightedChoice(rng, baseLib.gender_identities);
    const cityTier = fixed.cityTier ? lists.cityTiers[fixed.cityTier] : weightedChoice(rng, baseLib.city_tiers);
    const growthRegion = fixed.growthRegion ? lists.growthRegions[fixed.growthRegion] : weightedChoice(rng, baseLib.growth_regions);

    return {
      ageGroupId: ageGroup.id,
      age: randomInt(rng, ageGroup.min, ageGroup.max),
      genderId: gender.id,
      orientationId: null,
      cityTierId: cityTier.id,
      cityName: null,
      growthRegionId: growthRegion.id,
      educationId: null,
      majorId: null,
      occupationId: null,
      activityId: null,
      maritalId: null,
      relationshipId: null,
      livingEnvironmentId: null,
      livingStatusId: null,
      regionalBackgroundId: null,
      familyBackgroundId: null,
      growthEnvironmentId: null,
      languageId: null,
      sleepId: null,
      socialId: null,
      name: null,
    };
  }

  function readBackgroundSource(profile) {
    const source = profile?._meta?.source;
    if (source) return Object.assign({}, source);

    const ids = profile?._meta?.ids || {};
    return {
      ageGroupId: ids.ageGroup || findIdByLabel(baseLib.age_groups, profile?.年龄段),
      age: Number(profile?.年龄) || 25,
      genderId: ids.gender || findIdByLabel(baseLib.gender_identities, profile?.性别认同),
      orientationId: ids.orientation || findIdByLabel(baseLib.orientations, profile?.性取向),
      cityTierId: ids.cityTier || findIdByLabel(baseLib.city_tiers, profile?.城市层级),
      cityName: profile?.常住城市 || null,
      growthRegionId: ids.growthRegion || findIdByLabel(baseLib.growth_regions, profile?.成长地区),
      educationId: ids.education || findIdByLabel(baseLib.education_states, profile?.教育状态),
      majorId: normalizeMajorId(ids.major || findMajorDirectionId(profile?.专业方向)),
      occupationId: ids.occupation || occupationIdByLabel[profile?.职业大类] || null,
      activityId: ids.activity || findIdByLabel(baseLib.activity_patterns, profile?.主活动节奏),
      maritalId: ids.marital || findIdByLabel(baseLib.marital_statuses, profile?.婚姻状况),
      relationshipId: ids.relationship || findIdByLabel(baseLib.relationship_statuses, profile?.恋爱状态),
      livingEnvironmentId: ids.livingEnvironment || findIdByLabel(baseLib.living_environments, profile?.居住环境),
      livingStatusId: ids.livingStatus || findIdByLabel(baseLib.living_statuses, profile?.居住状态),
      regionalBackgroundId: ids.regionalBackground || findIdByLabel(baseLib.regional_backgrounds, profile?.地域文化背景),
      familyBackgroundId: ids.familyBackground || findIdByLabel(baseLib.family_backgrounds, profile?.家庭环境),
      growthEnvironmentId: ids.growthEnvironment || findIdByLabel(baseLib.growth_environments, profile?.成长环境),
      languageId: ids.language || findIdByLabel(baseLib.language_styles, profile?.语言习惯),
      sleepId: ids.sleep || findIdByLabel(baseLib.sleep_patterns, profile?.作息类型),
      socialId: ids.social || findIdByLabel(baseLib.social_density, profile?.社交密度),
      name: profile?.姓名 || null,
    };
  }

  function buildBackgroundFromSource(rng, source) {
    const next = Object.assign({}, source);
    const ageGroup = lists.ageGroups[next.ageGroupId] || weightedChoice(rng, baseLib.age_groups);
    next.ageGroupId = ageGroup.id;
    if (!Number.isFinite(Number(next.age)) || Number(next.age) < ageGroup.min || Number(next.age) > ageGroup.max) {
      next.age = randomInt(rng, ageGroup.min, ageGroup.max);
    }
    next.age = Number(next.age);

    const gender = lists.genders[next.genderId] || weightedChoice(rng, baseLib.gender_identities);
    next.genderId = gender.id;
    next.orientationId = pickPreservingId(rng, next.orientationId, rulesDerived.orientation_by_gender[next.genderId] || {});

    const cityTier = lists.cityTiers[next.cityTierId] || weightedChoice(rng, baseLib.city_tiers);
    next.cityTierId = cityTier.id;
    const tierCities = cityPool[next.cityTierId] || [];
    if (!tierCities.length) {
      next.cityName = "";
    } else if (!tierCities.includes(next.cityName)) {
      next.cityName = choice(rng, tierCities);
    }

    const growthRegion = lists.growthRegions[next.growthRegionId] || weightedChoice(rng, baseLib.growth_regions);
    next.growthRegionId = growthRegion.id;

    next.educationId = pickPreservingId(rng, next.educationId, rulesAgeEdu[next.ageGroupId] || {});
    next.majorId = normalizeMajorId(next.majorId);
    next.majorId = pickPreservingId(rng, next.majorId, getMajorDirectionWeightMap(next.educationId));
    if (isStudyEducation(next.educationId)) {
      next.occupationId = "student";
    } else {
      const occupationWeights = blendOccupationWeights(
        (((rulesJob["按年龄段与教育状态的职业权重"] || {})[next.ageGroupId] || {})[next.educationId]) || {},
        next.majorId
      );
      next.occupationId = pickPreservingId(rng, next.occupationId, occupationWeights);
    }

    const activityWeights = next.occupationId === "student"
      ? (rulesDerived.activity_pattern_rules.student_by_education_state[next.educationId] || {})
      : (rulesDerived.activity_pattern_rules.occupation_group_default[next.occupationId] || {});
    next.activityId = pickPreservingId(rng, next.activityId, activityWeights);

    next.maritalId = pickPreservingId(rng, next.maritalId, rulesAgeMarital[next.ageGroupId] || {});

    const relationshipWeights = next.maritalId === "single"
      ? getRuleWeights(rulesDerived.relationship_status_rules, { age: next.age })
      : null;
    if (next.maritalId !== "single") {
      next.relationshipId = null;
    } else {
      next.relationshipId = pickPreservingId(rng, next.relationshipId, relationshipWeights || {});
    }

    const livingEnvWeights = getRuleWeights(rulesDerived.living_environment_rules, {
      age: next.age,
      occupation_group: next.occupationId,
      city_tier: next.cityTierId,
    }) || {};
    next.livingEnvironmentId = pickPreservingId(rng, next.livingEnvironmentId, livingEnvWeights);

    const livingStatusWeights = getRuleWeights(rulesDerived.living_status_rules, {
      age: next.age,
      marital_status: next.maritalId,
      relationship_status: next.relationshipId,
      education_state: next.educationId,
    }) || {};
    next.livingStatusId = pickPreservingId(rng, next.livingStatusId, livingStatusWeights);

    next.regionalBackgroundId = pickPreservingId(
      rng,
      next.regionalBackgroundId,
      rulesCity["成长地区地域文化背景派生规则"][next.growthRegionId] || {}
    );
    next.familyBackgroundId = pickPreservingId(
      rng,
      next.familyBackgroundId,
      rulesCity["成长地区家庭环境派生规则"][next.growthRegionId] || {}
    );
    next.growthEnvironmentId = pickPreservingId(
      rng,
      next.growthEnvironmentId,
      rulesCity["成长地区成长环境派生规则"][next.growthRegionId] || {}
    );

    next.languageId = pickPreservingId(rng, next.languageId, buildLanguageWeightMap(next.growthRegionId, next.cityName));
    next.sleepId = pickPreservingId(rng, next.sleepId, rulesDerived.sleep_pattern_by_activity_pattern[next.activityId] || {});
    next.socialId = pickPreservingId(
      rng,
      next.socialId,
      getRuleWeights(rulesDerived.social_density_rules, { occupation_group: next.occupationId }) || {}
    );

    if (!next.name) {
      next.name = generateName(rng, { gender: gender.label, age: next.age });
    }

    const studentTypeId = rulesDerived.student_type_by_education_state[next.educationId] || null;
    const lifeStageId = deriveLifeStage({ age: next.age, education_state: next.educationId });

    return {
      姓名: next.name,
      年龄段: ageGroup.label,
      年龄: next.age,
      性别认同: gender.label,
      性取向: labelFor(lists.orientations, next.orientationId),
      城市层级: cityTier.label,
      常住城市: next.cityName,
      成长地区: growthRegion.label,
      居住环境: labelFor(lists.livingEnvironments, next.livingEnvironmentId),
      教育状态: labelFor(lists.educationStates, next.educationId),
      专业方向: labelFor(lists.majorDirections, next.majorId),
      职业大类: occupationLabels[next.occupationId] || next.occupationId,
      学生类型: studentTypeId ? labelFor(lists.studentTypes, studentTypeId) : "",
      主活动节奏: labelFor(lists.activityPatterns, next.activityId),
      婚姻状况: labelFor(lists.maritalStatuses, next.maritalId),
      恋爱状态: next.relationshipId ? labelFor(lists.relationshipStatuses, next.relationshipId) : "",
      居住状态: labelFor(lists.livingStatuses, next.livingStatusId),
      地域文化背景: labelFor(lists.regionalBackgrounds, next.regionalBackgroundId),
      家庭环境: labelFor(lists.familyBackgrounds, next.familyBackgroundId),
      成长环境: labelFor(lists.growthEnvironments, next.growthEnvironmentId),
      语言习惯: labelFor(lists.languageStyles, next.languageId),
      生活阶段: labelFor(lists.lifeStages, lifeStageId),
      作息类型: labelFor(lists.sleepPatterns, next.sleepId),
      社交密度: labelFor(lists.socialDensity, next.socialId),
      _meta: {
        cityInfo: cityMeta[next.cityName] || {},
        source: next,
        ids: {
          ageGroup: next.ageGroupId,
          gender: next.genderId,
          orientation: next.orientationId,
          cityTier: next.cityTierId,
          growthRegion: next.growthRegionId,
          education: next.educationId,
          major: next.majorId,
          occupation: next.occupationId,
          activity: next.activityId,
          marital: next.maritalId,
          relationship: next.relationshipId,
          livingEnvironment: next.livingEnvironmentId,
          livingStatus: next.livingStatusId,
          regionalBackground: next.regionalBackgroundId,
          familyBackground: next.familyBackgroundId,
          growthEnvironment: next.growthEnvironmentId,
          language: next.languageId,
          lifeStage: lifeStageId,
          sleep: next.sleepId,
          social: next.socialId,
        }
      }
    };
  }

  function generateBackground(rng, fixed = {}) {
    return buildBackgroundFromSource(rng, createBackgroundSource(rng, fixed));
  }

  function rerollBackgroundField(profileIndex, fieldKey) {
    const current = state.backgrounds[profileIndex];
    if (!current) return;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, stripMeta(current));

    const source = readBackgroundSource(current);
    const rng = new RNG(hashSeed(seedForAction(profileIndex, fieldKey)));
    const ageGroup = lists.ageGroups[source.ageGroupId];
    const cityTier = lists.cityTiers[source.cityTierId];

    switch (fieldKey) {
      case "姓名":
        source.name = chooseDifferent(
          current.姓名,
          () => generateName(rng, { gender: current.性别认同 || "女性", age: source.age })
        );
        break;
      case "年龄":
        if (ageGroup) source.age = pickDifferentInt(rng, ageGroup.min, ageGroup.max, source.age);
        source.relationshipId = null;
        source.livingEnvironmentId = null;
        source.livingStatusId = null;
        break;
      case "年龄段": {
        const nextAgeGroupId = pickDifferentWeightedKey(
          rng,
          Object.fromEntries(baseLib.age_groups.map((row) => [row.id, row.weight])),
          source.ageGroupId
        );
        source.ageGroupId = nextAgeGroupId || source.ageGroupId;
        const nextAgeGroup = lists.ageGroups[source.ageGroupId];
        if (nextAgeGroup) source.age = randomInt(rng, nextAgeGroup.min, nextAgeGroup.max);
        source.educationId = null;
        source.majorId = null;
        source.occupationId = null;
        source.activityId = null;
        source.maritalId = null;
        source.relationshipId = null;
        source.livingEnvironmentId = null;
        source.livingStatusId = null;
        source.sleepId = null;
        source.socialId = null;
        source.name = null;
        break;
      }
      case "性别认同":
        source.genderId = pickDifferentWeightedKey(
          rng,
          Object.fromEntries(baseLib.gender_identities.map((row) => [row.id, row.weight])),
          source.genderId
        ) || source.genderId;
        source.orientationId = null;
        source.name = null;
        break;
      case "性取向":
        source.orientationId = pickDifferentWeightedKey(
          rng,
          rulesDerived.orientation_by_gender[source.genderId] || {},
          source.orientationId
        );
        break;
      case "城市层级":
        source.cityTierId = pickDifferentWeightedKey(
          rng,
          Object.fromEntries(baseLib.city_tiers.map((row) => [row.id, row.weight])),
          source.cityTierId
        ) || source.cityTierId;
        source.cityName = null;
        source.livingEnvironmentId = null;
        source.languageId = null;
        break;
      case "常住城市":
        source.cityName = cityTier && (cityPool[source.cityTierId] || []).length > 1
          ? pickDifferentChoice(rng, cityPool[source.cityTierId], source.cityName)
          : null;
        source.languageId = null;
        break;
      case "成长地区":
        source.growthRegionId = pickDifferentWeightedKey(
          rng,
          Object.fromEntries(baseLib.growth_regions.map((row) => [row.id, row.weight])),
          source.growthRegionId
        ) || source.growthRegionId;
        source.regionalBackgroundId = null;
        source.familyBackgroundId = null;
        source.growthEnvironmentId = null;
        source.languageId = null;
        break;
      case "居住环境":
        source.livingEnvironmentId = null;
        break;
      case "教育状态":
      case "学生类型":
        source.educationId = pickDifferentWeightedKey(rng, rulesAgeEdu[source.ageGroupId] || {}, source.educationId);
        source.majorId = null;
        source.occupationId = null;
        source.activityId = null;
        source.livingStatusId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "专业方向":
        source.majorId = pickDifferentWeightedKey(rng, getMajorDirectionWeightMap(source.educationId), source.majorId);
        source.occupationId = null;
        source.activityId = null;
        source.livingEnvironmentId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "职业大类":
        source.occupationId = isStudyEducation(source.educationId)
          ? "student"
          : pickDifferentWeightedKey(
            rng,
            blendOccupationWeights(
              (((rulesJob["按年龄段与教育状态的职业权重"] || {})[source.ageGroupId] || {})[source.educationId]) || {},
              source.majorId
            ),
            source.occupationId
          );
        source.activityId = null;
        source.livingEnvironmentId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "主活动节奏":
        source.activityId = null;
        source.sleepId = null;
        break;
      case "婚姻状况":
        source.maritalId = pickDifferentWeightedKey(rng, rulesAgeMarital[source.ageGroupId] || {}, source.maritalId);
        source.relationshipId = null;
        source.livingStatusId = null;
        break;
      case "恋爱状态":
        if (source.maritalId !== "single") source.maritalId = "single";
        source.relationshipId = null;
        source.livingStatusId = null;
        break;
      case "居住状态":
        source.livingStatusId = null;
        break;
      case "地域文化背景":
        source.regionalBackgroundId = null;
        break;
      case "家庭环境":
        source.familyBackgroundId = null;
        break;
      case "成长环境":
        source.growthEnvironmentId = null;
        break;
      case "语言习惯":
        source.languageId = null;
        break;
      case "生活阶段":
        if (ageGroup) source.age = pickDifferentInt(rng, ageGroup.min, ageGroup.max, source.age);
        source.educationId = null;
        source.majorId = null;
        source.occupationId = null;
        source.activityId = null;
        source.relationshipId = null;
        source.livingEnvironmentId = null;
        source.livingStatusId = null;
        source.sleepId = null;
        source.socialId = null;
        break;
      case "作息类型":
        source.sleepId = null;
        break;
      case "社交密度":
        source.socialId = null;
        break;
      default:
        return;
    }

    state.backgrounds[profileIndex] = buildBackgroundFromSource(rng, source);
    state.activeFetishProfileIndex = profileIndex;
    populateFetishProfiles();
    persistWorkspaceBridge();
    renderBackgrounds();
    return { skipped: false, index: profileIndex, profile: stripMeta(state.backgrounds[profileIndex]) };
  }

  function rerollModule(profileIndex, moduleName) {
    const current = state.backgrounds[profileIndex];
    if (!current) return null;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, stripMeta(current));

    const source = readBackgroundSource(current);
    (BACKGROUND_FIELD_GROUPS[moduleName] || []).forEach((fieldName) => {
      clearBackgroundFieldForReroll(source, fieldName);
    });

    const rng = new RNG(hashSeed(`${ui.seed.value || "background"}:${profileIndex}:${moduleName}:module:${Date.now()}:${Math.random()}`));
    state.backgrounds[profileIndex] = buildBackgroundFromSource(rng, source);
    state.activeFetishProfileIndex = profileIndex;
    populateFetishProfiles();
    persistWorkspaceBridge();
    renderBackgrounds();
    return { skipped: false, index: profileIndex, profile: stripMeta(state.backgrounds[profileIndex]) };
  }

  function getFieldEditor(profileIndex, fieldName) {
    const profile = state.backgrounds[normalizeIndex(profileIndex)];
    if (!profile) return null;
    const source = readBackgroundSource(profile);
    const options = ensureCurrentOption(resolveBackgroundFieldOptions(source, fieldName, profile), profile[fieldName]);
    if (!options.length) return null;
    return {
      type: "select",
      value: String(profile[fieldName] || ""),
      options,
    };
  }

  function applyFieldValue(profileIndex, fieldName, nextValue) {
    const current = state.backgrounds[profileIndex];
    if (!current) return null;
    if (state.lockedIndices.has(profileIndex)) return { skipped: true, reason: "locked", index: profileIndex };
    updatePreviousSnapshot(profileIndex, stripMeta(current));

    const source = readBackgroundSource(current);
    applyBackgroundFieldChoice(source, fieldName, nextValue);

    const rng = new RNG(hashSeed(`${ui.seed.value || "background"}:${profileIndex}:${fieldName}:manual:${Date.now()}:${Math.random()}`));
    state.backgrounds[profileIndex] = buildBackgroundFromSource(rng, source);
    state.activeFetishProfileIndex = profileIndex;
    populateFetishProfiles();
    persistWorkspaceBridge();
    renderBackgrounds();
    return { skipped: false, index: profileIndex, profile: stripMeta(state.backgrounds[profileIndex]) };
  }

  function renderFieldList(profileIndex, fields) {
    return `
      <div class="field-grid">
        ${fields.map(([label, value]) => `
          <div class="field-item" data-field-name="${escapeHtml(label)}">
            <div class="field-head">
              <span class="field-label">${escapeHtml(label)}</span>
              <div class="field-actions">
                ${REROLL_FIELD_META[label] ? `
                  <button
                    class="field-reroll ${REROLL_FIELD_META[label].mode === "linked" ? "is-linked" : "is-solo"}"
                    data-profile-index="${profileIndex}"
                    data-reroll-field="${escapeHtml(label)}"
                    title="${escapeHtml(REROLL_FIELD_META[label].hint)}"
                  >
                    ${REROLL_FIELD_META[label].mode === "linked" ? "联动" : "重roll"}
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

  function renderBackgroundCard(profile, index) {
    return `
      <article class="background-card" data-profile-index="${index}" data-card-index="${index}">
        <div class="card-top">
          <div>
            <h4>${escapeHtml(profile.姓名)}</h4>
            <div class="card-subline">${escapeHtml(profile.年龄)} 岁 · ${escapeHtml(profile.常住城市)} 常住 · ${escapeHtml(profile.成长地区)} 成长</div>
          </div>
          <div class="chip-row">
            <span class="value-chip accent">${escapeHtml(profile.性别认同)}</span>
            <span class="value-chip">${escapeHtml(profile.性取向)}</span>
          </div>
        </div>
        <div class="card-modules-grid">
          ${Object.entries(BACKGROUND_FIELD_GROUPS).map(([moduleName, fieldNames]) => `
            <section class="card-section" data-module-name="${escapeHtml(moduleName)}">
              <div class="section-head-row">
                <h5>${escapeHtml(moduleName)}</h5>
                <button class="module-reroll" type="button" data-module-name="${escapeHtml(moduleName)}">重刷</button>
              </div>
              ${renderFieldList(index, fieldNames.map((fieldName) => [fieldName, profile[fieldName] || "—"]))}
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

  function renderBackgrounds() {
    if (!state.backgrounds.length) {
      ui.results.innerHTML = `
        <div class="empty-state">
          <p class="empty-title">人物背景档案还没生成</p>
          <p class="empty-copy">先点上面的“生成背景档案”，这页会给你一组更像真人的背景卡片。</p>
        </div>
      `;
      ui.resultMeta.textContent = "尚未生成";
      dispatchResultsRendered();
      return;
    }
    ui.results.innerHTML = state.backgrounds.map((profile, index) => renderBackgroundCard(profile, index)).join("");
    ui.resultMeta.textContent = `${state.backgrounds.length} 份档案 · 种子 ${ui.seed.value || "自动"} · 字段右侧支持单项或联动重roll`;
    dispatchResultsRendered();
  }

  function generateBatch() {
    const seedValue = ui.seed.value.trim() || makeSeedValue();
    ui.seed.value = seedValue;
    const count = 1;
    const fixed = currentFixedControls();
    const previousFull = state.backgrounds.map((profile) => deepClone(profile));
    state.previousResultsByIndex = Object.fromEntries(previousFull.map((profile, index) => [index, stripMeta(profile)]));

    const targetLength = count;
    const nextBackgrounds = Array.from({ length: targetLength }, (_, index) => createBackgroundAtIndex(seedValue, index, fixed));
    state.lockedIndices.forEach((index) => {
      if (previousFull[index]) nextBackgrounds[index] = deepClone(previousFull[index]);
    });

    state.backgrounds = nextBackgrounds;
    state.activeFetishProfileIndex = selectedIndexWithin(state.backgrounds.length);
    populateFetishProfiles();
    persistWorkspaceBridge();
    renderBackgrounds();
    return state.backgrounds.map(stripMeta);
  }

  function exportJson() {
    if (!state.backgrounds.length) return;
    const payload = state.backgrounds.map(stripMeta);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `人物背景档案_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function normalizeIndex(index) {
    const numeric = Number(index);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
  }

  function setSelectedIndex(index) {
    const nextIndex = 0;
    state.activeFetishProfileIndex = nextIndex;
    populateFetishProfiles();
    persistWorkspaceBridge();
    renderBackgrounds();
    return state.activeFetishProfileIndex;
  }

  function setLockedIndices(indices) {
    state.lockedIndices = new Set((indices || []).some((index) => normalizeIndex(index) === 0) ? [0] : []);
    renderBackgrounds();
  }

  function regenerateSlot(index) {
    const slotIndex = 0;
    if (state.lockedIndices.has(slotIndex)) {
      return { skipped: true, reason: "locked", index: slotIndex };
    }

    const seedValue = ui.seed.value.trim() || makeSeedValue();
    ui.seed.value = seedValue;
    const fixed = currentFixedControls();
    const targetLength = 1;
    const nextBackgrounds = Array.from({ length: targetLength }, (_, currentIndex) => {
      if (currentIndex === slotIndex || !state.backgrounds[currentIndex]) {
        return createBackgroundAtIndex(seedValue, currentIndex, fixed);
      }
      return state.backgrounds[currentIndex];
    });

    updatePreviousSnapshot(slotIndex, stripMeta(state.backgrounds[slotIndex] || null));
    state.backgrounds = nextBackgrounds;
    state.activeFetishProfileIndex = slotIndex;
    populateFetishProfiles();
    persistWorkspaceBridge();
    renderBackgrounds();
    return { skipped: false, index: slotIndex, profile: stripMeta(state.backgrounds[slotIndex]) };
  }

  function registerController() {
    const registry = window.generatorWorkspaceControllers || (window.generatorWorkspaceControllers = {});
    registry.background = {
      getState() {
        return {
          results: state.backgrounds.map((profile) => stripMeta(profile)),
          selectedIndex: state.activeFetishProfileIndex,
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
        return stripMeta(state.backgrounds[0] || null);
      },
    };
  }

  function activatePanel(panelId) {
    ui.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === panelId));
    ui.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${panelId}`));
    if (panelId === "fetish") persistWorkspaceBridge();
  }

  function bindEvents() {
    ui.tabs.forEach((tab) => {
      tab.addEventListener("click", () => activatePanel(tab.dataset.panel));
    });
    ui.generate.addEventListener("click", generateBatch);
    ui.randomSeed.addEventListener("click", () => {
      ui.seed.value = makeSeedValue();
      generateBatch();
    });
    ui.export.addEventListener("click", exportJson);
    ui.results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-reroll-field]");
      if (!button) return;
      rerollBackgroundField(Number(button.dataset.profileIndex), button.dataset.rerollField);
    });
    if (ui.fetishProfileSelect) {
      ui.fetishProfileSelect.addEventListener("change", () => {
        setSelectedIndex(Number(ui.fetishProfileSelect.value) || 0);
      });
    }
    if (ui.fetishApplyBridgeButton) {
      ui.fetishApplyBridgeButton.addEventListener("click", () => {
        persistWorkspaceBridge();
      });
    }
  }

  setupControls();
  renderNotes();
  populateFetishProfiles();
  renderFetishSummary(null);
  registerController();
  bindEvents();
  ui.seed.value = makeSeedValue();
  activatePanel("background");
  generateBatch();
})();
