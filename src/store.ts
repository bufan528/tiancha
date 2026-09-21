import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
export const DATA_DIR = join(ROOT, "data");
export const POOL_DIR = join(DATA_DIR, "pool");
export const INBOX_DIR = join(DATA_DIR, "inbox");
export const ARCHIVE_DIR = join(DATA_DIR, "archive");

function ensureDirs() {
  for (const d of [DATA_DIR, POOL_DIR, INBOX_DIR, ARCHIVE_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

type Json = Record<string, any>;

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  ensureDirs();
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/* ---------------- files ---------------- */
const industriesFile = () => join(POOL_DIR, "industries.json");
const profilesFile = () => join(DATA_DIR, "profiles.json");
const materialsFile = () => join(DATA_DIR, "materials.json");
const researchFile = () => join(DATA_DIR, "research.json");
const plansFile = () => join(DATA_DIR, "plans.json");

/* ---------------- seed ---------------- */
const SEED_INDUSTRIES: Json[] = [
  {
    name: "人形机器人",
    status: "reserve",
    grade: "A",
    score: 84,
    updatedAt: "2026-09-18",
    scores: [
      { dimension: "market_growth", score: 9, reason: "TAM 千亿级、CAGR>40%", at: "2026-09-18" },
      { dimension: "policy_env", score: 8, reason: "国家智能制造战略鼓励", at: "2026-09-18" },
      { dimension: "competition", score: 7, reason: "格局未定、国产链初现", at: "2026-09-18" },
      { dimension: "tech_maturity", score: 8, reason: "整机路线确定、持续迭代", at: "2026-09-18" },
      { dimension: "commercialization", score: 7, reason: "标杆客户落地、未规模放量", at: "2026-09-18" },
      { dimension: "exit_env", score: 8, reason: "科创板/港股通道明确", at: "2026-09-18" },
      { dimension: "risk_level", score: 7, reason: "主要风险可控", at: "2026-09-18" },
    ],
    tags: ["硬件", "AI", "自动化"],
    note: "种子行业，待新研报触发重打分",
  },
  {
    name: "固态电池",
    status: "watch",
    grade: "C",
    score: 58,
    updatedAt: "2026-09-10",
    scores: [],
    tags: ["新能源", "材料"],
    note: "观察中，等待量产爬坡证据",
  },
];

export function ensureSeed() {
  ensureDirs();
  if (!existsSync(industriesFile())) writeJson(industriesFile(), SEED_INDUSTRIES);
  if (!existsSync(profilesFile())) writeJson(profilesFile(), {});
  if (!existsSync(materialsFile())) writeJson(materialsFile(), { items: [] });
  if (!existsSync(researchFile())) writeJson(researchFile(), { reports: [] });
  if (!existsSync(plansFile())) writeJson(plansFile(), { plans: [] });
}

/* ---------------- industries / pool ---------------- */
export function listPool(status?: string): Json[] {
  const all = readJson<Json[]>(industriesFile(), []);
  if (status) return all.filter((i) => i.status === status);
  return all;
}

export function getIndustry(name: string): Json | undefined {
  const all = readJson<Json[]>(industriesFile(), []);
  return all.find((i) => i.name === name);
}

export function upsertIndustry(ind: Json): Json {
  const all = readJson<Json[]>(industriesFile(), []);
  const idx = all.findIndex((i) => i.name === ind.name);
  if (idx >= 0) all[idx] = { ...all[idx], ...ind };
  else all.push(ind);
  writeJson(industriesFile(), all);
  return ind;
}

/* ---------------- profiles ---------------- */
export function readProfile(industry: string): { md: string; history: Json[] } | undefined {
  const all = readJson<Record<string, { md: string; history: Json[] }>>(profilesFile(), {});
  return all[industry];
}

export function writeProfile(industry: string, md: string): void {
  const all = readJson<Record<string, { md: string; history: Json[] }>>(profilesFile(), {});
  const prev = all[industry];
  const history = prev?.history ?? [];
  history.push({ at: new Date().toISOString(), bytes: md.length });
  all[industry] = { md, history };
  writeJson(profilesFile(), all);
}

/* ---------------- materials ---------------- */
export function listMaterials(): Json[] {
  const wrap = readJson<{ items: Json[] }>(materialsFile(), { items: [] });
  return wrap.items;
}

export function addMaterial(m: Json): Json {
  const wrap = readJson<{ items: Json[] }>(materialsFile(), { items: [] });
  const item = { id: `m_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, ingestedAt: new Date().toISOString(), ...m };
  wrap.items.unshift(item);
  writeJson(materialsFile(), wrap);
  return item;
}

/* ---------------- research ---------------- */
export function listResearch(): Json[] {
  const wrap = readJson<{ reports: Json[] }>(researchFile(), { reports: [] });
  return wrap.reports;
}

export function addReport(r: Json): Json {
  const wrap = readJson<{ reports: Json[] }>(researchFile(), { reports: [] });
  const item = { id: `r_${Date.now()}`, createdAt: new Date().toISOString(), ...r };
  wrap.reports.unshift(item);
  writeJson(researchFile(), wrap);
  return item;
}

/* ---------------- plans ---------------- */
export function listPlans(): Json[] {
  const wrap = readJson<{ plans: Json[] }>(plansFile(), { plans: [] });
  return wrap.plans;
}

export function addPlan(p: Json): Json {
  const wrap = readJson<{ plans: Json[] }>(plansFile(), { plans: [] });
  const item = { id: `p_${Date.now()}`, createdAt: new Date().toISOString(), ...p };
  wrap.plans.unshift(item);
  writeJson(plansFile(), wrap);
  return item;
}

/* ---------------- keyword search over pool + materials ---------------- */
export function memorySearch(query: string, limit = 5): Json[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { score: number; kind: string; ref: Json }[] = [];
  for (const ind of listPool()) {
    const text = `${ind.name} ${(ind.tags ?? []).join(" ")} ${ind.note ?? ""}`.toLowerCase();
    const hit = text.includes(q) ? 2 : 0;
    if (hit) out.push({ score: hit, kind: "industry", ref: ind });
  }
  for (const m of listMaterials()) {
    const text = `${m.title ?? ""} ${m.content ?? ""}`.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const w of words) if (text.includes(w)) score += 1;
    if (score) out.push({ score, kind: "material", ref: m });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((o) => o.ref);
}

export function scoringConfig(): Json {
  return readJson(join(ROOT, "config", "scoring.json"), {});
}
