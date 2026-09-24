/**
 * ChainTemplate (Phase B v1) — a VERSIONED, human-overridable template that turns the
 * methodology's `industry_chain` dimension into concrete INFORMATION POSITIONS.
 *
 * Contract (docs/phaseB/implementation-contract.md §2.2):
 *  - identity = `(templateId, version)`; re-registering the SAME pair with DIFFERENT
 *    content MUST throw (the PolicyRegistry discipline) — a template never silently
 *    changes meaning;
 *  - a template is **NOT** a claim about the industry's real supply chain. It says:
 *    "this is where the CURRENT methodology says we should get information from".
 */

export interface ChainTemplatePosition {
  /** Stable key within the template, e.g. `downstream_head_customer`. */
  key: string;
  /** Open enum: upstream / downstream / customer / supplier / channel / trader /
   *  competitor / consulting_institution / research_institution / expert /
   *  association / government / ... */
  kind: string;
  /** Industry-facing name, e.g. 「下游头部客户」. */
  label: string;
  /** Why this position matters — REQUIRED (I-B1: no empty nodes). */
  whyImportant: string;
  /** Research dimensions this position mainly serves (maps to Requirement.dimension). */
  dimensionKeys: string[];
  /** 「建议研究哪类对象」— TYPE level only; never a concrete subject name. */
  suggestedTargetKinds: string[];
  /** What kinds of evidence this position can provide (feeds Fit / Outline later). */
  suitableEvidenceKinds: string[];
  /** Inherent limitations of this position (feeds Fit downgrade later). */
  limitations: string[];
}

export interface ChainTemplate {
  templateId: string;
  version: string;
  /** Reserved: restrict to industry types (empty = general). */
  appliesTo?: string[];
  positions: ChainTemplatePosition[];
}

/** Immutable, version-keyed registry (same guarantees as PolicyRegistry). */
export class ChainTemplateRegistry {
  private readonly byKey = new Map<string, ChainTemplate>();

  static key(templateId: string, version: string): string {
    return `${templateId}@${version}`;
  }

  /** Idempotent for identical content; THROWS if the same version changes meaning. */
  register(template: ChainTemplate): void {
    const key = ChainTemplateRegistry.key(template.templateId, template.version);
    const existing = this.byKey.get(key);
    if (existing && stableKey(existing) !== stableKey(template)) {
      throw new Error(
        `chain template '${key}' is immutable: re-registering it with different content is ` +
          "forbidden — publish a new version instead",
      );
    }
    this.byKey.set(key, template);
  }

  get(templateId: string, version: string): ChainTemplate | undefined {
    return this.byKey.get(ChainTemplateRegistry.key(templateId, version));
  }

  list(): ChainTemplate[] {
    return [...this.byKey.values()];
  }
}

/** Deterministic serialisation (keys sorted); templates contain no functions. */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(obj[k])}`)
    .join(",")}}`;
}

export const chainTemplates = new ChainTemplateRegistry();

/**
 * v1 general template. Its positions' `dimensionKeys` cover all 12 research dimensions,
 * so every requirement can be served by at least one position.
 */
export const CHAIN_TEMPLATE_GENERAL_V1: ChainTemplate = {
  templateId: "chain-template-general",
  version: "v1",
  positions: [
    {
      key: "downstream_head_customer",
      kind: "customer",
      label: "下游头部客户",
      whyImportant: "需求是否真实、可持续，只有真实客户能回答",
      dimensionKeys: ["market", "demand", "business_model", "profitability"],
      suggestedTargetKinds: ["头部客户", "标杆客户", "大客户"],
      suitableEvidenceKinds: ["采购意愿", "复购与续约", "客单价", "真实订单"],
      limitations: ["只代表自身视角", "可能不愿披露价格与规模"],
    },
    {
      key: "upstream_supplier",
      kind: "supplier",
      label: "上游核心供应商",
      whyImportant: "供给约束、良率与成本曲线在上游最清楚",
      dimensionKeys: ["supply", "industry_chain", "technology", "profitability"],
      suggestedTargetKinds: ["核心零部件供应商", "关键材料供应商"],
      suitableEvidenceKinds: ["产能与良率", "BOM 与成本曲线", "交付周期"],
      limitations: ["与主机厂利益绑定，口径可能偏乐观"],
    },
    {
      key: "industry_expert",
      kind: "expert",
      label: "行业专家",
      whyImportant: "跨企业的技术、风险与关键假设判断，需要独立专家视角",
      dimensionKeys: ["technology", "market_growth", "policy", "risk", "key_validation"],
      suggestedTargetKinds: ["行业专家", "技术专家", "资深从业者"],
      suitableEvidenceKinds: ["技术路线判断", "风险识别", "关键假设的可行性"],
      limitations: ["个人经验有偏差", "可能同时服务多家企业"],
    },
    {
      key: "competitor_peer",
      kind: "competitor",
      label: "同业竞争厂商",
      whyImportant: "竞争格局、份额与壁垒需要同业交叉验证",
      dimensionKeys: ["competition", "business_model", "profitability"],
      suggestedTargetKinds: ["同业公司", "竞争厂商", "新进入者"],
      suitableEvidenceKinds: ["份额与集中度", "定价策略", "壁垒与进入门槛"],
      limitations: ["竞争关系导致信息保留", "披露口径不一致"],
    },
    {
      key: "consulting_research",
      kind: "consulting_institution",
      label: "咨询/研究机构",
      whyImportant: "规模口径、增速与政策解读需要第三方结构化研究支撑",
      dimensionKeys: ["market", "market_growth", "policy", "risk"],
      suggestedTargetKinds: ["咨询机构", "行业研究机构", "券商研究所"],
      suitableEvidenceKinds: ["市场规模口径", "增速预测", "政策梳理与解读"],
      limitations: ["报告可能为通用框架", "口径与更新时点需核对"],
    },
    {
      key: "channel_trader",
      kind: "trader",
      label: "渠道/贸易环节",
      whyImportant: "真实走货与库存能反映需求与价格传导",
      dimensionKeys: ["demand", "industry_chain", "business_model"],
      suggestedTargetKinds: ["渠道商", "贸易商", "经销商"],
      suitableEvidenceKinds: ["走货量", "库存与周转", "价格传导"],
      limitations: ["可能存在囤货与冲量行为"],
    },
  ],
};

chainTemplates.register(CHAIN_TEMPLATE_GENERAL_V1);
