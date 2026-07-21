import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileDown,
  FileSpreadsheet,
  Fingerprint,
  Gauge,
  History,
  LayoutDashboard,
  LibraryBig,
  LoaderCircle,
  LockKeyhole,
  PanelLeftClose,
  Play,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';
import type {
  CandidateProposal,
  Portfolio,
  PortfolioImport,
  PortfolioVersion,
  ReportRecord,
  ScenarioRun,
  VersionComparison,
} from '../../../backend/artscape-node/src/types';
import {
  acceptCandidate,
  calculateScenario,
  checkHealth,
  confirmImport,
  createReport,
  downloadArtifact,
  generateCandidate,
  getAudit,
  getEvents,
  getScenario,
  getServiceStatus,
  importPortfolio,
} from './api';
import { dateTime, money, percent, shortId } from './format';

type View = 'home' | 'import' | 'sandbox' | 'analysis' | 'compare' | 'report';

interface ServiceState {
  online: boolean;
  version?: string;
  persistence?: string;
}

const viewSteps: Array<{ id: View; label: string }> = [
  { id: 'import', label: '导入确认' },
  { id: 'sandbox', label: '情景沙盘' },
  { id: 'analysis', label: '风险研判' },
  { id: 'compare', label: '方案对比' },
  { id: 'report', label: '报告归档' },
];

const scenarioColor = { bull: '#176c56', neutral: '#a97826', bear: '#b44b3c' } as const;
const scenarioName = { bull: '繁荣情景', neutral: '基准情景', bear: '承压情景' } as const;

export default function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('home');
  const [service, setService] = useState<ServiceState>({ online: false });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [portfolioImport, setPortfolioImport] = useState<PortfolioImport>();
  const [portfolio, setPortfolio] = useState<Portfolio>();
  const [version, setVersion] = useState<PortfolioVersion>();
  const [analysis, setAnalysis] = useState<ScenarioRun>();
  const [proposal, setProposal] = useState<CandidateProposal>();
  const [comparison, setComparison] = useState<VersionComparison>();
  const [afterAnalysis, setAfterAnalysis] = useState<ScenarioRun>();
  const [report, setReport] = useState<ReportRecord>();
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [auditReady, setAuditReady] = useState(false);

  useEffect(() => {
    void refreshStatus();
  }, []);

  const totalValue = useMemo(
    () => portfolioImport?.positions.reduce((sum, item) => sum + Number(item.nominalValue), 0) ?? 0,
    [portfolioImport]
  );

  const completedViewIndex = viewSteps.findIndex((step) => step.id === view);

  async function refreshStatus() {
    try {
      const [healthy, status] = await Promise.all([checkHealth(), getServiceStatus()]);
      setService({ online: healthy, version: status.version, persistence: status.persistence });
    } catch {
      setService({ online: false });
    }
  }

  async function run<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(undefined);
    try {
      return await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发生未知错误。');
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  async function handleSample() {
    await run('正在读取样例并提交异步导入…', async () => {
      const response = await fetch('/samples/backend-v1-portfolio-10.xlsx');
      if (!response.ok) throw new Error('未找到内置样例文件。');
      const file = new File([await response.blob()], 'backend-v1-portfolio-10.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const imported = await importPortfolio(file, '十件艺术品演示组合');
      setPortfolioImport(imported);
      setView('import');
    });
  }

  async function handleFile(file: File) {
    await run('正在校验并导入 XLSX…', async () => {
      const imported = await importPortfolio(file, file.name.replace(/\.xlsx$/i, ''));
      setPortfolioImport(imported);
      setView('import');
    });
  }

  async function handleConfirm() {
    if (!portfolioImport) return;
    await run('正在固化不可变组合 V1…', async () => {
      const confirmed = await confirmImport(portfolioImport.id);
      setPortfolio(confirmed.portfolio);
      setVersion(confirmed.version);
      setView('sandbox');
    });
  }

  async function handleScenario() {
    if (!portfolio || !version) return;
    await run('正在计算三情景并调用 DeepSeek 解释…', async () => {
      const result = await calculateScenario(portfolio.id, version.id);
      setAnalysis(result.analysis);
      setView('analysis');
    });
  }

  async function handleCandidate() {
    if (!analysis) return;
    await run('AI 正在生成约束内候选方案…', async () => {
      const generated = await generateCandidate(analysis.id);
      setProposal(generated.proposal);
      setView('compare');
    });
  }

  async function handleAccept() {
    if (!proposal) return;
    await run('正在人工确认并生成不可变 V2…', async () => {
      const accepted = await acceptCandidate(proposal.id);
      setProposal(accepted.proposal);
      setComparison(accepted.comparison);
      const nextAnalysis = await getScenario(accepted.comparison.afterScenarioRunId);
      setAfterAnalysis(nextAnalysis);
    });
  }

  async function handleReport() {
    if (!proposal?.confirmedVersionId || !comparison) return;
    await run('正在生成可审计 JSON 与 PDF 报告…', async () => {
      const created = await createReport({
        portfolioVersionId: proposal.confirmedVersionId!,
        scenarioRunId: comparison.afterScenarioRunId,
        comparisonId: comparison.id,
      });
      setReport(created);
      setView('report');
      const [eventResult, auditResult] = await Promise.allSettled([
        getEvents(created.runId),
        getAudit(created.runId),
      ]);
      if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
      setAuditReady(auditResult.status === 'fulfilled');
    });
  }

  function reset() {
    setView('home');
    setPortfolioImport(undefined);
    setPortfolio(undefined);
    setVersion(undefined);
    setAnalysis(undefined);
    setProposal(undefined);
    setComparison(undefined);
    setAfterAnalysis(undefined);
    setReport(undefined);
    setEvents([]);
    setAuditReady(false);
    setError(undefined);
  }

  function canOpen(next: View): boolean {
    if (next === 'home') return true;
    if (next === 'import') return Boolean(portfolioImport);
    if (next === 'sandbox') return Boolean(version);
    if (next === 'analysis') return Boolean(analysis);
    if (next === 'compare') return Boolean(proposal);
    return Boolean(report);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView('home')} aria-label="返回首页">
          <span className="brand-mark"><Scale size={19} /></span>
          <span><strong>ArtScape</strong><small>艺术资产智能沙盘</small></span>
        </button>

        <nav className="primary-nav" aria-label="主导航">
          <NavButton icon={<LayoutDashboard />} label="决策工作台" active={view === 'home'} onClick={() => setView('home')} />
          <NavButton icon={<LibraryBig />} label="资产组合" active={view === 'import'} disabled={!portfolioImport} onClick={() => setView('import')} />
          <NavButton icon={<BarChart3 />} label="情景沙盘" active={view === 'sandbox' || view === 'analysis'} disabled={!version} onClick={() => setView(analysis ? 'analysis' : 'sandbox')} />
          <NavButton icon={<FileCheck2 />} label="报告与审计" active={view === 'compare' || view === 'report'} disabled={!proposal} onClick={() => setView(report ? 'report' : 'compare')} />
        </nav>

        <div className="sidebar-note">
          <div className="sidebar-note-icon"><Bot size={18} /></div>
          <strong>Agent 受控执行</strong>
          <p>所有计算、解释与版本变更均留下可回放证据。</p>
        </div>

        <div className="sidebar-footer">
          <button className="new-analysis" onClick={reset}><Plus size={16} /> 新建分析</button>
          <div className="profile">
            <span>JY</span>
            <div><strong>Julian</strong><small>组合负责人</small></div>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <span>艺术资产配置</span><ChevronRight size={14} /><strong>{viewTitle(view)}</strong>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="收起侧栏"><PanelLeftClose size={18} /></button>
            <div className={`service-pill ${service.online ? 'online' : 'offline'}`}>
              <i /> Backend {service.version ? `V${service.version}` : '未连接'}
              {service.persistence && <span>· {service.persistence}</span>}
            </div>
            <button className="icon-button" aria-label="刷新服务状态" onClick={() => void refreshStatus()}><RefreshCw size={17} /></button>
          </div>
        </header>

        {view !== 'home' && (
          <div className="journey-bar">
            {viewSteps.map((step, index) => {
              const active = step.id === view;
              const done = completedViewIndex > index || canOpen(step.id) && !active;
              return (
                <button key={step.id} disabled={!canOpen(step.id)} className={`${active ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => setView(step.id)}>
                  <span>{done && !active ? <Check size={13} /> : index + 1}</span>{step.label}
                </button>
              );
            })}
          </div>
        )}

        <div className={`content ${view === 'home' ? 'content-home' : ''}`}>
          {view === 'home' && <HomeView service={service} onSample={() => void handleSample()} onUpload={() => fileInput.current?.click()} />}
          {view === 'import' && portfolioImport && (
            <ImportView data={portfolioImport} total={totalValue} onConfirm={() => void handleConfirm()} />
          )}
          {view === 'sandbox' && portfolio && version && (
            <SandboxView portfolio={portfolio} version={version} onRun={() => void handleScenario()} />
          )}
          {view === 'analysis' && analysis && (
            <AnalysisView analysis={analysis} onCandidate={() => void handleCandidate()} />
          )}
          {view === 'compare' && proposal && analysis && (
            <CompareView
              proposal={proposal}
              comparison={comparison}
              before={analysis}
              after={afterAnalysis}
              onAccept={() => void handleAccept()}
              onReport={() => void handleReport()}
            />
          )}
          {view === 'report' && report && (
            <ReportView report={report} events={events} auditReady={auditReady} />
          )}
        </div>
      </main>

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.currentTarget.value = '';
        }}
      />

      {busy && <div className="busy-overlay"><div className="busy-card"><LoaderCircle className="spin" /><strong>{busy}</strong><p>计算由后端受控工作流执行，请稍候。</p></div></div>}
      {error && <div className="toast error"><span>{error}</span><button onClick={() => setError(undefined)}>关闭</button></div>}
    </div>
  );
}

function HomeView({ service, onSample, onUpload }: { service: ServiceState; onSample: () => void; onUpload: () => void }) {
  return (
    <div className="home-grid">
      <section className="hero-panel">
        <div className="eyebrow"><Sparkles size={14} /> MUSEUM INTELLIGENCE · BACKEND V1</div>
        <h1>把艺术品组合，<br />变成<span>可解释的决策。</span></h1>
        <p className="hero-copy">导入持仓，以可复现的三情景模型识别集中度与流动性风险，让 AI 在约束内提出调整方案，并生成全程可审计的专业报告。</p>
        <div className="hero-actions">
          <button className="button primary" onClick={onSample} disabled={!service.online}><Play size={17} fill="currentColor" /> 一键运行 10 件样例</button>
          <button className="button secondary" onClick={onUpload}><UploadCloud size={17} /> 导入我的 XLSX</button>
        </div>
        <div className="trust-row">
          <span><ShieldCheck size={16} /> 人工确认</span>
          <span><Fingerprint size={16} /> 快照哈希</span>
          <span><LockKeyhole size={16} /> 权限隔离</span>
        </div>
      </section>

      <section className="intelligence-card">
        <div className="card-heading">
          <div><small>LIVE PREVIEW</small><h2>组合韧性概览</h2></div>
          <span className="live-tag"><i /> 实时引擎</span>
        </div>
        <div className="preview-value"><span>组合名义价值</span><strong>¥10,000,000</strong><small>10 件 · 8 位艺术家</small></div>
        <div className="preview-scenarios">
          <PreviewScenario label="繁荣" value="¥12.31M" change="+23.1%" tone="bull" width="88%" />
          <PreviewScenario label="基准" value="¥10.21M" change="+2.1%" tone="neutral" width="73%" />
          <PreviewScenario label="承压" value="¥5.01M" change="−49.9%" tone="bear" width="36%" />
        </div>
        <div className="preview-alert">
          <span><Gauge size={17} /></span>
          <div><strong>发现 3 项关键风险</strong><p>艺术家集中度与低流动性敞口高于策略阈值</p></div>
          <ChevronRight size={18} />
        </div>
      </section>

      <section className="workflow-strip">
        {[
          ['01', '导入与确认', 'XLSX 数据校验，人工固化 V1'],
          ['02', '情景与解释', '三情景估值，DeepSeek 风险解读'],
          ['03', '候选与对比', '约束内调仓，V1 / V2 可量化比较'],
          ['04', '报告与审计', 'PDF、JSON、事件和证据链'],
        ].map(([number, title, copy], index) => (
          <div className="workflow-item" key={number}>
            <span>{number}</span><div><strong>{title}</strong><p>{copy}</p></div>{index < 3 && <ArrowRight size={17} />}
          </div>
        ))}
      </section>
    </div>
  );
}

function ImportView({ data, total, onConfirm }: { data: PortfolioImport; total: number; onConfirm: () => void }) {
  const artists = new Set(data.positions.map((item) => item.artistName)).size;
  const lowValue = data.positions.filter((item) => item.liquidityLevel === 'low').reduce((sum, item) => sum + Number(item.nominalValue), 0);
  return (
    <PageFrame
      eyebrow="PORTFOLIO INTAKE"
      title="确认组合数据"
      description="系统已完成字段识别、数值标准化与数据质量校验。确认后将生成不可变组合版本 V1。"
      action={<button className="button primary" onClick={onConfirm}><ClipboardCheck size={17} /> 确认并固化 V1</button>}
    >
      <div className="metric-grid four">
        <Metric label="组合名义价值" value={money(total)} note="人民币计价" icon={<CircleDollarSign />} />
        <Metric label="艺术品数量" value={`${data.positions.length} 件`} note={`${artists} 位艺术家`} icon={<LibraryBig />} />
        <Metric label="低流动性敞口" value={percent(lowValue / total)} note={money(lowValue)} icon={<Gauge />} tone="warning" />
        <Metric label="数据校验" value={data.issues.length ? `${data.issues.length} 项` : '100%'} note={data.issues.length ? '请检查异常项' : '全部字段完整'} icon={<ShieldCheck />} tone={data.issues.length ? 'warning' : 'good'} />
      </div>
      <section className="data-card">
        <div className="section-heading"><div><h2>已识别持仓</h2><p>{data.fileName} · {data.detectedColumns.length} 个字段</p></div><span className="status-chip good"><Check size={13} /> 可确认</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>作品 / 艺术家</th><th>品类</th><th>名义价值</th><th>基础价值</th><th>流动性</th><th>数据来源</th><th>数据日期</th></tr></thead>
            <tbody>{data.positions.map((item, index) => (
              <tr key={item.id}><td className="muted">{String(index + 1).padStart(2, '0')}</td><td><strong>{item.artworkName}</strong><small>{item.artistName}</small></td><td>{item.category}</td><td className="tabular">{money(item.nominalValue)}</td><td className="tabular muted">{money(item.baseValue)}</td><td><Liquidity level={item.liquidityLevel} /></td><td>{item.dataSource ?? '—'}</td><td className="muted">{item.dataDate ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </PageFrame>
  );
}

function SandboxView({ portfolio, version, onRun }: { portfolio: Portfolio; version: PortfolioVersion; onRun: () => void }) {
  return (
    <PageFrame
      eyebrow="SCENARIO LAB"
      title="配置三情景沙盘"
      description="参数集由 ArtScape Domain Pack 锁定并版本化，保证同一输入得到可复现结果。"
      action={<button className="button primary" onClick={onRun}><WandSparkles size={17} /> 开始受控测算</button>}
    >
      <div className="sandbox-layout">
        <section className="data-card scenario-setup">
          <div className="section-heading"><div><h2>估值情景</h2><p>预测周期 3 年 · 人民币 · HALF_UP 舍入</p></div><span className="status-chip"><LockKeyhole size={13} /> 参数已锁定</span></div>
          <div className="scenario-setup-grid">
            <ScenarioSetup tone="bull" title="繁荣情景" rate="+12.0%" copy="市场偏好扩张，优质艺术家估值溢价释放。" />
            <ScenarioSetup tone="neutral" title="基准情景" rate="+3.0%" copy="市场稳定运行，艺术家预期收益主导表现。" />
            <ScenarioSetup tone="bear" title="承压情景" rate="−18.0%" copy="市场需求收缩，流动性折价与成本充分计入。" />
          </div>
        </section>
        <aside className="model-card">
          <div className="model-icon"><Fingerprint /></div>
          <small>CALCULATION BASIS</small>
          <h2>本次计算基线</h2>
          <dl>
            <div><dt>组合</dt><dd>{portfolio.name}</dd></div>
            <div><dt>版本</dt><dd>V{version.versionNo} · 已确认</dd></div>
            <div><dt>名义价值</dt><dd>{money(version.totalNominalValue)}</dd></div>
            <div><dt>持仓数量</dt><dd>{version.positions.length} 件</dd></div>
            <div><dt>版本哈希</dt><dd className="mono">{shortId(version.calculationHash)}</dd></div>
          </dl>
          <p className="model-note"><ShieldCheck size={16} /> AI 仅解释确定性计算结果，不参与价格预测。</p>
        </aside>
      </div>
    </PageFrame>
  );
}

function AnalysisView({ analysis, onCandidate }: { analysis: ScenarioRun; onCandidate: () => void }) {
  const chartData = analysis.scenarios.map((item) => ({
    name: scenarioName[item.definition.code],
    code: item.definition.code,
    realizable: Number(item.portfolio.realizableValue),
    theoretical: Number(item.portfolio.theoreticalValue),
  }));
  const chartMax = Math.max(...chartData.map((item) => item.realizable), 1);
  return (
    <PageFrame
      eyebrow="RISK WORKSTATION"
      title="组合风险研判"
      description="确定性计算负责数值，DeepSeek 负责结构化解释；两者的输入与输出均已留痕。"
      action={<button className="button primary" onClick={onCandidate}><Sparkles size={17} /> 生成优化候选方案</button>}
    >
      <div className="analysis-grid">
        <section className="data-card chart-card">
          <div className="section-heading"><div><h2>三情景可实现价值</h2><p>理论价值扣除流动性折价与交易成本</p></div><span className="hash-label"><Fingerprint size={13} /> {shortId(analysis.calculationHash)}</span></div>
          <div className="chart-area">
            <div className="chart-scale"><span>{money(chartMax, true)}</span><span>{money(chartMax / 2, true)}</span><span>¥0</span></div>
            <div className="simple-chart">
              <div className="chart-guides"><i /><i /><i /></div>
              {chartData.map((item) => (
                <div className="bar-column" key={item.code}>
                  <strong>{money(item.realizable, true)}</strong>
                  <div><i style={{ height: `${Math.max((item.realizable / chartMax) * 100, 4)}%`, background: scenarioColor[item.code] }} /></div>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="scenario-summary-row">{analysis.scenarios.map((item) => (
            <div key={item.definition.code}><i style={{ background: scenarioColor[item.definition.code] }} /><span>{scenarioName[item.definition.code]}</span><strong>{money(item.portfolio.realizableValue, true)}</strong><small className={Number(item.portfolio.returnRate) >= 0 ? 'positive' : 'negative'}>{percent(item.portfolio.returnRate)}</small></div>
          ))}</div>
        </section>

        <section className="risk-card">
          <div className="section-heading"><div><h2>风险雷达</h2><p>{analysis.breaches.length} 项阈值触发</p></div><span className="risk-count">{analysis.breaches.length}</span></div>
          <RiskMeter label="艺术家最高集中度" value={Number(analysis.riskMetrics.maxArtistConcentration)} threshold={0.25} detail={analysis.riskMetrics.maxArtistName ?? '—'} />
          <RiskMeter label="低流动性占比" value={Number(analysis.riskMetrics.lowLiquidityRatio)} threshold={0.35} detail="名义价值口径" />
          <RiskMeter label="熊市损失率" value={Number(analysis.riskMetrics.bearLossRate)} threshold={0.35} detail="相对名义价值" />
          <RiskMeter label="数据完整度" value={Number(analysis.riskMetrics.completenessRatio)} threshold={0.9} detail="字段完整" inverse />
        </section>

        <section className="ai-card">
          <div className="ai-heading"><span><Bot size={19} /></span><div><small>DEEPSEEK ANALYST</small><h2>AI 研判摘要</h2></div><div className="provider-chip"><i /> {analysis.explanation.provider}</div></div>
          <p className="ai-summary">{analysis.explanation.summary}</p>
          <div className="observation-grid">{analysis.explanation.observations.map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p></div>)}</div>
          {analysis.explanation.caveats.length > 0 && <div className="caveat"><ShieldCheck size={16} /><span>{analysis.explanation.caveats.join('；')}</span></div>}
        </section>
      </div>
    </PageFrame>
  );
}

function CompareView({ proposal, comparison, before, after, onAccept, onReport }: {
  proposal: CandidateProposal;
  comparison?: VersionComparison;
  before: ScenarioRun;
  after?: ScenarioRun;
  onAccept: () => void;
  onReport: () => void;
}) {
  const accepted = proposal.status === 'accepted' && Boolean(comparison);
  return (
    <PageFrame
      eyebrow="CANDIDATE REVIEW"
      title={accepted ? 'V1 / V2 方案对比' : '审核 AI 候选方案'}
      description="候选方案保持组合总价值不变，仅调整名义配置。必须由组合负责人确认后才会生成 V2。"
      action={accepted
        ? <button className="button primary" onClick={onReport}><FileDown size={17} /> 生成正式报告</button>
        : <button className="button primary" onClick={onAccept}><Check size={17} /> 接受方案并固化 V2</button>}
    >
      <div className="compare-banner">
        <div><span className="candidate-mark"><WandSparkles size={18} /></span><div><small>AI CANDIDATE</small><strong>{accepted ? '候选方案已由人工确认' : '候选方案等待人工确认'}</strong><p>{proposal.explanation}</p></div></div>
        <div className="validation-list"><span><Check /> 总额守恒</span><span><Check /> 非负约束</span><span><Check /> {proposal.changes.length} 项调整</span></div>
      </div>

      {comparison && after ? (
        <div className="comparison-kpis">
          <CompareMetric label="最高艺术家集中度" before={percent(comparison.riskBefore.maxArtistConcentration)} after={percent(comparison.riskAfter.maxArtistConcentration)} delta={`${((Number(comparison.riskAfter.maxArtistConcentration) - Number(comparison.riskBefore.maxArtistConcentration)) * 100).toFixed(1)}pp`} />
          <CompareMetric label="低流动性敞口" before={percent(comparison.riskBefore.lowLiquidityRatio)} after={percent(comparison.riskAfter.lowLiquidityRatio)} delta={`${((Number(comparison.riskAfter.lowLiquidityRatio) - Number(comparison.riskBefore.lowLiquidityRatio)) * 100).toFixed(1)}pp`} />
          <CompareMetric label="熊市损失率" before={percent(comparison.riskBefore.bearLossRate)} after={percent(comparison.riskAfter.bearLossRate)} delta={`${((Number(comparison.riskAfter.bearLossRate) - Number(comparison.riskBefore.bearLossRate)) * 100).toFixed(1)}pp`} />
        </div>
      ) : (
        <div className="before-after-placeholder"><div><span>V1</span><strong>{money(before.scenarios[1]?.portfolio.realizableValue)}</strong><small>当前基准情景可实现价值</small></div><ArrowRight /><div><span>候选</span><strong>{proposal.changes.length} 项调整</strong><small>确认后计算完整 V2 情景结果</small></div></div>
      )}

      <section className="data-card">
        <div className="section-heading"><div><h2>配置调整明细</h2><p>所有金额均为名义价值；正值为增配，负值为减配</p></div><span className={`status-chip ${accepted ? 'good' : 'warning'}`}>{accepted ? <><Check size={13} /> 已确认 V2</> : '等待决策'}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>作品 / 艺术家</th><th>调整前</th><th>调整后</th><th>变化</th><th>策略理由</th></tr></thead>
            <tbody>{proposal.changes.map((change) => {
              const delta = Number(change.delta);
              return <tr key={change.positionId}><td><strong>{change.artworkName}</strong><small>{change.artistName}</small></td><td className="tabular">{money(change.beforeNominalValue)}</td><td className="tabular">{money(change.afterNominalValue)}</td><td className={`tabular ${delta >= 0 ? 'positive' : 'negative'}`}>{delta >= 0 ? '+' : ''}{money(delta)}</td><td className="reason-cell">{change.reason}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      {comparison && (
        <section className="data-card delta-card">
          <div className="section-heading"><div><h2>情景改善</h2><p>V2 相对 V1 的可实现价值变化</p></div></div>
          <div className="delta-grid">{comparison.scenarioDeltas.map((item) => (
            <div key={item.scenario}><i style={{ background: scenarioColor[item.scenario] }} /><span>{scenarioName[item.scenario]}</span><div><small>{money(item.beforeRealizableValue)} → {money(item.afterRealizableValue)}</small><strong>+{money(item.delta)}</strong></div></div>
          ))}</div>
        </section>
      )}
    </PageFrame>
  );
}

function ReportView({ report, events, auditReady }: { report: ReportRecord; events: Array<Record<string, unknown>>; auditReady: boolean }) {
  return (
    <PageFrame
      eyebrow="REPORT & GOVERNANCE"
      title="报告已生成并归档"
      description="本次分析的版本、参数、计算结果、AI 解释与人工决策已冻结为同一证据快照。"
      action={<button className="button secondary" onClick={() => window.print()}><FileDown size={17} /> 打印本页</button>}
    >
      <section className="report-hero">
        <div className="report-success"><span><Check size={26} /></span><div><small>BACKEND V1 GOVERNED REPORT</small><h2>艺术品组合情景分析报告</h2><p>生成于 {dateTime(report.createdAt)} · 报告编号 {shortId(report.id)}</p></div></div>
        <div className="report-downloads">
          <button onClick={() => void downloadArtifact(report.pdfArtifact.id, 'ArtScape-组合分析报告.pdf')}><FileDown /><span><strong>PDF 报告</strong><small>{formatBytes(report.pdfArtifact.sizeBytes)}</small></span><Download /></button>
          <button onClick={() => void downloadArtifact(report.jsonArtifact.id, 'ArtScape-组合分析快照.json')}><FileCheck2 /><span><strong>JSON 快照</strong><small>{formatBytes(report.jsonArtifact.sizeBytes)}</small></span><Download /></button>
        </div>
      </section>

      <div className="report-grid">
        <section className="data-card evidence-card">
          <div className="section-heading"><div><h2>证据快照</h2><p>用于核验报告内容未被修改</p></div><span className="status-chip good"><ShieldCheck size={13} /> 已校验</span></div>
          <dl>
            <div><dt>快照哈希</dt><dd className="mono">{report.snapshotHash}</dd></div>
            <div><dt>PDF SHA-256</dt><dd className="mono">{report.pdfArtifact.sha256}</dd></div>
            <div><dt>JSON SHA-256</dt><dd className="mono">{report.jsonArtifact.sha256}</dd></div>
            <div><dt>治理 Run</dt><dd className="mono">{report.runId}</dd></div>
          </dl>
        </section>

        <section className="data-card timeline-card">
          <div className="section-heading"><div><h2>执行审计</h2><p>{events.length} 条事件 · {auditReady ? '审计链完整' : '正在同步'}</p></div><span className="status-chip good"><Activity size={13} /> 可回放</span></div>
          <div className="timeline">
            {events.slice(-6).map((event, index) => (
              <div key={`${String(event.id ?? index)}`}><span><History size={14} /></span><div><strong>{humanEvent(String(event.type ?? 'workflow.event'))}</strong><small>{dateTime(String(event.createdAt ?? event.timestamp ?? ''))}</small></div></div>
            ))}
            {events.length === 0 && <div className="empty-events"><LoaderCircle size={17} /> 审计事件正在同步</div>}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function PageFrame({ eyebrow, title, description, action, children }: { eyebrow: string; title: string; description: string; action: React.ReactNode; children: React.ReactNode }) {
  return <div className="page-frame"><div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>{children}</div>;
}

function NavButton({ icon, label, active, disabled, onClick }: { icon: React.ReactNode; label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return <button className={active ? 'active' : ''} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span>{active && <i />}</button>;
}

function Metric({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: React.ReactNode; tone?: 'good' | 'warning' }) {
  return <div className={`metric-card ${tone ?? ''}`}><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function PreviewScenario({ label, value, change, tone, width }: { label: string; value: string; change: string; tone: 'bull' | 'neutral' | 'bear'; width: string }) {
  return <div className={`preview-scenario ${tone}`}><div><span>{label}</span><strong>{value}</strong><small>{change}</small></div><div className="preview-track"><i style={{ width }} /></div></div>;
}

function Liquidity({ level }: { level: 'high' | 'medium' | 'low' }) {
  const names = { high: '高', medium: '中', low: '低' };
  return <span className={`liquidity ${level}`}><i />{names[level]}</span>;
}

function ScenarioSetup({ tone, title, rate, copy }: { tone: 'bull' | 'neutral' | 'bear'; title: string; rate: string; copy: string }) {
  return <div className={`scenario-setup-card ${tone}`}><div><i /><span>{title}</span><strong>{rate}</strong></div><p>{copy}</p><dl><div><dt>周期</dt><dd>3 年</dd></div><div><dt>价值口径</dt><dd>可实现价值</dd></div></dl></div>;
}

function RiskMeter({ label, value, threshold, detail, inverse }: { label: string; value: number; threshold: number; detail: string; inverse?: boolean }) {
  const breached = inverse ? value < threshold : value > threshold;
  return <div className="risk-meter"><div><span>{label}<small>{detail}</small></span><strong className={breached ? 'negative' : 'positive'}>{percent(value)}</strong></div><div className="risk-track"><i className={breached ? 'breached' : 'safe'} style={{ width: `${Math.min(value * 100, 100)}%` }} /><b style={{ left: `${threshold * 100}%` }} /></div><small>策略阈值 {percent(threshold)}</small></div>;
}

function CompareMetric({ label, before, after, delta }: { label: string; before: string; after: string; delta: string }) {
  return <div className="compare-metric"><span>{label}</span><div><small>V1</small><strong>{before}</strong><ArrowRight /><small>V2</small><strong>{after}</strong></div><em>{delta}</em></div>;
}

function viewTitle(view: View): string {
  return ({ home: '决策工作台', import: '组合导入', sandbox: '情景沙盘', analysis: '风险研判', compare: '候选对比', report: '报告审计' })[view];
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function humanEvent(type: string): string {
  const map: Record<string, string> = {
    'run.created': '治理运行已创建',
    'state.entered': '工作流状态已推进',
    'tool.completed': '工具执行已完成',
    'run.completed': '治理运行已完成',
    'artifact.created': '报告制品已归档',
  };
  return map[type] ?? type.replaceAll('.', ' · ');
}
