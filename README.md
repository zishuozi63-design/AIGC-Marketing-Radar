<img width="2449" height="1362" alt="image" src="https://github.com/user-attachments/assets/5983d56b-35e2-4449-af17-9eb9fe0fe1a5" /># AIGC-Marketing-Radar
基于 RAG 与 Node.js 的全栈 AI 竞品营销雷达系统
# 🚀 AIGC 竞品与营销雷达 (Marketing Radar)

> 基于 RAG 架构与 Node.js BFF 层，打通小红书 UGC 数据闭环的垂直场景 AI 洞察工具。
> 
> 🔗 **[点击此处查看完整 PRD 文档与操作演示视频]https://docs.qq.com/doc/DUmFtc250cHpFeXhj **

---

## 📸 产品界面展示

*(请在这里插入一张你的极光网页高清截图)*


<img width="2449" height="1362" alt="屏幕截图 2026-04-06 153239" src="https://github.com/user-attachments/assets/a5e62e47-ec23-4ef7-8de0-850157a36419" />


## 🎯 产品定位与业务闭环

本产品是一款面向消费品牌方的智能市场洞察 SaaS 工具，核心解决中小企业在 AI 工具落地中**“竞品调研慢、营销物料产出效率低”**的痛点。

通过直连 Coze V3 Workflow API，实时检索小红书 UGC 数据，实现从**“用户声音采集”**到**“营销资产生成”**的全链路自动化，将传统需 3-5 天的调研周期压缩至 **30 秒**。

### 💡 核心痛点与本产品解法对比

| 痛点层级 | 传统模式 | 本产品解法 (AIGC 雷达) |
| :--- | :--- | :--- |
| **数据获取难** | 人工爬取或买第三方报告，滞后 7-15 天 | 直连 Coze，RAG 实时检索结构化评论数据，T+0 响应 |
| **洞察提炼慢** | 依赖分析师人肉归纳，周期 3-5 天 | LLM 自动聚类痛点标签，输出结构化洞察报告，分钟级交付 |
| **落地执行断** | 洞察与内容生产脱节，需二次 briefing | 一键并发生成爆款文案及 Midjourney 提示词，打通最后一公里 |

---

## 🛠️ 核心技术架构 (Tech Stack & Architecture)

本项目采用前后端分离架构，由独立开发者（全栈）完成从 MVP 到落地的全生命周期。

*   **前端 (Frontend)**：HTML / CSS / Vanilla JS
    *   运用 Cursor (Vibe Coding) 独立开发极简北欧风 (极光毛玻璃) 交互网页。
    *   引入 Skeleton Screen (骨架屏) 机制，极大优化大模型长响应时间的等待体感。
*   **后端层 (BFF - Backend for Frontend)**：Node.js
    *   独立搭建 Node.js 代理服务器，彻底解决前端直接调用 API 产生的 CORS 跨域与密钥泄露风险。
    *   **核心亮点**：攻克了云端工作流输出非结构化 Markdown 的痛点，在后端通过**复杂正则切片与降级容错算法**，强制提取业务字段，重组为前端标准 JSON 契约，保证数据渲染成功率达 99%。
*   **AI 底层 (AI Engine)**：Coze V3 API + RAG
    *   构建垂直领域 RAG 本地知识库，有效约束大模型幻觉。
    *   设计多节点 Agent Workflow，实现“痛点挖掘、迭代建议、社交文案、视觉 Prompt”四位一体并发输出。

---

## 🚀 快速本地运行 (Quick Start)

如果你想在本地环境中运行此项目，请按照以下步骤操作：

**1. 克隆项目并进入目录**

```bash
git clone https://github.com/你的用户名/AIGC-Marketing-Radar.git
cd AIGC-Marketing-Radar
# Windows (CMD)
set COZE_PAT=pat_你的真实Token放在这里

# Mac/Linux
export COZE_PAT="pat_你的真实Token放在这里"
node server.js
启动成功后，打开浏览器访问自动弹出的本地路径，或者直接双击根目录下的 radar.html 即可体验
