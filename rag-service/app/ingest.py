"""文档摄取:扫描工作区 .md,按标题切块,长节做滑窗。"""

import re
import os
import hashlib
from dataclasses import dataclass
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", "dist", "out", "release", ".venv", "__pycache__"}
EXTENSIONS = {".md", ".markdown", ".mdown", ".mkd", ".txt"}


def document_paths(workspace: str) -> list[Path]:
    root = Path(workspace).resolve()
    paths = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')
                   and not (Path(directory) / d).is_symlink()]
        for name in files:
            path = Path(directory) / name
            if name.startswith('.') or path.suffix.lower() not in EXTENSIONS or path.is_symlink():
                continue
            try:
                if path.stat().st_size <= 2_000_000:
                    paths.append(path)
            except OSError:
                continue
    return sorted(paths)


def workspace_fingerprint(workspace: str) -> str:
    digest = hashlib.sha256()
    root = Path(workspace).resolve()
    for path in document_paths(workspace):
        try:
            digest.update(path.relative_to(root).as_posix().encode('utf-8'))
            digest.update(b'\x00')
            digest.update(hashlib.sha256(path.read_bytes()).digest())
        except OSError:
            continue
    return digest.hexdigest()

_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.*)$", re.MULTILINE)

MAX_CHARS = 1000  # 单块上限
OVERLAP = 150  # 滑窗重叠


@dataclass
class Chunk:
    id: int
    path: str
    rel: str
    title: str  # 形如 "文件标题 > 小节标题"
    text: str
    start_line: int = 1
    end_line: int = 1


def read_text(path: Path) -> str:
    """中文 Windows 下 md 文件绝大多数是 UTF-8;GBK 兜底,再不行忽略坏字节。"""
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def section_spans(text: str, file_title: str) -> list[tuple[str, str, int]]:
    """保留正文在原文中的偏移；代码围栏内的 # 不作为标题。"""
    masked, fence = [], None
    for line in text.splitlines(keepends=True):
        marker = re.match(r'^\s{0,3}(`{3,}|~{3,})', line)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            masked.append(re.sub(r'[^\n]', ' ', line))
        else:
            masked.append(re.sub(r'[^\n]', ' ', line) if fence else line)
    matches = list(_HEADING_RE.finditer(''.join(masked)))
    sections: list[tuple[str, str, int]] = []
    heading_stack: list[str] = []

    def push_title_chain(level: int, title: str) -> str:
        # 维护标题层级栈,得到 "A > B > C" 形式的链
        del heading_stack[level:]
        while len(heading_stack) < level:
            heading_stack.append("")
        heading_stack[level - 1] = title
        chain = " > ".join([file_title] + [h for h in heading_stack if h])
        return chain

    if not matches:
        return [(file_title, text.strip(), len(text) - len(text.lstrip()))] if text.strip() else []

    preamble = text[: matches[0].start()].strip()
    if preamble:
        sections.append((file_title, preamble, len(text[:matches[0].start()]) - len(text[:matches[0].start()].lstrip())))

    for i, m in enumerate(matches):
        level = len(m.group(1))
        title = m.group(2).strip()
        chain = push_title_chain(level, title)
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        raw = text[m.end() : end]
        body = raw.strip()
        if body:
            sections.append((chain, body, m.end() + len(raw) - len(raw.lstrip())))
    return sections


def split_sections(text: str, file_title: str) -> list[tuple[str, str]]:
    return [(chain, body) for chain, body, _ in section_spans(text, file_title)]


def window(text: str) -> list[str]:
    """长节切滑窗。短节原样返回。"""
    if len(text) <= MAX_CHARS:
        return [text]
    out = []
    step = MAX_CHARS - OVERLAP
    for i in range(0, len(text), step):
        piece = text[i : i + MAX_CHARS]
        if len(piece.strip()) < 40 and out:
            break
        out.append(piece)
        if i + MAX_CHARS >= len(text):
            break
    return out


def file_title_of(path: Path) -> str:
    return path.stem


def ingest(workspace: str) -> list[Chunk]:
    root = Path(workspace).resolve()
    chunks: list[Chunk] = []
    if not root.is_dir():
        return chunks
    for path in document_paths(workspace):
        rel_parts = path.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        try:
            text = read_text(path).replace('\r\n', '\n').replace('\r', '\n')
        except OSError:
            continue
        ft = file_title_of(path)
        for chain, body, body_start in section_spans(text, ft):
            for index, piece in enumerate(window(body)):
                offset = body_start + index * (MAX_CHARS - OVERLAP)
                chunks.append(
                    Chunk(
                        id=len(chunks),
                        path=str(path),
                        rel=path.relative_to(root).as_posix(),
                        title=chain,
                        text=piece,
                        start_line=text.count('\n', 0, offset) + 1,
                        end_line=text.count('\n', 0, offset + max(0, len(piece) - 1)) + 1,
                    )
                )
    return chunks
