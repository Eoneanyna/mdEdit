"""冻结应用入口；仅监听回环地址，不联网下载模型。"""
import argparse
import os
import multiprocessing
import sys


def force_utf8_streams():
    """冻结程序在英文 Windows 下默认用 cp1252 写 stdout/stderr。

    建索引时服务会输出中文进度日志，写入管道会抛 UnicodeEncodeError，
    表现为 /index 返回 500(健康检查与鉴权都不触发这些输出，所以只有 POST 挂)。
    PyInstaller 会固定 stdio 编码，PYTHONUTF8/PYTHONIOENCODING 传入也未必生效，
    因此在进程内部显式重配，并用 replace 兜住任何不可编码字符。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, OSError, ValueError):
            pass


def main():
    force_utf8_streams()
    os.environ['MDEDIT_EMBEDDER'] = 'hash'
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    import uvicorn
    from app.main import app
    uvicorn.run(app, host='127.0.0.1', port=args.port, log_config=None, access_log=False)

if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
