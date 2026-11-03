# mdEdit RAG 服务

mdEdit AI 助手的检索后端:BM25 + 向量混合检索,本地运行,零云端依赖。

## 安装包内置模式

安装包包含独立检索程序，由 Electron 自动启动并在退出时关闭。默认 BM25 + 哈希向量，不依赖系统 Python、不联网下载模型。监听随机本机端口，每次启动生成随机访问令牌；状态面板支持重启。日志位于用户数据目录 `ai/rag-service.log`，不记录问题或文档正文。内存索引随进程退出释放。

开发机运行 `npm run build:rag` 构建同平台同架构的 PyInstaller 目录；安装包命令会先构建它。可用 `MDEDIT_BUILD_PYTHON` 指定解释器；构建环境为独立 `.build-venv`，不打包 torch 或 sentence-transformers。`node scripts/test-rag-bundle.cjs` 在空 PATH 下验证独立运行、令牌及检索。

## 可选语义模式（手动运行）

手动启动服务后，以环境变量 `MDEDIT_RAG_URL=http://127.0.0.1:8765` 启动 mdEdit，即可替代内置服务。外部服务不由应用管理或重启。

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

服务启动后，mdEdit 提问时自动调用它。每次查询会检查文档内容指纹，新增、修改、改名和删除会触发全量重建；未变化时复用内存索引。更新服务代码后请重启原有进程，旧版服务会被客户端识别并降级到内置关键词检索。

支持 `.md`、`.markdown`、`.mdown`、`.mkd`、`.txt`，跳过隐藏目录、常见构建目录、符号链接和超过 2 MB 的文件。首次语义模型加载可能超过客户端 30 秒等待时间，本轮会降级，后续可重试。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /health | 存活检查，返回协议、嵌入器、索引状态、工作区、块数和构建阶段/进度；建索引期间也可读取 |
| POST | /index | `{"workspace": "D:/docs", "force": false}` 检查内容变化后建索引，返回 `protocol: 2`；`force` 可强制重建 |
| POST | /search | `{"query": "...", "top_k": 6, "method": "hybrid"}` 返回 `[{path, rel, title, snippet, score}]` |

`method` 可选 `hybrid`(默认)/ `bm25` / `vector`,用于评测对比。

客户端的 `/search` 请求携带 `workspace`，服务端在同一把锁内核对工作区、刷新索引并查询，防止不同窗口或评测切换工作区后串用旧索引。未传工作区时搜索当前索引，用于兼容评测脚本。

检索结果保留原始 Markdown 片段，附带 `title/start_line/end_line`（行号从 1 开始）。切块忽略代码围栏内的标题标记，兼容 UTF-8 BOM/CRLF；编辑器根据片段、标题和行号定位，旧文档变化不会被默认为精确匹配。

`/health` 的 `building/phase/completed/total/error` 用于状态展示。向量按 64 个块分批构建并上报进度；指纹检查、模型加载和文档扫描阶段没有伪造的百分比。新索引构建完成后才替换旧索引。

默认服务地址为 `http://127.0.0.1:8765`，Electron 主进程可通过环境变量 `MDEDIT_RAG_URL` 指定其他地址。设置 `MDEDIT_EMBEDDER=hash` 可在测试时跳过语义模型加载。仅监听本机回环地址，不要暴露到公网。

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

也可独立进程内评测，不触碰正在使用的服务索引：

```bash
.venv/Scripts/python evals/run_eval.py --in-process --embedder semantic
```

`semantic` 模式要求语义模型可用，加载失败直接报错，不会静默降级污染实验结果。`--embedder hash` 可测试无模型环境；`--top-k` 可覆盖数据集默认值。

无关问题检索评测：

```bash
.venv/Scripts/python evals/run_eval.py --in-process --embedder semantic --dataset evals/negative-dataset.json
```

该集 12 题，`expect: []` 表示期望检索为空，单独报告 `negative_empty_rate`，不混入正例 Recall/MRR 分母。这是检索误召回指标，不等价于最终答案拒答率。答案级 6 项合成边界用例在 `evals/grounding-cases.json`，根目录 `scripts/ai-grounding-eval.cjs --offline` 验证零资料拒答；不带参数时从标准输入读取 OpenRouter Key 做真实答案规则检查，并保留答案供人工核验。

输出 bm25 / vector / hybrid 三模式对比表(Recall@k、MRR、P@1),明细落 `evals/results-*.json`。
语料在 `evals/corpus/`,数据集在 `evals/dataset.json`。

## 后续路线

- Agent 化:LangGraph 编排 `search_docs / web_search / read_file` 工具
- 引用忠实度:LLM-as-judge 自动评估回答与引用的一致性
- 查询日志落 SQLite,SQL 分析零召回查询,反哺检索调参
