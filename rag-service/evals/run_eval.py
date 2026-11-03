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
import sys
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


def evaluate(base: str, questions: list[dict], mode: str, top_k: int, search_fn=None, workspace=None) -> dict:
    hits = 0
    reciprocal_ranks: list[float] = []
    top1_ok = 0
    misses: list[dict] = []
    positives = 0
    negatives = 0
    empty_negatives = 0

    for item in questions:
        data = search_fn(item['q'], mode, top_k) if search_fn else post(
            base, "/search", {"query": item["q"], "top_k": top_k, "method": mode, "workspace": workspace})
        results = data.get("results", [])
        rels = [r["rel"] for r in results]
        if not item['expect']:
            negatives += 1
            if not results:
                empty_negatives += 1
            else:
                misses.append({'id': item['id'], 'q': item['q'], 'expect': [], 'got': rels[:top_k]})
            continue
        positives += 1
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
        "answerable_retrieval_cases": positives,
        "negative_retrieval_cases": negatives,
        "recall@k": round(hits / positives, 4) if positives else None,
        "mrr": round(sum(reciprocal_ranks) / positives, 4) if positives else None,
        "p@1": round(top1_ok / positives, 4) if positives else None,
        "negative_empty_rate": round(empty_negatives / negatives, 4) if negatives else None,
        "misses": misses,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top-k", type=int)
    ap.add_argument("--base", default="http://127.0.0.1:8765")
    ap.add_argument('--dataset', default='evals/dataset.json', help='相对 rag-service 的评测集路径')
    ap.add_argument("--in-process", action="store_true", help="独立进程内评测，不切换正在使用的服务索引")
    ap.add_argument("--embedder", choices=['auto', 'semantic', 'hash'], default='auto', help="进程内评测嵌入器；semantic 加载失败会直接报错")
    args = ap.parse_args()

    dataset = json.loads((ROOT / args.dataset).read_text("utf-8"))
    questions = dataset["questions"]
    top_k = args.top_k if args.top_k is not None else dataset["meta"].get("top_k", 5)
    if top_k < 1:
        ap.error('--top-k 必须大于零')
    corpus = str(ROOT / dataset["meta"]["corpus"])

    search_fn = None
    if args.in_process:
        sys.path.insert(0, str(ROOT))
        from app.embedding import HashingEmbedder, SentenceTransformerEmbedder, create_embedder, MODEL_NAME
        from app.index_store import SearchIndex
        embedder = HashingEmbedder() if args.embedder == 'hash' else SentenceTransformerEmbedder() if args.embedder == 'semantic' else create_embedder()
        index = SearchIndex()
        index.build(corpus, embedder=embedder)
        health = {'embedder': embedder.name, 'chunks': len(index.chunks), 'workspace': corpus,
                  'model': MODEL_NAME if embedder.name == 'sentence-transformers' else 'hash', 'in_process': True}
        def search_fn(query, mode, k):
            return {'results': [{'rel': hit.chunk.rel} for hit in index.search(query, top_k=k, method=mode)]}
    else:
        idx = post(args.base, "/index", {"workspace": corpus})
        print(f"索引: {idx}")
        health = json.loads(urllib.request.urlopen(args.base + "/health", timeout=120).read().decode("utf-8"))
    print(f"嵌入器={health['embedder']}, 块数={health.get('chunks')}")

    rows = []
    for mode in MODES:
        r = evaluate(args.base, questions, mode, top_k, search_fn=search_fn, workspace=corpus)
        rows.append(r)
        print(f"[{mode:7s}] Recall@{top_k}={r['recall@k']}  MRR={r['mrr']}  P@1={r['p@1']}  NegativeEmpty={r['negative_empty_rate']}")

    print()
    print(f"| 模式 | Recall@{top_k} | MRR | P@1 | 负例空结果率 |")
    print("|---|---|---|---|---|")
    for r in rows:
        values = ['—' if r[key] is None else f'{r[key]:.4f}' for key in ['recall@k', 'mrr', 'p@1', 'negative_empty_rate']]
        print('| ' + r['mode'] + ' | ' + ' | '.join(values) + ' |')

    out = ROOT / "evals" / f"results-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps({"dataset": args.dataset, "health": health, "rows": rows}, ensure_ascii=False, indent=2), "utf-8")
    print(f"\n明细已存: {out}")

    for r in rows:
        if r["misses"]:
            print(f"\n[{r['mode']}] 未命中 {len(r['misses'])} 条:")
            for m in r["misses"]:
                print(f"  #{m['id']} {m['q']} (期望 {m['expect']}, 实际 {m['got'][:3]})")


if __name__ == "__main__":
    main()
