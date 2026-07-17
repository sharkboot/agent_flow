import { useEffect, useState } from 'react';
import { CliDependencies } from '@/components/CliDependencies';

interface ServerInfo {
  version: string;
  configDir: string;
  supported: string[];
}

export function SettingsPage() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config/info')
      .then((r) => r.json())
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-800 mb-3">服务信息</h2>
          {error && <div className="text-sm text-red-500">{error}</div>}
          {info ? (
            <div className="text-sm space-y-1.5 text-slate-700">
              <div>
                <span className="text-slate-500 w-28 inline-block">版本:</span>
                <span className="mono">{info.version}</span>
              </div>
              <div>
                <span className="text-slate-500 w-28 inline-block">配置目录:</span>
                <span className="mono text-xs">{info.configDir}</span>
              </div>
              <div>
                <span className="text-slate-500 w-28 inline-block">支持的 CLI:</span>
                <span className="mono">{info.supported.join(', ')}</span>
              </div>
            </div>
          ) : (
            !error && <div className="text-sm text-slate-500">加载中...</div>
          )}
        </section>

        <CliDependencies />

        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-800 mb-3">使用说明</h2>
          <div className="text-sm text-slate-600 leading-relaxed space-y-2">
            <p>1. 在 <b>Agents</b> 页面创建一个 Agent,选择 CLI 命令(如 <code className="mono bg-slate-100 px-1 rounded">claude</code>)。</p>
            <p>2. 切换到 <b>对话</b> 页面,选择 Agent 后输入任务。</p>
            <p>3. 后端会通过 <code className="mono bg-slate-100 px-1 rounded">child_process.spawn</code> 调用本地 CLI 并流式返回输出。</p>
            <p>4. 若 CLI 未安装,可创建一个 <code className="mono bg-slate-100 px-1 rounded">echo</code> 类型的 Agent 进行调试。</p>
          </div>
        </section>
      </div>
    </div>
  );
}
