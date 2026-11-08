// Matches the Django serializers. IDs are numbers and dates are ISO strings.

export type UserRole = 'victim' | 'hr' | 'law_firm'

export type User = {
  id: number
  username: string
  role: UserRole
  preferred_language: string
}

export type LoginResponse = {
  token: string
  user: User
}

export type CaseStatus = 'open' | 'closed'

export type Case = {
  id: number
  title: string
  status: CaseStatus
  is_owner: boolean
  created_at: string
  updated_at: string
  /** Progress, only in the list response (null elsewhere). */
  timeline_count?: number | null
  tasks_total?: number | null
  tasks_done?: number | null
  /** How many people the owner shares this with; null for anyone but the owner. */
  shared_count?: number | null
}

export type TimelineSource = 'manual' | 'ai' | 'document'

export type TimelineEntry = {
  id: number
  occurred_at: string
  title: string
  description: string
  source: TimelineSource
  document: number | null
  /** The chat session this entry stands for. Set by the server with the chat's first message. */
  conversation: number | null
  created_at: string
}

export type TimelineEntryInput = {
  occurred_at: string
  title: string
  description?: string
  document?: number | null
}

export type Task = {
  id: number
  title: string
  notes: string
  due_date: string | null
  done: boolean
  created_by_ai: boolean
  created_at: string
}

export type TaskInput = {
  title: string
  notes?: string
  due_date?: string | null
  done?: boolean
}

export type DocumentStatus = 'pending' | 'processing' | 'done' | 'failed'

// Named CaseDocument to avoid clashing with the browser's global Document type.
export type CaseDocument = {
  id: number
  original_name: string
  content_type: string
  status: DocumentStatus
  created_at: string
}

export type Conversation = {
  id: number
  created_at: string
  /** Set when the chat was closed. The server refuses new messages to a closed chat. */
  closed_at: string | null
  /** The chat's timeline entry, once its first message is saved. */
  timeline_entry: number | null
}

export type ApiMessage = {
  id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  flagged_crisis: boolean
  created_at: string
}

export type SendMessageResponse = {
  user_message: ApiMessage
  /** Null when the message was flagged as a crisis. */
  reply: ApiMessage | null
  /** Plain-text resources for clients without their own crisis UI. */
  crisis_resources?: string
}

// Proposed shapes for the RAG owner to review. The backend doesn't return these yet.
export type Citation = {
  title: string
  url: string
}

export type SuggestedStep = {
  title: string
}

export type ChatMessage = Omit<ApiMessage, 'role'> & {
  role: 'user' | 'assistant'
  citations: Citation[]
  suggested_steps: SuggestedStep[]
}
