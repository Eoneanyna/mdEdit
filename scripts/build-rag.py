"""构建无需系统 Python 的轻量检索服务（在目标 OS/架构上运行）。"""
import json
import platform
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / 'rag-service' / '.build-venv'
PYTHON = ENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
if not PYTHON.exists():
    venv.EnvBuilder(with_pip=True).create(ENV)
subprocess.run([str(PYTHON), '-m', 'pip', 'install', '-r', str(ROOT / 'rag-service/requirements-build.txt')], check=True)
subprocess.run([
    str(PYTHON), '-m', 'PyInstaller', '--noconfirm', '--onedir', '--name', 'mdedit-rag',
    '--distpath', str(ROOT / 'build/rag-service'), '--workpath', str(ROOT / 'build/rag-work'),
    '--specpath', str(ROOT / 'build/rag-work'), '--paths', str(ROOT / 'rag-service'),
    '--collect-all', 'numpy', '--exclude-module', 'torch', '--exclude-module', 'sentence_transformers',
    str(ROOT / 'rag-service/entrypoint.py')
], check=True)
manifest = ROOT / 'build/rag-service/mdedit-rag/manifest.json'
manifest.write_text(json.dumps({'platform': sys.platform, 'machine': platform.machine(), 'mode': 'bm25-hash', 'protocol': 2}), encoding='utf-8')
print(str(manifest.parent))
