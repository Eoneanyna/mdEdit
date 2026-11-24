"""嵌入器:两种后端,自动选择。

- SentenceTransformerEmbedder:安装了 sentence-transformers 时启用,真·语义向量
- HashingEmbedder:零依赖兜底,词袋哈希向量(能跑通,语义能力弱)

对上层统一暴露 encode(text)->list[float],维度由 embedder.dim 给出。
"""

import hashlib
import math
import os

import numpy as np

# 国内直连 huggingface.co 常超时,import ST 前设置镜像;已设环境变量则不覆盖
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

MODEL_NAME = "BAAI/bge-small-zh-v1.5"


class HashingEmbedder:
    """feature hashing 词袋向量。同 tokenizer 的 token 直接进哈希桶。"""

    name = "hash"

    def __init__(self, dim: int = 2048) -> None:
        self.dim = dim

    def _vector(self, text: str) -> np.ndarray:
        from .tokenizer import tokenize

        vec = np.zeros(self.dim, dtype=np.float32)
        for tok in tokenize(text):
            h = int(hashlib.blake2b(tok.encode("utf-8"), digest_size=4).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 31) & 1 else -1.0
            vec[idx] += sign
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec /= norm
        return vec

    def encode(self, texts: list[str]) -> np.ndarray:
        return np.stack([self._vector(t) for t in texts])


class SentenceTransformerEmbedder:
    name = "sentence-transformers"

    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer  # 延迟导入

        self.model = SentenceTransformer(MODEL_NAME)
        dim_fn = getattr(self.model, "get_embedding_dimension", None) or self.model.get_sentence_embedding_dimension
        self.dim = dim_fn()

    def encode(self, texts: list[str]) -> np.ndarray:
        # bge 系列检索侧建议加指令前缀,query 侧更稳
        prefixed = ["为这个句子生成表示以用于检索相关文章:" + t for t in texts]
        vecs = self.model.encode(prefixed, normalize_embeddings=True)
        return np.asarray(vecs, dtype=np.float32)


def create_embedder(prefer_semantic: bool = True):
    """默认尝试语义模型,失败则回退哈希向量并打印原因。"""
    if prefer_semantic and os.environ.get('MDEDIT_EMBEDDER') != 'hash':
        try:
            emb = SentenceTransformerEmbedder()
            print(f"[embedding] semantic model {MODEL_NAME} (dim={emb.dim})")
            return emb
        except Exception as e:  # 未安装/下载失败等
            print(f"[embedding] semantic model unavailable ({e.__class__.__name__}: {e}), falling back to hash")
    emb = HashingEmbedder()
    # 进度日志保持 ASCII:冻结程序的 stdout 编码不受调用方控制,中文日志在
    # 非 UTF-8 的 Windows 区域设置下会让 /index 变成 500。
    print(f"[embedding] hash vectors dim={emb.dim} (install sentence-transformers to upgrade)")
    return emb
