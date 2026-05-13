// --- SSE Event Types ---

export interface SSEEvent {
  event?: string;
  data: string;
}

export interface AgentTurnStartEvent {
  agent: string;
  input: string;
}

export interface InferenceStartEvent {
  model: string;
  engine: string;
  turn: number;
}

export interface InferenceEndEvent {
  model: string;
  engine: string;
  turn: number;
}

export interface ToolCallStartEvent {
  tool: string;
  arguments: string;
}

export interface ToolCallEndEvent {
  tool: string;
  success: boolean;
  latency: number;
}

// --- Chat Types ---

export interface ToolCallInfo {
  id: string;
  tool: string;
  arguments: string;
  status: 'running' | 'success' | 'error';
  result?: string;
  latency?: number;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface MessageTelemetry {
  engine?: string;
  model_id?: string;
  tokens_per_sec?: number;
  ttft_ms?: number;
  total_ms?: number;
  complexity_score?: number;
  complexity_tier?: string;
  suggested_max_tokens?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  usage?: TokenUsage;
  telemetry?: MessageTelemetry;
  audio?: { url: string };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messages: ChatMessage[];
}

export interface ConversationStore {
  version: 1;
  conversations: Record<string, Conversation>;
  activeId: string | null;
}

// --- Stream State ---

export interface StreamState {
  isStreaming: boolean;
  phase: string;
  elapsedMs: number;
  activeToolCalls: ToolCallInfo[];
  content: string;
}

// --- API Types ---

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ProviderSavings {
  provider: string;
  label: string;
  input_cost: number;
  output_cost: number;
  total_cost: number;
  energy_wh: number;
  energy_joules: number;
  flops: number;
}

export interface SavingsData {
  total_calls: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  local_cost: number;
  per_provider: ProviderSavings[];
  token_counting_version?: number;
}

export interface ServerInfo {
  model: string;
  agent: string | null;
  engine: string;
}

export interface PersonalCockpitRecord {
  [key: string]: unknown;
}

export interface PersonalCockpitFileHealth {
  exists: boolean;
  path: string;
  modified_at: string;
}

export interface PersonalCockpitHermesAction {
  label?: string;
  why?: string;
  [key: string]: unknown;
}

export interface PersonalCockpitHermesRiskGuard extends PersonalCockpitRecord {
  overall_risk_level?: string;
  allowed?: boolean;
  approval_required?: boolean;
  recommended_response?: string;
}

export interface PersonalCockpitHermesSessionCloser extends PersonalCockpitRecord {
  summary?: string;
  next_step?: string;
}

export interface PersonalCockpitHermesProjectRoute extends PersonalCockpitRecord {
  request?: string;
  categories?: string[];
  work_type?: string;
  graphify_required?: boolean;
  obsidian_continuity_check?: boolean;
  next_safe_step?: string;
}

export interface PersonalCockpitHermesOrchestratorTrace extends PersonalCockpitRecord {
  timestamp?: string;
  step?: string;
  tool?: string;
  decision?: string;
  status?: string;
  summary?: string;
}

export interface PersonalCockpitHermesToolResearch extends PersonalCockpitRecord {
  required?: boolean;
  status?: string;
  reason?: string;
  cache_key?: string;
  task?: string;
  domain?: string;
  work_type?: string;
  recommended_tool?: string;
  fallback_tool?: string;
  free_alternative?: string;
  paid_alternative?: string;
  recommended_next_step?: string;
  cost_level?: string;
  candidate_tools?: string[];
  signals?: string[];
  last_checked_at?: string;
  options_count?: number;
}

export interface PersonalCockpitHermesOrchestrator extends PersonalCockpitRecord {
  current_request?: PersonalCockpitRecord | null;
  current_packet?: PersonalCockpitRecord | null;
  current_tool_decision?: PersonalCockpitRecord | null;
  current_tool_research?: PersonalCockpitRecord | null;
  recent_trace?: PersonalCockpitHermesOrchestratorTrace[];
}

export interface PersonalCockpitHermesDelegation extends PersonalCockpitRecord {
  delegation_status?: string;
  validation_status?: string;
  delegation_target?: string;
  handoff_summary?: string;
  packet_ready?: boolean;
  tool_resolution_mode?: string;
  tool_resolution_cost?: string;
  tool_fallback?: string;
  tool_validation_gate?: string;
  result_status?: string;
  result_summary?: string;
  result_logged_at?: string;
  lifecycle_status?: string;
}

export interface PersonalCockpitPrioritySummary {
  primary?: string;
  secondary?: string[];
  pending_validation?: boolean;
  source?: string;
}

export interface PersonalCockpitAttentionItem {
  level: string;
  title: string;
  detail: string;
}

export interface PersonalCockpitSignal extends PersonalCockpitRecord {
  status?: string;
}

export interface PersonalCockpitSnapshot {
  meta: {
    generated_at: string;
    personal_root: string;
    voice_runtime: string;
  };
  general_state: {
    status: string;
    live_status: string;
    paused: boolean;
    active_until: string;
    updated_at: string;
    age_seconds: number | null;
    turn_count: number;
    last_transcription: string;
    last_response: string;
    pending_validation?: PersonalCockpitRecord | null;
    last_validated_action?: PersonalCockpitRecord | null;
    active_intent?: string;
    last_recommended_action?: string;
    last_skill_run?: PersonalCockpitRecord | null;
  };
  voice_live: {
    config_status: string;
    wake_word: string;
    vad: string;
    stt: string;
    tts: string;
    commands: string[];
    last_updated_at: string;
  };
  latest_transcription: string;
  latest_response: string;
  pending_validation?: PersonalCockpitRecord | null;
  pending_validations?: Array<{
    id: string;
    project: string;
    title: string;
    source: string;
    why_pending: string;
    expected_action: string;
    owner: string;
    status: string;
    priority: string;
    updated_at: string;
  }>;
  pending_validations_count?: number;
  last_live_brief?: PersonalCockpitRecord | null;
  yahoo_targeted_move?: PersonalCockpitRecord | null;
  yahoo_dynamic_candidate?: PersonalCockpitRecord | null;
  yahoo_dynamic_result?: PersonalCockpitRecord | null;
  session_history: Array<{
    timestamp: string;
    intent: string;
    user: string;
    assistant: string;
  }>;
  recent_actions: Array<Record<string, unknown>>;
  connectors: Array<{
    name: string;
    status: string;
    services: Record<string, string>;
    updated_at: string;
    stale_seconds?: number | null;
    attention_needed?: boolean;
    summary?: string;
    details: PersonalCockpitRecord;
  }>;
  priorities?: PersonalCockpitPrioritySummary;
  attention_now?: PersonalCockpitAttentionItem[];
  signals?: {
    hermes?: PersonalCockpitSignal;
    voice?: PersonalCockpitSignal;
    yahoo?: PersonalCockpitSignal;
  };
  connectors_overview?: {
    healthy: string[];
    attention: string[];
    offline: string[];
  };
  alerts: Array<{
    level: string;
    title: string;
    detail: string;
  }>;
  priority_lane?: {
    headline: string;
    detail: string;
    source: string;
    severity: string;
    target_id: string;
  };
  continuity: Array<{
    heading: string;
    summary: string;
  }>;
  hermes?: {
    overall?: string;
    active_intent?: string;
    last_summary?: string;
    last_recommended_action?: string;
    last_skill_run?: PersonalCockpitRecord | null;
    next_actions?: Array<PersonalCockpitHermesAction>;
    risk_guard?: PersonalCockpitHermesRiskGuard | null;
    session_closer?: PersonalCockpitHermesSessionCloser | null;
    project_route?: PersonalCockpitHermesProjectRoute | null;
    orchestrator?: PersonalCockpitHermesOrchestrator | null;
    delegation?: PersonalCockpitHermesDelegation | null;
    tool_research?: PersonalCockpitHermesToolResearch | null;
    chat_runtime?: HermesChatRuntime | null;
    status_summary?: PersonalCockpitRecord | null;
    priority_summary?: PersonalCockpitPrioritySummary | null;
  };
  file_health: Record<string, PersonalCockpitFileHealth>;
}

export interface PersonalCockpitChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface HermesBudgetSummary {
  openai_enabled: boolean;
  budget_month_usd: number;
  estimated_today_usd: number;
  estimated_month_usd: number;
  budget_remaining_usd: number;
  estimated_usage_ratio: number;
  daily_message_count: number;
  daily_message_limit: number;
  blocked: boolean;
  threshold_ratio: number;
  threshold_message: string;
  configured_provider_count?: number;
  providers?: Array<{
    id: string;
    label: string;
    kind: string;
    configured: boolean;
    estimated_today_usd: number;
    estimated_month_usd: number;
    last_model?: string;
    last_used_at?: string;
  }>;
  warning_level: string;
  updated_at: string;
}

export interface HermesChatRuntime {
  recommended_engine: string;
  preferred_provider?: string;
  openai_enabled: boolean;
  openai_configured: boolean;
  openrouter_enabled: boolean;
  openrouter_configured: boolean;
  openai_model: string;
  openrouter_economy_model: string;
  openrouter_quality_model: string;
  openrouter_code_model: string;
  local_model: string;
  max_tokens_per_reply: number;
  daily_message_limit: number;
  budget: HermesBudgetSummary;
  status: string;
  status_message: string;
  selection_reason?: string;
  personalization?: {
    summary_lines: string[];
    profile: string[];
    preferences: string[];
    rules: string[];
    validated_memory: string[];
    learning_journal: string[];
    sources: Array<{
      label: string;
      path: string;
      exists: boolean;
    }>;
  };
  available_modes?: string[];
}

export interface PersonalCockpitChatResponse {
  reply: string;
  engine: string;
  provider?: string;
  mode: string;
  model: string;
  selection_reason?: string;
  used_memory: boolean;
  source: string;
  warning?: string;
  fallback_used?: boolean;
  budget?: HermesBudgetSummary;
  usage?: TokenUsage;
  estimated_cost_usd?: number;
  local_limited?: boolean;
}

// --- Log Types ---

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  category: 'server' | 'model' | 'chat' | 'tool';
  message: string;
}
