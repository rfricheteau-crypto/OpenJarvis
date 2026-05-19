import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { sendPersonalCockpitChat } from '../../lib/api';
import type {
  HermesChatRuntime,
  PersonalCockpitChatMessage,
  PersonalCockpitChatResponse,
} from '../../types';

type HermesProviderMode = 'auto' | 'economy' | 'quality' | 'local' | 'openai';

function loadStoredMode(): HermesProviderMode {
  try {
    const raw = localStorage.getItem('hermes-chat-engine-mode');
    if (raw === 'openai' || raw === 'local' || raw === 'auto' || raw === 'economy' || raw === 'quality') return raw;
  } catch {}
  return 'auto';
}

function saveStoredMode(mode: HermesProviderMode) {
  try {
    localStorage.setItem('hermes-chat-engine-mode', mode);
  } catch {}
}

function euro(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return `${value.toFixed(2)} $`;
}

function providerTone(configured: boolean, spent: number) {
  if (spent > 0) return 'var(--color-accent)';
  if (configured) return 'var(--color-success)';
  return 'var(--color-text-tertiary)';
}

function budgetIndicator(ratio?: number, level?: string) {
  const value = ratio || 0;
  if (level === 'blocked' || value >= 1) {
    return {
      label: 'Budget bloqué',
      color: 'var(--color-error)',
      bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)',
      border: 'color-mix(in srgb, var(--color-error) 30%, transparent)',
    };
  }
  if (value >= 0.95) {
    return {
      label: 'Alerte 95 %',
      color: 'var(--color-error)',
      bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)',
      border: 'color-mix(in srgb, var(--color-error) 30%, transparent)',
    };
  }
  if (value >= 0.8) {
    return {
      label: 'Alerte 80 %',
      color: 'var(--color-warning)',
      bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
      border: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
    };
  }
  if (value >= 0.5) {
    return {
      label: 'Alerte 50 %',
      color: 'var(--color-warning)',
      bg: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
      border: 'color-mix(in srgb, var(--color-warning) 26%, transparent)',
    };
  }
  return {
    label: 'Budget sain',
    color: 'var(--color-success)',
    bg: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
    border: 'color-mix(in srgb, var(--color-success) 26%, transparent)',
  };
}

export function HermesChatPanel({
  initialRuntime,
  forceFocus = false,
}: {
  initialRuntime?: HermesChatRuntime | null;
  forceFocus?: boolean;
}) {
  const [messages, setMessages] = useState<PersonalCockpitChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [engineMode, setEngineMode] = useState<HermesProviderMode>(loadStoredMode);
  const [lastResponse, setLastResponse] = useState<PersonalCockpitChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef(`hermes-${crypto.randomUUID()}`);
  const openaiKeyPresent = useMemo(() => {
    try {
      return !!localStorage.getItem('openjarvis-openai-key');
    } catch {
      return false;
    }
  }, []);
  const openrouterKeyPresent = useMemo(() => {
    try {
      return !!localStorage.getItem('openjarvis-openrouter-key');
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!forceFocus) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(timer);
  }, [forceFocus]);

  const runtime = useMemo(() => {
    return lastResponse?.budget
      ? {
          ...initialRuntime,
          budget: lastResponse.budget,
          status: lastResponse.local_limited ? 'local_limited' : initialRuntime?.status || 'openai_ready',
        }
      : initialRuntime;
  }, [initialRuntime, lastResponse]);

  const submit = async () => {
    const message = input.trim();
    if (!message || sending) return;
    const nextHistory = [...messages, { role: 'user' as const, content: message }];
    setMessages(nextHistory);
    setInput('');
    setSending(true);
    setError(null);
    try {
      const response = await sendPersonalCockpitChat(message, messages, engineMode, sessionIdRef.current);
      setLastResponse(response);
      setMessages([...nextHistory, { role: 'assistant', content: response.reply }]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Hermès n’a pas pu répondre.';
      setError(detail);
      setMessages([
        ...nextHistory,
        {
          role: 'assistant',
          content: "Hermès n'est pas encore connecté correctement au moteur IA. Vérifie le serveur ou la configuration OpenAI.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const activeEngineLabel = lastResponse
    ? `${lastResponse.provider || lastResponse.engine} · ${lastResponse.model}`
    : engineMode === 'local'
    ? `Local gratuit · ${runtime?.local_model || 'qwen3:0.6b'}`
    : engineMode === 'quality'
    ? `Qualité · ${runtime?.openrouter_quality_model || 'openrouter/moonshotai/kimi-k2.6'}`
    : engineMode === 'economy'
    ? `Économique · ${runtime?.openrouter_economy_model || 'openrouter/google/gemini-2.5-flash'}`
    : runtime?.openrouter_configured || openrouterKeyPresent
    ? `Auto intelligent · ${runtime?.openrouter_economy_model || 'openrouter/google/gemini-2.5-flash'}`
    : openaiKeyPresent || runtime?.openai_configured
    ? `Secours OpenAI · ${runtime?.openai_model || 'gpt-4o-mini'}`
    : `Local gratuit · ${runtime?.local_model || 'qwen3:0.6b'}`;
  const paidActive = lastResponse
    ? (lastResponse.provider || lastResponse.engine) !== 'local_ollama' && lastResponse.engine !== 'local'
    : engineMode !== 'local' && (runtime?.openrouter_configured || runtime?.openai_configured || openrouterKeyPresent || openaiKeyPresent);

  const warning = lastResponse?.warning || runtime?.budget?.threshold_message || runtime?.status_message || '';
  const selectionReason = lastResponse?.selection_reason || runtime?.selection_reason || '';
  const providerRows = runtime?.budget?.providers || [];
  const budgetTone = budgetIndicator(runtime?.budget?.estimated_usage_ratio, runtime?.budget?.warning_level);

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            <Sparkles size={16} style={{ color: 'var(--color-accent)' }} />
            <span>{activeEngineLabel}</span>
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {paidActive
              ? 'Mode payant actif — provider et coût estimé affichés en direct.'
              : 'Mode local gratuit actif — aucun coût cloud.'}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['auto', 'Auto intelligent', 'Choisit local, OpenRouter ou OpenAI selon la tâche.'],
            ['economy', 'Économique', 'Priorité au modèle cloud le moins cher utile.'],
            ['quality', 'Qualité', 'Privilégie Kimi/OpenAI pour les tâches plus exigeantes.'],
            ['local', 'Local uniquement', 'Aucun coût cloud, Ollama seulement.'],
          ] as const).map(([value, label, hint]) => {
            const active = engineMode === value;
            const disabled = value !== 'local' && !!runtime?.budget?.blocked;
            return (
              <button
                key={value}
                disabled={disabled}
                onClick={() => {
                  setEngineMode(value);
                  saveStoredMode(value);
                }}
                className="px-3 py-2 rounded-2xl text-left disabled:opacity-50 min-w-[160px]"
                style={{
                  background: active ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                  color: active ? 'var(--color-on-accent)' : 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div className="text-sm font-medium">{label}</div>
                <div
                  className="text-xs mt-1"
                  style={{ color: active ? 'color-mix(in srgb, var(--color-on-accent) 82%, transparent)' : 'var(--color-text-tertiary)' }}
                >
                  {hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-sm">
        <div className="rounded-xl px-3 py-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div style={{ color: 'var(--color-text-tertiary)' }}>Aujourd’hui</div>
          <div style={{ color: 'var(--color-text)' }}>{euro(runtime?.budget?.estimated_today_usd)}</div>
        </div>
        <div className="rounded-xl px-3 py-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div style={{ color: 'var(--color-text-tertiary)' }}>Ce mois</div>
          <div style={{ color: 'var(--color-text)' }}>
            {euro(runtime?.budget?.estimated_month_usd)} / {euro(runtime?.budget?.budget_month_usd)}
          </div>
        </div>
        <div className="rounded-xl px-3 py-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div style={{ color: 'var(--color-text-tertiary)' }}>Messages cloud</div>
          <div style={{ color: 'var(--color-text)' }}>
            {runtime?.budget?.daily_message_count ?? 0} / {runtime?.budget?.daily_message_limit ?? runtime?.daily_message_limit ?? 0}
          </div>
        </div>
        <div className="rounded-xl px-3 py-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div style={{ color: 'var(--color-text-tertiary)' }}>Budget restant</div>
          <div style={{ color: 'var(--color-text)' }}>{euro(runtime?.budget?.budget_remaining_usd)}</div>
        </div>
      </div>

      <div
        className="rounded-2xl px-4 py-3"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-tertiary)' }}>
          Pourquoi ce moteur
        </div>
        <div className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>
          {selectionReason || "Hermès choisit le moteur selon le mode demandé, le coût, la disponibilité cloud et la sensibilité de la demande."}
        </div>
      </div>

      <div
        className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: budgetTone.bg, border: `1px solid ${budgetTone.border}` }}
      >
        <div className="text-sm font-medium" style={{ color: budgetTone.color }}>
          {budgetTone.label}
        </div>
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>
          {Math.round((runtime?.budget?.estimated_usage_ratio || 0) * 100)} % du budget cloud utilisé
        </div>
      </div>

      <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
            Providers et clés
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {runtime?.budget?.configured_provider_count ?? 0} provider(s) cloud configuré(s)
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
          {providerRows.map((provider) => (
            <div
              key={provider.id}
              className="rounded-xl px-3 py-3"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {provider.label}
                </div>
                <div className="text-xs" style={{ color: providerTone(provider.configured, provider.estimated_month_usd) }}>
                  {provider.id === 'local_ollama' ? 'gratuit' : provider.configured ? 'clé active' : 'clé absente'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span>Aujourd’hui : {euro(provider.estimated_today_usd)}</span>
                <span>Mois : {euro(provider.estimated_month_usd)}</span>
              </div>
              {provider.last_model && (
                <div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  Dernier modèle : {provider.last_model}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {(warning || error) && (
        <div
          className="rounded-2xl px-4 py-3 flex items-start gap-3"
          style={{
            background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-warning) 28%, transparent)',
          }}
        >
          <AlertTriangle size={16} style={{ color: 'var(--color-warning)', marginTop: 2 }} />
          <div className="text-sm" style={{ color: 'var(--color-text)' }}>
            {error || warning}
          </div>
        </div>
      )}

      {!runtime?.openrouter_configured && !openrouterKeyPresent && !runtime?.openai_configured && !openaiKeyPresent && (
        <div
          className="rounded-2xl px-4 py-3 flex items-start gap-3"
          style={{
            background: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-error) 28%, transparent)',
          }}
        >
          <ShieldCheck size={16} style={{ color: 'var(--color-error)', marginTop: 2 }} />
          <div className="text-sm" style={{ color: 'var(--color-text)' }}>
            Hermès est actuellement en mode local gratuit. Configure OpenRouter pour le mode économique, et OpenAI seulement en secours.
          </div>
        </div>
      )}

      <div
        className="rounded-2xl min-h-[320px] max-h-[520px] overflow-y-auto px-4 py-4 space-y-3"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {messages.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Bonjour Ruth. Écris directement ici, par exemple : « Hermès, aide-moi pour ADV ».
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-2xl px-4 py-3 ${message.role === 'user' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[90%]'}`}
              style={{
                background:
                  message.role === 'user'
                    ? 'color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))'
                    : 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                {message.role === 'user' ? 'Ruth' : 'Hermès'}
              </div>
              <div className="text-sm whitespace-pre-wrap">{message.content}</div>
            </div>
          ))
        )}
        {sending && (
          <div className="rounded-2xl px-4 py-3 inline-flex items-center gap-2" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <Loader2 size={15} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>
              Hermès réfléchit…
            </span>
          </div>
        )}
      </div>

      <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder="Bonjour Hermès, tu peux m’aider ?"
          className="w-full resize-none outline-none text-sm"
          style={{ background: 'transparent', color: 'var(--color-text)' }}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              {"Contexte court seulement. Pas d’envoi massif du vault Obsidian."}
            </div>
            <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              {"Vocal bientôt disponible — utilise le chat texte pour l’instant."}
            </div>
          </div>
          <button
            onClick={() => void submit()}
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full disabled:opacity-50"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
            }}
          >
            <Send size={14} />
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
