"""检索评测脚本:对比 bm25 / vector / hybrid 三种模式。

用法(服务已启动):
    python evals/run_eval.py [--top-k 5] [--base http://127.0.0.1:8765]

指标:Recall@k(任一期望文档命中即算)、MRR(首个命中的排名倒数)、P@1。
输出 Markdown 对比表,并把明细存到 evals/results-<时间戳>.json。
"""

import argparse
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODES = ["bm25", "vector", "hybrid"]


def post(base: str, path: str, payload: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def evaluate(base: str, questions: list[dict], mode: str, top_k: int) -> dict:
    hits = 0
    reciprocal_ranks: list[float] = []
    top1_ok = 0
    misses: list[dict] = []

    for item in questions:
        data = post(base, "/search", {"query": item["q"], "top_k": top_k, "method": mode})
        results = data.get("results", [])
        rels = [r["rel"] for r in results]
        rank = next(
            (i + 1 for i, rel in enumerate(rels) if any(rel.startswith(e) for e in item["expect"])),
            None,
        )
        if rank is not None:
            hits += 1
            reciprocal_ranks.append(1.0 / rank)
            if rank == 1:
                top1_ok += 1
        else:
            reciprocal_ranks.append(0.0)
            misses.append({"id": item["id"], "q": item["q"], "expect": item["expect"], "got": rels[:top_k]})

    n = len(questions)
    return {
        "mode": mode,
        "n": n,
        "recall@k": round(hits / n, 4) if n else 0.0,
        "mrr": round(sum(reciprocal_ranks) / n, 4) if n else 0.0,
        "p@1": round(top1_ok / n, 4) if n else 0.0,
        "misses": misses,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--base", default="http://127.0.0.1:8765")
    args = ap.parse_args()

    dataset = json.loads((ROOT / "evals" / "dataset.json").read_text("utf-8"))
    questions = dataset["questions"]
    top_k = dataset["meta"].get("top_k", args.top_k)
    corpus = str(ROOT / dataset["meta"]["corpus"])

    health = json.loads(urllib.request.urlopen(args.base + "/health", timeout=120).read().decode("utf-8"))
    print(f"服务 embedder={health['embedder']}")

    idx = post(args.base, "/index", {"workspace": corpus})
    print(f"索引: {idx}")

    rows = []
    for mode in MODES:
        r = evaluate(args.base, questions, mode, top_k)
        rows.append(r)
        print(f"[{mode:7s}] Recall@{top_k}={r['recall@k']:.3f}  MRR={r['mrr']:.3f}  P@1={r['p@1']:.3f}")

    print()
    print(f"| 模式 | Recall@{top_k} | MRR | P@1 |")
    print("|---|---|---|---|")
    for r in rows:
        print(f"| {r['mode']} | {r['recall@k']:.3f} | {r['mrr']:.3f} | {r['p@1']:.3f} |")

    out = ROOT / "evals" / f"results-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps({"health": health, "rows": rows}, ensure_ascii=False, indent=2), "utf-8")
    print(f"\n明细已存: {out}")

    for r in rows:
        if r["misses"]:
            print(f"\n[{r['mode']}] 未命中 {len(r['misses'])} 条:")
            for m in r["misses"]:
                print(f"  #{m['id']} {m['q']} (期望 {m['expect']}, 实际 {m['got'][:3]})")


if __name__ == "__main__":
    main()
