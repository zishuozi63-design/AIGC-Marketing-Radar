/**
 * Coze V3 Workflow 本地代理：终极纯净版，专为 Vercel 优化
 * 架构：接收前端请求 -> 组装参数请求 Coze -> 暴力提取 Markdown -> 组装标准 JSON -> 响应前端
 *
 * 【重要】该版本 server.js 不再负责提供 radar.html 静态文件，由 Vercel 和 vercel.json 负责。
 * 【重要】COZE_PAT 通过 Vercel 环境变量注入。
 */

const http = require("http");
// const fs = require("fs"); // Vercel 不再需要 server.js 提供静态文件，所以删掉
// const path = require("path"); // Vercel 不再需要 server.js 提供静态文件，所以删掉
const PORT = Number(process.env.PORT || 3000);

// ================= 配置区（千万别乱动） =================
const COZE_WORKFLOW_URL = "https://api.coze.cn/v1/workflow/run";
const COZE_WORKFLOW_ID = "7617440299426168832";
const COZE_PAT = process.env.COZE_PAT; // 从 Vercel 环境变量获取 Token，确保安全！
// ========================================================

// 跨域设置（前端 HTML 和后端在同一个 Vercel 项目下，理论上不会有跨域问题，但保留兼容性）
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// 读取前端 JSON 请求
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// 无敌文本截取器：精准切开 Markdown 长文
function extractSection(text, startKeywords, endKeywords) {
  let startIndex = -1;
  for (const kw of startKeywords) {
    const idx = text.indexOf(kw);
    if (idx !== -1) {
      // 找到关键词后，跳到该行末尾或关键词结束，避免匹配到标题本身
      const lineEnd = text.indexOf('\n', idx);
      startIndex = lineEnd !== -1 ? lineEnd : idx + kw.length;
      break;
    }
  }
  if (startIndex === -1) return ""; // 没找到起始关键词

  let endIndex = text.length;
  for (const kw of endKeywords) {
    // 确保结束关键词在起始关键词之后
    const idx = text.indexOf(kw, startIndex);
    if (idx !== -1 && idx < endIndex) {
      endIndex = idx;
    }
  }
  
  // 切割并清理多余的横线和换行
  let result = text.substring(startIndex, endIndex).trim();
  result = result.replace(/^---+/g, '').replace(/---+$/g, '').trim();
  return result;
}

// 请求 Coze 云端工作流
async function requestCozeWorkflow(productName, signal) {
  const payload = {
    workflow_id: COZE_WORKFLOW_ID,
    parameters: {
      product_info: productName,
      product_type: "通用",
    },
  };

  console.log(`[coze] 正在请求云端大模型，目标产品：${productName}`);
  
  const resp = await fetch(COZE_WORKFLOW_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${COZE_PAT}`, // 确保这里 Token 正确
    },
    body: JSON.stringify(payload),
    signal,
  });

  const rawText = await resp.text();
  
  if (!resp.ok) {
    throw new Error(`Coze API 请求失败: HTTP ${resp.status} - ${rawText}`);
  }

  const parsed = JSON.parse(rawText);
  if (parsed.code !== 0) {
    throw new Error(`Coze 工作流报错: ${parsed.msg}`);
  }

  // 解开 Coze 的双层嵌套套娃，拿到最核心的 Markdown 字符串
  let innerDataObj = {};
  try {
    innerDataObj = JSON.parse(parsed.data); // 尝试解析外层 data 字段
  } catch (e) {
    innerDataObj = { data: parsed.data }; // 如果不是 JSON 字符串，则直接当作对象处理
  }

  const rawMarkdown = innerDataObj.data || innerDataObj.content || parsed.data || "";
  console.log(`[coze] 成功接收数据，Markdown长度：${rawMarkdown.length} 字符`);
  
  return rawMarkdown;
}

// 核心服务器逻辑
const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);
  
  // Vercel 会处理 GET / 请求，所以这里只处理 POST /api/chat 和 OPTIONS
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  
  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not Found (Only POST /api/chat is supported)" }));
    return;
  }

  try {
    const body = await readJson(req);
    const inputText = typeof body.productName === "string" ? body.productName.trim() : "";
    
    if (!inputText) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "productName 不能为空" }));
      return;
    }

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    // 1. 获取工作流的长文本
    const rawMarkdown = await requestCozeWorkflow(inputText, controller.signal);

    // 2. 暴力分拣：把长文本切成 4 块，装进前端需要的包裹里
    let pain = extractSection(rawMarkdown,
      ["核心痛点挖掘 (Pain Points)", "📍 核心痛点挖掘", "核心痛点"],
      ["产品迭代建议 (Optimization)", "🔄 产品迭代建议", "产品迭代建议", "额外的商业洞察", "💡 额外", "小红书爆款文案", "📸 小红书", "### 小红书", "## 🔄"] // 增加结束关键词
    );
    let opt = extractSection(rawMarkdown,
      ["产品迭代建议 (Optimization)", "🔄 产品迭代建议", "产品迭代建议"],
      ["额外的商业洞察", "💡 额外", "小红书爆款文案", "📸 小红书", "### 小红书"] // 增加结束关键词
    );
    let xhs = extractSection(rawMarkdown,
      ["小红书爆款文案 (Creative Copy)", "📸 小红书爆款文案", "小红书爆款文案"], 
      ["Midjourney 视觉提示词", "✨ Midjourney", "### Midjourney"]
    );
    let mj = extractSection(rawMarkdown,
      ["Midjourney 视觉提示词 (Visual Prompts)", "✨ Midjourney 视觉提示词", "Midjourney 视觉提示词"],
      [] // MJ是最后一个部分，没有结束关键词
    );

    // 3. 终极防空兜底：如果切片失败，说明模型格式全变了，那就把所有文字塞进第一张卡片，保证不死机
    if (!pain && !opt && !xhs && !mj) {
      pain = rawMarkdown; // 所有内容归给 Product_Insight
      opt = ""; // 其他清空
      xhs = "";
      mj = "";
    }

    // 4. 组装标准 JSON 契约并发送给前端
    const finalResult = {
      Product_Insight: pain,
      Optimization: opt,
      Xiaohongshu_Copy: xhs,
      MJ_Prompts: mj
    };

    console.log("[server] 核心数据分拣完毕，准时发车返回前端！\n");
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(finalResult));

  } catch (e) {
    console.log("[server] 发生严重错误:", e.message);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: false,
        error: e.message,
      })
    );
  }
});

server.listen(PORT, () => {
  console.log("==========================================");
  console.log(`🚀 AIGC 营销雷达服务端已启动`);
  console.log(`🌐 本地监听端口: http://localhost:${PORT}`);
  console.log(`🧠 驱动核心: Coze Workflow (Token已挂载)`);
  console.log("==========================================");
});