/**
 * Coze V3 Chat 本地代理：异步 chat 闭环
 * 1) POST /v3/chat（stream:false）→ 取 conversation_id + chat_id（data.id）
 * 2) 每 1s POST /v3/chat/retrieve 轮询直到 status 为 completed
 * 3) POST /v1/conversation/message/list 拉取消息，拼接 type=answer 的 content
 * 4) 根据标题提取 Product_Insight、Optimization、BonusInsight、Xiaohongshu_Copy、MJ_Prompts
 *
 * 前端：POST http://localhost:3000/api/chat  body: { "productName": "..." }
 */

const http = require("http");

const PORT = Number(process.env.PORT || 3000);
const COZE_HOST = (process.env.COZE_HOST || "https://api.coze.cn").replace(/\/$/, "");
const COZE_BOT_ID = process.env.COZE_BOT_ID || "7617439777452802054"; // <<<<< 这里替换你的 Bot ID
const COZE_API_TOKEN =
  process.env.COZE_API_TOKEN || "pat_XQmj92BrlYUPHAoYkLuFJLZvUBw1Jbuj9fjjeYSdmjzEqQwtHOo77ryOsJDnvyj7"; // <<<<< 这里替换你的 API Token
const POLL_INTERVAL_MS = Number(process.env.COZE_POLL_INTERVAL_MS || 1000);
const POLL_TIMEOUT_MS = Number(process.env.COZE_POLL_TIMEOUT_MS || 600000);

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
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

function tryParseJson(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function normalizeToText(val) {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val.trim();
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Coze 文档里偶有 compleated 拼写，统一成语义 */
function normalizeChatStatus(status) {
  if (status === undefined || status === null) return "";
  const s = String(status).toLowerCase();
  if (s === "compleated") return "completed";
  return s;
}

function cozeUrl(path, query) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(p, `${COZE_HOST}/`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function cozeHttpJson(label, method, url, { body, signal } = {}) {
  const headers = {
    Authorization: `Bearer ${COZE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  console.log(`[coze] ${label} → ${method} ${url}`);
  if (body !== undefined) console.log(`[coze] ${label} request body =`, JSON.stringify(body, null, 2));

  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const rawText = await resp.text();
  console.log(`[coze] ${label} http status =`, resp.status);
  console.log(`[coze] ${label} raw response =`, rawText.slice(0, 8000) + (rawText.length > 8000 ? "\n...(truncated)" : ""));

  if (!resp.ok) {
    throw new Error(`${label} HTTP ${resp.status}: ${rawText.slice(0, 2000)}`);
  }

  const parsed = tryParseJson(rawText);
  if (!parsed) {
    throw new Error(`${label} 返回非 JSON`);
  }
  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new Error(`${label} 业务错误 code=${parsed.code} msg=${parsed.msg || ""}`);
  }
  return { parsed, rawText };
}

/** 第一步：发起 chat */
async function chatCreate(productName, userId, signal) {
  const url = cozeUrl("/v3/chat");
  const body = {
    bot_id: COZE_BOT_ID,
    user_id: userId,
    stream: false,
    auto_save_history: true,
    additional_messages: [
      {
        role: "user",
        content: productName,
        content_type: "text",
      },
    ],
  };
  const { parsed, rawText } = await cozeHttpJson("chat.create", "POST", url, { body, signal });
  const data = parsed.data;
  if (!data || data.id === undefined || data.conversation_id === undefined) {
    console.error("[coze] chat.create 缺少 data.id / data.conversation_id，完整 parsed =", JSON.stringify(parsed, null, 2));
    throw new Error("chat.create 响应中缺少 data.id（chat_id）或 data.conversation_id");
  }
  console.log("[flow] conversation_id =", data.conversation_id);
  console.log("[flow] chat_id (data.id) =", data.id);
  console.log("[flow] initial status =", data.status);
  return { chat: data, parsed, rawText };
}

/** 第二步：轮询 retrieve（官方 SDK：POST /v3/chat/retrieve + query） */
async function chatRetrieve(conversationId, chatId, signal) {
  const url = cozeUrl("/v3/chat/retrieve", {
    conversation_id: conversationId,
    chat_id: chatId,
  });
  const { parsed } = await cozeHttpJson("chat.retrieve", "POST", url, { body: undefined, signal });
  return parsed.data;
}

async function pollUntilChatCompleted(conversationId, chatId, signal, initialChat) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let n = 0;
  let chat = initialChat || (await chatRetrieve(conversationId, chatId, signal));

  while (Date.now() < deadline) {
    n += 1;
    const st = normalizeChatStatus(chat && chat.status);
    console.log(`[poll #${n}] status =`, chat && chat.status, "→ normalized =", st);

    if (st === "completed") {
      console.log("[poll] chat 已完成，停止轮询");
      return chat;
    }
    if (st === "failed") {
      throw new Error(`Chat failed: ${JSON.stringify(chat.last_error || chat)}`);
    }
    if (st === "canceled") {
      throw new Error("Chat 已取消");
    }
    if (st === "requires_action") {
      throw new Error(
        "Chat requires_action（需 submit_tool_outputs），当前代理未实现该步骤。last=" + JSON.stringify(chat).slice(0, 1500)
      );
    }

    await sleep(POLL_INTERVAL_MS);
    chat = await chatRetrieve(conversationId, chatId, signal);
  }

  throw new Error(`轮询超时（${POLL_TIMEOUT_MS}ms），最后状态: ${JSON.stringify(chat && chat.status)}`);
}

/** 第三步：拉取消息列表（官方：POST /v1/conversation/message/list?conversation_id=） */
async function listChatMessages(conversationId, chatId, signal) {
  const url = cozeUrl("/v1/conversation/message/list", { conversation_id: conversationId });
  const body = {
    chat_id: chatId,
    order: "asc",
    limit: 50,
  };
  const { parsed, rawText } = await cozeHttpJson("message.list", "POST", url, { body, signal });
  const list = parsed.data;
  if (!Array.isArray(list)) {
    console.error("[coze] message.list data 不是数组:", parsed);
    throw new Error("message.list 返回的 data 不是消息数组");
  }
  console.log("[flow] message count =", list.length);
  return { messages: list, rawText };
}

/** 拼接最终 answer 文本（优先 type=answer；兼容 type 为空字符串） */
function joinAssistantAnswerContents(messages) {
  const rows = (messages || []).filter((m) => {
    if (!m || typeof m.content !== "string" || !m.content.trim()) return false;
    if (m.role !== "assistant") return false;
    const t = m.type;
    return t === "answer" || t === "" || t === undefined;
  });
  const text = rows.map((m) => m.content).join("\n").trim();
  console.log("[flow] joined answer segments =", rows.length, "total length =", text.length);
  if (text) console.log("[flow] answer preview =", text.slice(0, 1200));
  return text;
}

/* ---------- 字段提取（精确按标题分割） ---------- */
function extractContentByMarkdownHeaders(text) {
  const result = {
    Product_Insight: "",
    Optimization: "",
    BonusInsight: "",
    Xiaohongshu_Copy: "",
    MJ_Prompts: "",
  };

  // 定义标题及其对应的 key（注意顺序与文本中出现的顺序一致）
  const sections = [
    { key: "Product_Insight", startMarkers: ["📍 核心痛点挖掘"] },
    { key: "Optimization", startMarkers: ["🔄 产品迭代建议"] },
    { key: "BonusInsight", startMarkers: ["💡 额外的商业洞察"] },
    { key: "Xiaohongshu_Copy", startMarkers: ["📸 小红书爆款文案"] },
    { key: "MJ_Prompts", startMarkers: ["✨ Midjourney 视觉提示词"] },
  ];

  // 按行扫描，精确提取每个部分的内容
  const lines = text.split("\n");
  let currentKey = null;
  let buffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 检查当前行是否匹配某个部分的起始标题
    let matched = null;
    for (const sec of sections) {
      for (const marker of sec.startMarkers) {
        if (line.trim() === marker || line.trim().startsWith(marker)) {
          matched = sec;
          break;
        }
      }
      if (matched) break;
    }

    if (matched) {
      // 遇到新标题，先保存之前部分的内容
      if (currentKey && buffer.length) {
        // 去掉结尾可能的分隔线（---）
        let content = buffer.join("\n").trim();
        if (content.endsWith("---")) content = content.slice(0, -3).trim();
        result[currentKey] = content;
        buffer = [];
      }
      currentKey = matched.key;
      // 跳过标题行本身，下一行开始才是内容
      continue;
    }

    // 如果当前在某个 section 内，收集内容
    if (currentKey) {
      // 如果遇到单独一行 "---" 且后面可能是下一个标题，则结束当前部分
      if (line.trim() === "---") {
        // 但需要检查下一行是否是空行或新标题的开始（简单处理：遇到分隔符就结束）
        if (buffer.length) {
          result[currentKey] = buffer.join("\n").trim();
          buffer = [];
        }
        currentKey = null;
        continue;
      }
      buffer.push(line);
    }
  }

  // 保存最后一个部分
  if (currentKey && buffer.length) {
    let content = buffer.join("\n").trim();
    if (content.endsWith("---")) content = content.slice(0, -3).trim();
    result[currentKey] = content;
  }

  // 后备正则提取（如果上面的扫描未完全提取到）
  if (!result.Product_Insight) {
    const match = text.match(/📍 核心痛点挖掘\s*\n([\s\S]+?)(?=🔄 产品迭代建议|$)/);
    if (match) result.Product_Insight = match[1].trim();
  }
  if (!result.Optimization) {
    const match = text.match(/🔄 产品迭代建议\s*\n([\s\S]+?)(?=💡 额外的商业洞察|$)/);
    if (match) result.Optimization = match[1].trim();
  }
  if (!result.BonusInsight) {
    const match = text.match(/💡 额外的商业洞察\s*\n([\s\S]+?)(?=📸 小红书爆款文案|$)/);
    if (match) result.BonusInsight = match[1].trim();
  }
  if (!result.Xiaohongshu_Copy) {
    const match = text.match(/📸 小红书爆款文案\s*\n([\s\S]+?)(?=✨ Midjourney 视觉提示词|$)/);
    if (match) result.Xiaohongshu_Copy = match[1].trim();
  }
  if (!result.MJ_Prompts) {
    const match = text.match(/✨ Midjourney 视觉提示词\s*\n([\s\S]+)/);
    if (match) result.MJ_Prompts = match[1].trim();
  }

  console.log("[extract] 提取结果长度：");
  for (const key of Object.keys(result)) {
    console.log(`  ${key}: ${result[key].length} 字符`);
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

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

    if (COZE_BOT_ID.includes("PASTE_BOT_ID_HERE") || COZE_API_TOKEN.includes("PASTE_PAT_HERE")) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "请先配置 COZE_BOT_ID 与 COZE_API_TOKEN。" }));
      return;
    }

    const controller = new AbortController();
    req.on("close", () => controller.abort());
    const userId = body.user_id ? String(body.user_id) : `web_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const created = await chatCreate(inputText, userId, controller.signal);
    const conversationId = created.chat.conversation_id;
    const chatId = created.chat.id;

    const finalChat = await pollUntilChatCompleted(conversationId, chatId, controller.signal, created.chat);
    console.log("[flow] final chat object =", JSON.stringify(finalChat, null, 2));

    const { messages, rawText: listRaw } = await listChatMessages(conversationId, chatId, controller.signal);
    const answerBlob = joinAssistantAnswerContents(messages);
    console.log("[DEBUG] 完整 answerBlob 内容：\n", answerBlob);

    const extractedData = extractContentByMarkdownHeaders(answerBlob);
    
    const Product_Insight = extractedData.Product_Insight || "";
    const Optimization = extractedData.Optimization || "";
    const BonusInsight = extractedData.BonusInsight || "";
    const Xiaohongshu_Copy = extractedData.Xiaohongshu_Copy || "";
    const MJ_Prompts = extractedData.MJ_Prompts || "";

    console.log("[map] Product_Insight =", Product_Insight.slice(0, 50) + "...");
    console.log("[map] Optimization =", Optimization.slice(0, 50) + "...");
    console.log("[map] BonusInsight =", BonusInsight.slice(0, 50) + "...");
    console.log("[map] Xiaohongshu_Copy =", Xiaohongshu_Copy.slice(0, 50) + "...");
    console.log("[map] MJ_Prompts =", MJ_Prompts.slice(0, 50) + "...");

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        productName: inputText,
        conversation_id: conversationId,
        chat_id: chatId,
        Product_Insight,
        Optimization,
        BonusInsight,
        Xiaohongshu_Copy,
        MJ_Prompts,
        rawText: answerBlob || "",
        message_count: messages.length,
      })
    );
  } catch (e) {
    console.error("[server] error", e);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: false,
        error: e && e.message ? e.message : String(e),
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} 代理已启动`);
  console.log("[server] 入口：POST /api/chat");
  console.log(`[server] 轮询间隔 ${POLL_INTERVAL_MS}ms，超时 ${POLL_TIMEOUT_MS}ms`);
});