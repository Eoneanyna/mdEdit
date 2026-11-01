# mdEdit RAG 服务

mdEdit AI 助手的检索后端:BM25 + 向量混合检索,本地运行,零云端依赖。

## 快速开始(venv,推荐)

> Microsoft Store 版 Python 装 torch 会触发 WinError 206(路径过长),项目内 venv 可规避。

```bash
cd rag-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
# 语义模式(推荐):先装 CPU 版 torch,再装 ST
.venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/pip install sentence-transformers -i https://pypi.tuna.tsinghua.edu.cn/simple
# HuggingFace 直连不通时,下载模型走镜像
set HF_ENDPOINT=https://hf-mirror.com
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

服务启动后,mdEdit 打开工作区提问时自动调用它;检索失败时编辑器自动回退内置关键词搜索,功能不受影响。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /health | 存活检查,返回 embedder/索引状态 |
| POST | /index | `{"workspace": "D:/docs"}` 建索引(同工作区幂等复用) |
| POST | /search | `{"query": "...", "top_k": 6, "method": "hybrid"}` 返回 `[{path, rel, title, snippet, score}]` |

`method` 可选 `hybrid`(默认)/ `bm25` / `vector`,用于评测对比。

## 嵌入器策略

- 装了 `sentence-transformers` → 自动使用 `BAAI/bge-small-zh-v1.5` 语义向量(首次运行下载约 100MB)
- 没装 → 词袋哈希向量兜底,全流程可跑通

## 检索流程

```
.md 文件 → 按标题切块(滑窗 1000 字/重叠 150)
        → BM25 索引 + 向量索引
查询   → BM25 分数(归一) ×0.5 + 余弦相似度(归一) ×0.5
        → top_k → 摘录窗口取与查询词重叠最多处
```

## 评测

48 条人工标注 QA(含 10 条零词面重叠改写题,专测语义能力):

```bash
.venv/Scripts/python evals/run_eval.py
```

输出 bm25 / vector / hybrid 三模式对比表(Recall@k、MRR、P@1),明细落 `evals/results-*.json`。
语料在 `evals/corpus/`,数据集在 `evals/dataset.json`。

## 后续路线

- Agent 化:LangGraph 编排 `search_docs / web_search / read_file` 工具
- 引用忠实度:LLM-as-judge 自动评估回答与引用的一致性
- 查询日志落 SQLite,SQL 分析零召回查询,反哺检索调参
