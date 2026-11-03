"""冻结应用入口；仅监听回环地址，不联网下载模型。"""
import argparse
import os
import multiprocessing

def main():
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
