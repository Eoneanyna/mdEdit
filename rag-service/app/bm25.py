"""BM25(Okapi)纯 Python 实现。

k1/b 用经验默认值;语料规模到万级块以内性能完全够用。
"""

import math
from collections import Counter

from .tokenizer import tokenize


class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self.doc_tfs: list[Counter[str]] = []
        self.doc_lens: list[int] = []
        self.df: Counter[str] = Counter()
        self.avg_len = 0.0
        self.n = 0

    def build(self, texts: list[str]) -> None:
        self.doc_tfs = []
        self.doc_lens = []
        self.df = Counter()
        for text in texts:
            tokens = tokenize(text)
            tf = Counter(tokens)
            self.doc_tfs.append(tf)
            self.doc_lens.append(len(tokens))
            for term in tf:
                self.df[term] += 1
        self.n = len(texts)
        self.avg_len = (sum(self.doc_lens) / self.n) if self.n else 0.0

    def _idf(self, term: str) -> float:
        df = self.df.get(term, 0)
        if df == 0:
            return 0.0
        return math.log(1.0 + (self.n - df + 0.5) / (df + 0.5))

    def search(self, query: str) -> list[float]:
        """返回每个文档的 BM25 分数。"""
        scores = [0.0] * self.n
        if self.n == 0:
            return scores
        for term in tokenize(query):
            idf = self._idf(term)
            if idf <= 0.0:
                continue
            for i, tf in enumerate(self.doc_tfs):
                f = tf.get(term, 0)
                if f == 0:
                    continue
                denom = f + self.k1 * (1 - self.b + self.b * self.doc_lens[i] / (self.avg_len or 1))
                scores[i] += idf * f * (self.k1 + 1) / denom
        return scores
