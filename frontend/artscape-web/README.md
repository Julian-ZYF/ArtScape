# ArtScape Web

桌面端艺术品组合情景分析与配置决策工作台，直接连接 ArtScape Backend V1。

## 本地运行

项目统一使用 conda 的 `Hypha` 环境：

```powershell
conda run -n Hypha npm install
conda run -n Hypha npm run dev:web:docker
```

`dev:web:docker` 会从本机 `docker-artscape-backend-1` 容器读取开发用 JWT 配置，并仅传给 Vite 的 Node 代理进程；JWT 密钥不会进入浏览器构建。访问 `http://localhost:5173`。

如果后端不是通过项目 Compose 运行，可复制 `.env.example` 为本地环境配置，并执行：

```powershell
conda run -n Hypha npm run dev:web
```

## 验证

```powershell
conda run -n Hypha npm run typecheck:web
conda run -n Hypha npm run build:web
conda run -n Hypha npm run smoke:live --workspace @artscape/web
```

完整链路 smoke test 会经由前端代理执行：XLSX 导入、V1 确认、三情景、DeepSeek 解释、候选方案、V2 对比、报告和审计。

## 产品路径

1. 决策工作台：一键运行内置 10 件样例或上传 XLSX。
2. 导入确认：检查持仓、字段质量和流动性敞口，人工固化 V1。
3. 情景沙盘：使用版本化参数集运行繁荣、基准、承压三情景。
4. 风险研判：查看确定性计算、风险阈值与 DeepSeek 结构化解释。
5. 方案对比：审核 AI 约束内候选，人工确认 V2 并量化改善。
6. 报告审计：下载 MinIO 中的 PDF / JSON 制品并核验治理证据链。
