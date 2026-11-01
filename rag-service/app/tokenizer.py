"""中英混合分词:中文取字 bigram,英文/数字取单词。

对检索场景够用且零依赖:bigram 能覆盖绝大多数中文查询命中,
避免引入 jieba 这类额外依赖;后续评测若发现召回不足再升级。
"""

import re
from functools import lru_cache

_WORD_RE = re.compile(r"[a-z0-9_]+")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")


def tokenize(text: str) -> list[str]:
    """返回小写 token 列表。中文按 2-gram 切,单字保留;西文按单词切。"""
    text = text.lower()
    tokens: list[str] = []
    tokens.extend(_WORD_RE.findall(text))
    for run in _CJK_RE.findall(text):
        if len(run) == 1:
            tokens.append(run)
        else:
            tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
            tokens.append(run)  # 整段同文串,利于标题精确匹配
    return tokens


@lru_cache(maxsize=4096)
def tokenize_cached(text: str) -> tuple[str, ...]:
    return tuple(tokenize(text))
