"""索引存储与混合检索:BM25 + 向量,分数归一后加权融合。"""

import re
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .bm25 import BM25Index
from .embedding import create_embedder
from .ingest import Chunk, ingest

BM25_WEIGHT = 0.5
VEC_WEIGHT = 0.5

_QUERY_STOP = re.compile(r"\s+")


@dataclass
class SearchHit:
    chunk: Chunk
    score: float
    snippet: str


def make_snippet(text: str, query: str, width: int = 200) -> str:
    """在块内找一个与查询词重叠最多的窗口作为摘录。"""
    from .tokenizer import tokenize

    clean = _QUERY_STOP.sub(" ", text.replace("\n", " "))
    if len(clean) <= width + 20:
        return clean.strip()
    q_tokens = set(tokenize(query))
    best_idx, best_overlap = 0, -1
    step = max(width // 2, 40)
    for i in range(0, max(len(clean) - width, 1), step):
        window_tokens = set(tokenize(clean[i : i + width]))
        overlap = len(q_tokens & window_tokens)
        if overlap > best_overlap:
            best_overlap, best_idx = overlap, i
    snippet = clean[best_idx : best_idx + width].strip()
    prefix = "... " if best_idx > 0 else ""
    suffix = " ..." if best_idx + width < len(clean) else ""
    return prefix + snippet + suffix


class SearchIndex:
    def __init__(self) -> None:
        self.workspace: str = ""
        self.built_at: float = 0.0
        self.chunks: list[Chunk] = []
        self.bm25 = BM25Index()
        self.vectors: Optional[np.ndarray] = None
        self.embedder = None

    @property
    def ready(self) -> bool:
        return bool(self.chunks)

    def build(self, workspace: str, embedder=None) -> None:
        t0 = time.time()
        self.embedder = embedder or self.embedder or create_embedder()
        self.chunks = ingest(workspace)
        self.workspace = workspace
        if not self.chunks:
            self.vectors = None
            self.bm25 = BM25Index()
            self.built_at = time.time()
            return
        texts = [f"{c.title}\n{c.text}" for c in self.chunks]
        self.bm25 = BM25Index()
        self.bm25.build(texts)
        self.vectors = self.embedder.encode(texts)
        self.built_at = time.time()
        print(
            f"[index] 完成: {len(self.chunks)} 块, "
            f"embedder={getattr(self.embedder, 'name', '?')}, "
            f"耗时 {time.time() - t0:.1f}s"
        )

    def search(self, query: str, top_k: int = 6, method: str = "hybrid") -> list[SearchHit]:
        """method: hybrid | bm25 | vector"""
        if not self.ready:
            return []
        bm25_scores = np.asarray(self.bm25.search(query), dtype=np.float32)
        bm25_max = float(bm25_scores.max()) if bm25_scores.size else 0.0
        bm25_norm = bm25_scores / bm25_max if bm25_max > 0 else bm25_scores

        if self.vectors is not None and self.embedder is not None:
            qv = self.embedder.encode([query])
            cos = (self.vectors @ qv[0].T).astype(np.float32).reshape(-1)
            vec_norm = np.clip((cos + 1.0) / 2.0, 0.0, 1.0)
        else:
            vec_norm = np.zeros_like(bm25_norm)

        if method == "bm25":
            fused = bm25_norm
        elif method == "vector":
            fused = vec_norm
        else:
            fused = BM25_WEIGHT * bm25_norm + VEC_WEIGHT * vec_norm
        order = np.argsort(-fused)[:top_k]
        hits: list[SearchHit] = []
        for i in order:
            s = float(fused[i])
            # 余弦映射到 [0,1] 后，完全不相似也有 0.5；不能仅凭融合分数判定相关。
            lexical = float(bm25_scores[i]) > 0
            semantic = self.embedder is not None and getattr(self.embedder, 'name', '') != 'hash' and float(vec_norm[i]) >= 0.675
            relevant = lexical if method == 'bm25' else semantic or (lexical and method != 'vector')
            if method == 'vector' and getattr(self.embedder, 'name', '') == 'hash':
                relevant = lexical
            if s <= 0.0 or not relevant:
                continue
            c = self.chunks[int(i)]
            hits.append(SearchHit(chunk=c, score=round(s, 4), snippet=make_snippet(c.text, query, width=1000)))
        return hits


_shared: Optional[SearchIndex] = None


def get_index() -> SearchIndex:
    global _shared
    if _shared is None:
        _shared = SearchIndex()
    return _shared
