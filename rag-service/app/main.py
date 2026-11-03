"""本地检索接口：按文件内容指纹刷新索引，工作区切换与检索在同一锁内完成。"""
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .embedding import create_embedder
from .index_store import get_index
from .ingest import workspace_fingerprint

app = FastAPI(title="mdEdit RAG", version="0.2.0")
_build_lock = threading.RLock()
_embedder = None
_fingerprint = None


class IndexRequest(BaseModel):
    workspace: str
    force: bool = False


class SearchRequest(BaseModel):
    query: str
    top_k: int = 6
    workspace: Optional[str] = None
    method: str = "hybrid"


def ensure_index(workspace: str, force: bool = False) -> dict:
    """调用方持锁；新增、删除、改名、内容修改均导致重建。"""
    global _embedder, _fingerprint
    root = Path(workspace).resolve()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail="工作区目录不存在")
    workspace = str(root)
    fingerprint = workspace_fingerprint(workspace)
    idx = get_index()
    if not force and idx.workspace == workspace and _fingerprint == fingerprint:
        return {"ok": True, "cached": True, "chunks": len(idx.chunks), "protocol": 2}
    if _embedder is None:
        _embedder = create_embedder()
    _fingerprint = None
    idx.build(workspace, embedder=_embedder)
    _fingerprint = fingerprint
    return {"ok": True, "cached": False, "chunks": len(idx.chunks), "protocol": 2}


@app.get("/health")
def health() -> dict:
    with _build_lock:
        idx = get_index()
        return {
            "ok": True,
            "embedder": getattr(idx.embedder, "name", None),
            "indexed": idx.ready,
            "chunks": len(idx.chunks),
            "workspace": idx.workspace,
        }


@app.post("/index")
def build_index(req: IndexRequest) -> dict:
    with _build_lock:
        return ensure_index(req.workspace, req.force)


@app.post("/search")
def search(req: SearchRequest) -> dict:
    with _build_lock:
        if req.workspace:
            ensure_index(req.workspace)
        idx = get_index()
        if not idx.ready:
            return {"ok": True, "results": []}
        method = req.method if req.method in ("hybrid", "bm25", "vector") else "hybrid"
        hits = idx.search(req.query, top_k=max(1, min(req.top_k, 20)), method=method)
        return {
            "ok": True,
            "results": [
                {"path": h.chunk.path, "rel": h.chunk.rel, "title": h.chunk.title,
                 "snippet": h.snippet, "score": h.score}
                for h in hits
            ],
        }
