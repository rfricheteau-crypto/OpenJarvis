import { Component, type ReactNode, useState } from 'react';
import { ArrowRight, Check, Cloud, Cpu, Loader2, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { preloadModel } from '../lib/api';
import { useAppStore } from '../lib/store';

type Tab = 'installed' | 'cloud';

function hasOpenAIKey(): boolean {
  try {
    return !!localStorage.getItem('openjarvis-openai-key');
  } catch {
    return false;
  }
}

function saveHermesMode(mode: 'auto' | 'openai' | 'local') {
  try {
    localStorage.setItem('hermes-chat-engine-mode', mode);
  } catch {}
}

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
  message: string;
}

class ModelSelectorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, message: error.message || 'Le sélecteur de modèles a échoué.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>
            Sélecteur de modèles indisponible
          </div>
          <div className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>
            {this.state.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ModelSelectorModalInner({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const models = useAppStore((s) => s.models);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const setModelLoading = useAppStore((s) => s.setModelLoading);
  const addLogEntry = useAppStore((s) => s.addLogEntry);
  const [tab, setTab] = useState<Tab>('installed');
  const [loadingModel, setLoadingModelState] = useState<string | null>(null);

  async function handleSelect(modelId: string, mode: 'auto' | 'openai' | 'local') {
    setSelectedModel(modelId);
    saveHermesMode(mode);
    setModelLoading(true);
    setLoadingModelState(modelId);
    addLogEntry({
      timestamp: Date.now(),
      level: 'info',
      category: 'model',
      message: `Switching to ${modelId} (${mode})...`,
    });
    try {
      if (mode === 'local') {
        await preloadModel(modelId);
      }
    } catch (error: any) {
      addLogEntry({
        timestamp: Date.now(),
        level: 'error',
        category: 'model',
        message: `Failed to load ${modelId}: ${error?.message || error}`,
      });
    } finally {
      setModelLoading(false);
      setLoadingModelState(null);
      onClose();
    }
  }

  const openaiReady = hasOpenAIKey();
  const installedModels = models.filter((model) => !model.id.startsWith('nomic-embed-text'));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-xl rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Choisir un modèle
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              Version simple sans palette avancée ni portail.
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded cursor-pointer" style={{ color: 'var(--color-text-tertiary)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {([
            ['installed', 'Modèles installés'],
            ['cloud', 'Modèles de nuage'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className="flex-1 px-3 py-2.5 text-xs font-medium cursor-pointer"
              style={{
                color: tab === value ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                borderBottom: tab === value ? '2px solid var(--color-accent)' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[440px] overflow-y-auto p-4">
          {tab === 'installed' ? (
            <div className="space-y-2">
              {installedModels.map((model) => {
                const active = model.id === selectedModel;
                const loading = loadingModel === model.id;
                return (
                  <button
                    key={model.id}
                    onClick={() => void handleSelect(model.id, 'local')}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left cursor-pointer"
                    style={{
                      background: active ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {loading ? <Loader2 size={15} className="animate-spin" /> : <Cpu size={15} style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }} />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm" style={{ color: 'var(--color-text)' }}>{model.id}</div>
                    </div>
                    {active && <Check size={15} style={{ color: 'var(--color-accent)' }} />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {!openaiReady ? (
                <div
                  className="rounded-xl px-4 py-4"
                  style={{
                    background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-warning) 18%, transparent)',
                  }}
                >
                  <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                    Aucun modèle cloud disponible. Configurez OpenAI dans Paramètres &gt; API Keys.
                  </div>
                  <button
                    onClick={() => {
                      onClose();
                      navigate('/settings');
                    }}
                    className="mt-3 inline-flex items-center gap-2 text-sm cursor-pointer"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    Ouvrir les paramètres
                    <ArrowRight size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => void handleSelect('gpt-4o-mini', 'auto')}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left cursor-pointer"
                    style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    <Cloud size={15} style={{ color: 'var(--color-accent)' }} />
                    <div className="flex-1">
                      <div className="text-sm" style={{ color: 'var(--color-text)' }}>Auto</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                        Hermès choisit OpenAI si disponible, sinon local.
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => void handleSelect('gpt-4o-mini', 'openai')}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left cursor-pointer"
                    style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    <Cloud size={15} style={{ color: 'var(--color-accent)' }} />
                    <div className="flex-1">
                      <div className="text-sm" style={{ color: 'var(--color-text)' }}>OpenAI — gpt-4o-mini</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                        Mode recommandé pour une discussion Hermès plus naturelle.
                      </div>
                    </div>
                    {selectedModel === 'gpt-4o-mini' && <Check size={15} style={{ color: 'var(--color-accent)' }} />}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ModelSelectorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <ModelSelectorBoundary>
      <ModelSelectorModalInner onClose={onClose} />
    </ModelSelectorBoundary>
  );
}
