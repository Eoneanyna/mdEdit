import tempfile
import unittest
import threading
from pathlib import Path
from unittest.mock import patch

from app import main
from app.embedding import HashingEmbedder
from app.index_store import SearchIndex
from app.ingest import ingest


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.index = SearchIndex()
        self.patch = patch.object(main, "get_index", return_value=self.index)
        self.patch.start()
        self.old_embedder, self.old_fingerprint = main._embedder, main._fingerprint
        main._embedder, main._fingerprint = HashingEmbedder(), None

    def tearDown(self):
        main._embedder, main._fingerprint = self.old_embedder, self.old_fingerprint
        self.patch.stop()
        self.temp.cleanup()

    def test_refresh_add_edit_delete_and_cache(self):
        path = self.root / "项目.MD"
        path.write_text("# 青岚项目\n负责人：林知远", encoding="utf-8")
        req = main.IndexRequest(workspace=str(self.root))
        self.assertFalse(main.build_index(req)["cached"])
        self.assertTrue(main.build_index(req)["cached"])
        path.write_text("# 青岚项目\n负责人：陈小川", encoding="utf-8")
        self.assertFalse(main.build_index(req)["cached"])
        hits = main.search(main.SearchRequest(query="青岚项目负责人", workspace=str(self.root)))
        self.assertIn("陈小川", hits["results"][0]["snippet"])
        (self.root / "流程.txt").write_text("审批流程：主管审批", encoding="utf-8")
        self.assertFalse(main.build_index(req)["cached"])
        path.unlink()
        hits = main.search(main.SearchRequest(query="青岚", workspace=str(self.root), method="bm25"))
        self.assertEqual(hits["results"], [])

    def test_switch_workspace_cannot_return_previous_workspace(self):
        a, b = self.root / "a", self.root / "b"
        a.mkdir(); b.mkdir()
        (a / "a.md").write_text("青岚项目甲方负责人", encoding="utf-8")
        (b / "b.md").write_text("青岚项目乙方负责人", encoding="utf-8")
        main.build_index(main.IndexRequest(workspace=str(a)))
        hits = main.search(main.SearchRequest(query="青岚项目", workspace=str(b)))
        self.assertTrue(all("b.md" == item["rel"] for item in hits["results"]))
        self.assertEqual(self.index.workspace, str(b.resolve()))

    def test_hidden_directories_and_hash_zero_overlap(self):
        (self.root / ".secret").mkdir()
        (self.root / ".secret" / "key.md").write_text("隐藏内容", encoding="utf-8")
        (self.root / "公开.md").write_text("青岚项目负责人", encoding="utf-8")
        self.assertEqual(len(ingest(str(self.root))), 1)
        main.build_index(main.IndexRequest(workspace=str(self.root)))
        self.assertEqual(self.index.search("saturn-unknown-xyz"), [])

    def test_health_is_available_while_embedding_is_blocked(self):
        (self.root / '项目.md').write_text('青岚项目负责人', encoding='utf-8')
        entered, release = threading.Event(), threading.Event()
        class SlowEmbedder(HashingEmbedder):
            def encode(self, texts):
                entered.set()
                if not release.wait(5):
                    raise TimeoutError('test timed out')
                return super().encode(texts)
        main._embedder = SlowEmbedder()
        errors = []
        def build():
            try:
                main.build_index(main.IndexRequest(workspace=str(self.root)))
            except Exception as error:
                errors.append(error)
        worker = threading.Thread(target=build)
        worker.start()
        try:
            self.assertTrue(entered.wait(3))
            status = main.health()
            self.assertTrue(status['building'])
            self.assertEqual(status['phase'], 'embedding')
            self.assertEqual(status['total'], 1)
            self.assertEqual(status['completed'], 0)
        finally:
            release.set()
            worker.join(timeout=5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertFalse(main.health()['building'])
        self.assertEqual(main.health()['completed'], 1)

    def test_source_lines_match_exact_original_excerpt_and_fences(self):
        content = '# 项目\n\n负责人：林知远\n\n## 实施\n\n~~~text\n# 代码中的标题\n~~~\n实施日期待定。\n'
        (self.root / '项目.md').write_bytes(content.replace('\n', '\r\n').encode('utf-8'))
        chunks = ingest(str(self.root))
        self.assertEqual(len(chunks), 2)
        lines = content.splitlines()
        for chunk in chunks:
            self.assertIn(chunk.text, '\n'.join(lines[chunk.start_line - 1:chunk.end_line]))
        self.assertEqual(chunks[0].start_line, 3)
        self.assertNotIn('代码中的标题', chunks[1].title)
        main.build_index(main.IndexRequest(workspace=str(self.root)))
        results = main.search(main.SearchRequest(query='负责人', workspace=str(self.root)))['results']
        self.assertEqual(results[0]['start_line'], 3)

    def test_single_incidental_token_does_not_establish_relevance(self):
        (self.root / '休假.md').write_text('申请产假可以休假三个月。', encoding='utf-8')
        main.build_index(main.IndexRequest(workspace=str(self.root)))
        self.assertEqual(self.index.search('蓝鲸的妊娠周期有几个月'), [])

    def test_negative_evaluation_uses_separate_denominators(self):
        from evals.run_eval import evaluate
        rows = [{'id': 1, 'q': 'positive', 'expect': ['a.md']}, {'id': 2, 'q': 'negative', 'expect': []}]
        report = evaluate('', rows, 'hybrid', 5,
                          search_fn=lambda q, mode, k: {'results': [{'rel': 'a.md'}] if q == 'positive' else []})
        self.assertEqual(report['recall@k'], 1)
        self.assertEqual(report['negative_empty_rate'], 1)


if __name__ == "__main__":
    unittest.main()
