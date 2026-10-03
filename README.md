# 功能开关灰度发布与影响审阅平台

基于 React 的本地可运行前端工程，覆盖功能开关配置、影响评审、依赖分析、灰度时间线、冻结回滚和发布报告。业务数据由 RTK Query 端点驱动，并持久化到浏览器 `localStorage`。

## 技术栈

- React 18 + TypeScript + Vite
- MUI
- Redux Toolkit
- RTK Query
- React Router

## 启动

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:18472`。

## 构建

```bash
npm run build
npm run preview
```

## 工作区

- 发布概览：开关采用趋势、环境放量差异、阻断问题和待评审项
- 功能开关：按状态、环境、团队和关键字筛选，进入完整配置编辑器
- 影响评审：逐项检查规则冲突、死代码、指标缺失、实验重叠和客户端兼容
- 依赖关系：依赖影响图、互斥冲突矩阵和降级关系
- 灰度发布：分阶段放量、环境差异、指标守护、冻结和紧急回滚
- 审计与回滚：查询调整、审批和异常事件，记录受影响用户范围
- 发布报告：查看发布明细并导出 CSV

浏览器首次打开时会自动写入示例数据。编辑、审批、灰度和回滚操作会写入 `feature-flag-release-console-v1` 对应的本地存储键。
