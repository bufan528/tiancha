#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
wind_query.py — Wind 数据桥接 CLI。

入参：sys.argv[1] 为 JSON 字符串，例如 {"industry": "人形机器人"}
出参：stdout 打印一行 JSON。

行为：
  - 若环境可用 WindPy，尝试取真实行业指标；
  - 任何失败（无 WindPy / 无终端 / 超时）一律降级为内置确定性 mock，进程永不崩溃、永不抛非零业务错误。
"""
import sys
import json


MOCK = {
    "人形机器人": {
        "marketSize": "约 1200 亿元",
        "cagr": "约 45%",
        "listedCompanies": 63,
        "pe": 55.2,
        "leaders": ["优必选", "宇树科技", "智元机器人"],
    },
    "固态电池": {
        "marketSize": "约 200 亿元",
        "cagr": "约 30%",
        "listedCompanies": 38,
        "pe": 41.0,
        "leaders": ["宁德时代", "卫蓝新能源", "清陶能源"],
    },
}


def real_wind(industry: str) -> dict | None:
    """尝试真实 WindPy。失败返回 None，由调用方降级。"""
    try:
        from WindPy import w  # type: ignore
    except Exception:
        return None
    try:
        if not w.isconnected() and not w.start():
            return None
        # 真实取数字段按业务需要扩展；此处仅演示连通后返回骨架。
        return {
            "source": "wind",
            "industry": industry,
            "note": "WindPy 已连接（演示骨架字段）",
        }
    except Exception:
        return None


def main() -> None:
    try:
        payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    except Exception:
        payload = {}
    industry = str(payload.get("industry", ""))

    result = real_wind(industry)
    if result is None:
        mock = MOCK.get(industry, {
            "marketSize": "约 800 亿元",
            "cagr": "约 22%",
            "listedCompanies": 47,
            "pe": 32.5,
            "leaders": ["头部玩家A", "头部玩家B", "头部玩家C"],
        })
        result = {"source": "mock", "industry": industry, **mock}

    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
