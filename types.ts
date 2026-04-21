
export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  isLoading?: boolean;
}

export interface MindMapNode {
  name: string;
  children?: MindMapNode[];
}

export interface QnAItem {
  question: string;
  answer: string;
}

export enum Page {
  HOME = 'home',
  SUMMARY = 'summary',
  PODCAST = 'podcast',
  MINDMAP = 'mindmap',
  QNA = 'qna'
}
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  eGFR?: number;       // 腎絲球過濾率
  ckdStage?: string;   // 慢性腎臟病分期 (如 Stage 3a)
  updatedAt: Date;
}

//  擴充
export interface HealthRecord {
  id?: string;
  timestamp: Date | any; // Firebase Timestamp
  
  // 🅰️ 核心腎功能
  eGFR: number;           // 預估腎絲球過濾率 (ml/min/1.73m²)
  creatinine: number;     // 血清肌酸酐 (mg/dL)
  
  // 🅱️ 尿液指標
  uacr?: number;          // 尿液微量白蛋白/肌酸酐比值 (mg/g)
  urineProtein?: string;  // 尿蛋白定性 (如: 陰性, 1+, 2+...)
  
  // 🅲️ 電解質與營養
  potassium: number;      // 鉀離子 (mEq/L)
  phosphorus: number;     // 磷離子 (mg/dL)
  calcium: number;        // 鈣離子 (mg/dL)
  
  // 🅳️ 共病/日常數值
  systolicBP: number;     // 收縮壓 (mmHg)
  diastolicBP: number;    // 舒張壓 (mmHg)
  hbA1c?: number;         // 糖化血色素 (%)
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  latestRecord?: HealthRecord; // 快照最新的數據以便 AI 直接讀取
}
