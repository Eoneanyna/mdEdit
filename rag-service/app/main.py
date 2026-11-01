"""mdEdit RAG 服务:FastAPI 入口。

启动(在 rag-service 目录):
    pip install -r requirements.txt
    uvicorn app.main:app --host 127.0.0.1 --port 8765

接口:
    GET  /health  存活与 embedder 信息
    POST /index   {"workspace": "D:/path"}  重建索引(幂等,同工作区直接复用)
    POST /search  {"query": "...", "top_k": 6, "workspace": "D:/path"}
"""

import threading
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .embedding import create_embedder
from .index_store import get_index

app = FastAPI(title="mdEdit RAG", version="0.1.0")

# Electron 主进程用 fetch 调用,不带 Origin;浏览器调试时放开
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_build_lock = threading.Lock()
_embedder = None


class IndexRequest(BaseModel):
    workspace: str


class SearchRequest(BaseModel):
    query: str
    top_k: int = 6
    workspace: Optional[str] = None
    method: str = "hybrid"  # hybrid | bm25 | vector


@app.get("/health")
def health() -> dict:
    idx = get_index()
    return {
        "ok": True,
        "embedder": getattr(idx.embedder, "name", None) if idx.embedder else _embedder_name(),
        "indexed": idx.ready,
        "chunks": len(idx.chunks),
        "workspace": idx.workspace,
    }


def _embedder_name() -> str:
    global _embedder
    if _embedder is None:
        _embedder = create_embedder()
    return getattr(_embedder, "name", "?")


@app.post("/index")
def build_index(req: IndexRequest) -> dict:
    idx = get_index()
    global _embedder
    with _build_lock:
        if idx.ready and idx.workspace == req.workspace:
            return {"ok": True, "cached": True, "chunks": len(idx.chunks)}
        if _embedder is None:
            _embedder = create_embedder()
        idx.build(req.workspace, embedder=_embedder)
        return {"ok": True, "cached": False, "chunks": len(idx.chunks)}


@app.post("/search")
def search(req: SearchRequest) -> dict:
    idx = get_index()
    if not idx.ready:
        return {"ok": False, "error": "尚未建立索引,请先调用 /index", "results": []}
    method = req.method if req.method in ("hybrid", "bm25", "vector") else "hybrid"
    hits = idx.search(req.query, top_k=max(1, min(req.top_k, 20)), method=method)
    return {
        "ok": True,
        "results": [
            {
                "path": h.chunk.path,
                "rel": h.chunk.rel,
                "title": h.chunk.title,
                "snippet": h.snippet,
                "score": h.score,
            }
            for h in hits
        ],
    }
