/**
 * Coze V3 Workflow 本地代理：终极纯净版
 * 架构：接收前端请求 -> 组装参数请求 Coze -> 暴力提取 Markdown -> 组装标准 JSON -> 响应前端
 */

const http = require("http");
const fs = require("fs");       // 新增这行
const path = require("path");   // 新增这行
const PORT = Number(process.env.PORT || 3000);

// ================= 配置区（千万别乱动） =================
const COZE_WORKFLOW_URL = "https://api.coze.cn/v1/workflow/run";
const COZE_WORKFLOW_ID = "7617440299426168832";
const COZE_PAT = "YOUR_COZE_PAT_HERE";// 请在此处替换为你自己的 Coze Token
// ========================================================

// 跨域设置
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
      const lineEnd = text.indexOf('\n', idx);
      startIndex = lineEnd !== -1 ? lineEnd : idx + kw.length;
      break;
    }
  }
  if (startIndex === -1) return "";

  let endIndex = text.length;
  for (const kw of endKeywords) {
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
      "Authorization": `Bearer ${COZE_PAT}`,
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
    innerDataObj = JSON.parse(parsed.data);
  } catch (e) {
    innerDataObj = { data: parsed.data };
  }

  const rawMarkdown = innerDataObj.data || innerDataObj.content || parsed.data || "";
  console.log(`[coze] 成功接收数据，Markdown长度：${rawMarkdown.length} 字符`);
  
  return rawMarkdown;
}

// 核心服务器逻辑
const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);
  
  // 【新增逻辑】当别人访问根目录时，把网页吐给他们
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    try {
      const htmlPath = path.join(__dirname, "radar.html");
      const htmlContent = fs.readFileSync(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    } catch (e) {
      res.writeHead(500);
      res.end("Frontend HTML not found.");
    }
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  
  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not Found" }));
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
    let pain = extractSection(rawMarkdown,["核心痛点挖掘 (Pain Points)", "📍 核心痛点挖掘", "核心痛点"],["产品迭代建议 (Optimization)", "🔄 产品迭代建议", "产品迭代建议", "## 🔄"]
    );
    let opt = extractSection(rawMarkdown,["产品迭代建议 (Optimization)", "🔄 产品迭代建议", "产品迭代建议"],["额外的商业洞察", "💡 额外", "小红书爆款文案", "📸 小红书", "### 小红书"]
    );
    let xhs = extractSection(rawMarkdown,["小红书爆款文案 (Creative Copy)", "📸 小红书爆款文案", "小红书爆款文案"], 
      ["Midjourney 视觉提示词", "✨ Midjourney", "### Midjourney"]
    );
    let mj = extractSection(rawMarkdown,["Midjourney 视觉提示词 (Visual Prompts)", "✨ Midjourney 视觉提示词", "Midjourney 视觉提示词"],[]
    );

    // 3. 终极防空兜底：如果切片失败，说明模型格式全变了，那就把所有文字塞进第一张卡片，保证不死机
    if (!pain && !opt && !xhs && !mj) {
      pain = rawMarkdown;
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
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log("==========================================");
  console.log(`🚀 AIGC 营销雷达服务端已启动`);
  console.log(`🌐 本地监听端口: http://localhost:${PORT}`);
  console.log(`🧠 驱动核心: Coze Workflow (Token已挂载)`);
  console.log("==========================================");
});
