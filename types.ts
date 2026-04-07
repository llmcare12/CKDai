
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
