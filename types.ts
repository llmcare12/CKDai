
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
