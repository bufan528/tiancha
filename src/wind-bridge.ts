import { execFile } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./store.js";

/**
 * 调用 tools/wind_query.py（入参 JSON 字符串，出参 JSON）。
 * WindPy 不可用时脚本内置 mock，永不抛错；这里也兜底。
 */
export function windQuery(payload: Record<string, unknown>): Promise<Record<string, any>> {
  const py = process.env.WIND_PYTHON ?? "python";
  const script = join(ROOT, "tools", "wind_query.py");
  return new Promise((resolve) => {
    execFile(py, [script, JSON.stringify(payload)], { timeout: 30_000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({
          source: "mock-bridge",
          industry: String(payload.industry ?? ""),
          note: "WindPy 不可用，桥接降级为内置 mock 数据",
          marketSize: "约 800 亿元（mock）",
          cagr: "约 22%（mock）",
          listedCompanies: 47,
          pe: 32.5,
          leaders: ["头部玩家A", "头部玩家B", "头部玩家C"],
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ source: "parse-error", raw: stdout.slice(0, 500) });
      }
    });
  });
}
