# 0001 — Astro 静态生成 + React 岛屿

## 状态

已接受（2026-07-16）

## 背景

HikariLanding 官网定位为「品牌名片」：一页式、纯英文、纯静态产物，部署于 GitHub Pages（组织根站点）。项目区数据在构建时从 GitHub API 拉取。同时对动效与设计细节有高要求（参考 Emil Kowalski 的设计哲学，其动效生态以 React + motion 库为主）。

## 决定

使用 Astro 作为站点框架，静态输出；仅在需要精致交互的局部（如项目卡片动效）使用 React 岛屿搭配 motion 库，其余动效用 CSS/WAAPI 实现。

## 备选方案

- **Next.js 静态导出**：全 React，Emil 生态最顺手，但品牌单页需拖整个 React 运行时，首屏 JS 重，与「Light, not noise」原则冲突。
- **手写 HTML/CSS/JS + 构建脚本**：最轻，但构建时数据注入、动效、后续扩展全部手工承担，开发体验差。

## 后果

- 默认零 JS，首屏轻量，契合品牌原则；JS 只按岛屿粒度按需加载。
- 构建时 fetch 是 Astro 原生能力，配合 GitHub Actions 定时重建实现项目区「自动生长」。
- 需要接受 Astro/React 两种组件心智模型并存；岛屿边界即水合边界，划分需克制。
