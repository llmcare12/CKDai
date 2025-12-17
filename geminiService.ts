import { GoogleGenAI, Modality } from "@google/genai";
import { 
  GEMINI_MODEL_FLASH, 
  GEMINI_MODEL_TTS, 
  RAG_KNOWLEDGE_DB, 
  FIXED_QNA_LIST,
  KnowledgeItem 
} from "./constants";
import { MindMapNode } from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY environment variable is not set");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper to clean JSON string from Markdown code blocks
const cleanJson = (text: string): string => {
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(json)?/, '').replace(/```$/, '');
  }
  return clean.trim();
};


// RAG 核心工具函式 


// 1. 固定問答精準匹配 
function findFixedAnswer(query: string): string | null {
  const target = FIXED_QNA_LIST.find(item => 
    item.question.includes(query) || query.includes(item.question)
  );
  return target ? target.answer : null;
}

// 2. 模糊檢索 
function retrieveContext(query: string, topK: number = 3): KnowledgeItem[] {
  const lowerQuery = query.toLowerCase();
  
  // 簡易計分機制
  const scoredData = RAG_KNOWLEDGE_DB.map(item => {
    let score = 0;
    if (item.topic.includes(query)) score += 10;          // 標題命中權重最高
    if (item.content.includes(query)) score += 5;         // 內容命中
    if (item.summary.includes(query)) score += 3;         // 摘要命中
    const keywordMatch = item.keywords.some(k => lowerQuery.includes(k.toLowerCase()));
    if (keywordMatch) score += 8;                         // 關鍵字命中

    return { item, score };
  });

  // 過濾掉沒分數的，由高分排到低分，取前 K 筆
  return scoredData
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(d => d.item);
}

// 3. 將檢索到的資料轉為文字 Prompt
function formatContextToPrompt(items: KnowledgeItem[]): string {
  if (items.length === 0) return "目前資料庫中無直接相關資訊，不要憑空捏造數據，並提醒使用者諮詢醫師。";
  return items.map((item, idx) => `
  [資料 ${idx + 1}]
  主題：${item.topic}
  摘要：${item.summary}
  內容：${item.content}
  `).join('\n---\n');
}



// 主要 Service 功能

// 1. AI 摘要，聊天機器人 
export const generateChatResponse = async (
  userMessage: string, 
  history: { role: string; content: string }[]
): Promise<string> => {
  
  // 先檢查固定問答 
  const fixedAns = findFixedAnswer(userMessage);
  if (fixedAns) {
    return fixedAns; 
  }

  // 執行 RAG 檢索
  // 如果使用者問的是具體食物(如滷肉飯)，RAG 可能找不到滷肉飯的條目，
  // 但會找到「低蛋白飲食」、「鈉限制」等通則，這些通則對 AI 判斷很重要。
  const retrievedItems = retrieveContext(userMessage, 5); 
  const contextPrompt = formatContextToPrompt(retrievedItems);

  const ai = getClient();
  
  // 呼叫 Gemini (核心修改處：System Instruction)
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: [
      ...history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }]
      })),
      { role: 'user', parts: [{ text: userMessage }] }
    ],
    config: {
      
      systemInstruction: `你是一位專業、親切的腎臟病衛教 AI 助理「小榮」。

      【最高優先級緊急原則 (Safety First)】
      在回答任何問題前，先檢查使用者的訊息是否包含以下**危急症狀**：
      - 關鍵字：「胸痛」、「喘不過氣」、「呼吸困難」、「意識不清」、「昏倒」、「劇烈頭痛」、「大量出血」、「心跳停止」。
      - **若偵測到上述關鍵字**：請**忽略**所有衛教資料，直接用嚴肅且緊急的語氣回答：「⚠️ 警告：這可能是危急生命的情況！請立刻撥打 119 或前往最近的急診室就醫，請勿在網路上等待回應。」
      
      【任務目標】
      根據【檢索到的衛教資料】回答使用者的問題。

      【檢索到的衛教資料】：
      ${contextPrompt}
      
      【回答核心規則 (重要)】
      0. **非相關問題過濾 (Out of Scope)**：
         在回答前，請先判斷使用者的問題主題是否與「腎臟病、洗腎、透析、或腎臟病相關飲食/共病症」有關。
         - 若使用者問的問題明顯**超出腎臟科範圍** (例如：腸病毒、流感、骨折、眼科問題、股票、一般生活瑣事等)，
         - 且【檢索到的衛教資料】中也沒有相關資訊。
         - 請**不要**嘗試回答醫學內容，請直接回覆：「抱歉，目前我的資料庫中沒有關於『[使用者詢問的主題]』的詳細資料，這方面建議您諮詢相關專科醫師。」
      1. **一般問題**：若使用者問的是定義、症狀、原則 (例如：什麼是高血磷？)，請直接依據資料口語化的回答。
      2. **飲食/食物分析問題 (Smart Check)**：
         當使用者詢問「某種食物能不能吃？」或「飲食建議」時，你必須執行以下判斷：
         - **檢查資訊**：判斷使用者的對話中(包含歷史訊息)是否已提供**「腎臟病階段」**(如：第幾期、G3、洗腎中、透析中) 或 **「共病症」**(如：糖尿病)。
         - **🔴 資訊不足時**：請**不要**直接給出建議。請禮貌地反問：「為了給您正確的建議，請問您目前的腎臟功能大約在第幾期？或是已經開始洗腎了嗎？(因為洗腎前後的飲食原則是相反的喔！)」
         - **🟢 資訊充足時**：請根據使用者的階段 (未洗腎需低蛋白/洗腎需高蛋白)，結合檢索資料中的鈉、磷、鉀限制規則，給出該食物的「適合度燈號 (🟢/🟡/🔴)」與「改良建議」。

      【語氣與排版】
      1. 溫暖、具備同理心。
      2. **絕對不要使用 Markdown 的粗體語法 (如 **文字**)，請使用純文字排版。**
      3. 若資料庫無相關資訊且無法判斷，不要憑空捏造數據，請建議諮詢醫師。`,
    }
  });

  return response.text || "抱歉，我現在無法回答，請稍後再試。";
};

// 2. 語音生成 
export const generatePodcastAudio = async (topic: string): Promise<{ audioUrl: string, script: string }> => {
  const ai = getClient();

  // 針對主題檢索資料 
  const retrievedItems = retrieveContext(topic, 6);
  const contextPrompt = formatContextToPrompt(retrievedItems);

  // 生成逐字稿
  const scriptResponse = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下檢索到的衛教資料，為主題「${topic}」撰寫一份 Podcast 廣播腳本。
    
    參考資料：
    ${contextPrompt}
    
    要求：
    1. 長度約 500 字 (口語朗讀約 2-3 分鐘)。
    2. 角色：一位親切、活潑的男性來自「台北榮總」的資深腎臟病衛教個管師，名字叫小榮。
    3. 語氣：非常口語化、輕鬆、溫暖。多用「大家知道嗎？」、「其實呀...」這類語助詞。
    4. 內容必須基於參考資料，不要憑空捏造數據。
    5. 輸出格式：純文字腳本，不要包含 [音樂]、(笑聲) 等標記。
    6. 使用繁體中文。`,
  });

  const scriptText = scriptResponse.text || "無法生成腳本，請稍後再試。";

  // 用TTS轉語音
  const audioResponse = await ai.models.generateContent({
    model: GEMINI_MODEL_TTS,
    contents: [{ parts: [{ text: scriptText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Charon' }, 
        },
      },
    },
  });

  const base64Audio = audioResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("Failed to generate audio");
  }

  const audioBuffer = decode(base64Audio);
  const wavBytes = createWavFile(audioBuffer, 24000, 1); 
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const audioUrl = URL.createObjectURL(blob);

  return { audioUrl, script: scriptText };
};

// 3. 心智圖資料生成 
export const generateMindMapData = async (topic: string): Promise<MindMapNode> => {
  const ai = getClient();

  // 針對主題檢索資料
  const retrievedItems = retrieveContext(topic, 5);
  const contextPrompt = formatContextToPrompt(retrievedItems);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_FLASH,
    contents: `請根據以下衛教資料，針對主題「${topic}」製作一個心智圖結構。
    
    參考資料：
    ${contextPrompt}
    
    要求：
    1. 僅使用上述資料庫內的資訊。
    2. 請回傳一個標準的 JSON 物件。
    3. 根節點 (Root) 是主題名稱：${topic}。
    4. 每個節點結構必須包含 'name' (字串) 和 'children' (陣列)。
    5. 層次分明，至少 3 層結構。
    6. 不要包含任何 Markdown 標記，只回傳純 JSON 字串。`,
    config: {
      responseMimeType: "application/json"
    }
  });

  const jsonStr = response.text;
  if (!jsonStr) throw new Error("No data returned");
  
  try {
    const cleanStr = cleanJson(jsonStr);
    return JSON.parse(cleanStr) as MindMapNode;
  } catch (e) {
    console.error("JSON Parse Error:", e, jsonStr);
    throw new Error("無法解析心智圖資料，請重試。");
  }
};

// --- Audio Helper Functions (Raw PCM to WAV) ---
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createWavFile(samples: Uint8Array, sampleRate: number, numChannels: number): Uint8Array {
    const buffer = new ArrayBuffer(44 + samples.length);
    const view = new DataView(buffer);
    const dataSize = samples.length;
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    const wavBytes = new Uint8Array(buffer);
    wavBytes.set(samples, 44);
    return wavBytes;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
