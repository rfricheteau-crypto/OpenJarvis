import { Link } from 'react-router';
import { MoveLeft } from 'lucide-react';
import { ChatArea } from '../components/Chat/ChatArea';

export function HermesChatPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <div
          className="hud-panel p-5"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 10%, var(--color-surface)) 0%, var(--color-surface) 48%, color-mix(in srgb, var(--color-accent-purple) 8%, var(--color-surface)) 100%)',
          }}
        >
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="min-w-0">
              <div className="hud-label uppercase tracking-[0.22em] mb-2">Hermes Chat</div>
              <h1 className="text-3xl font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
                Discussion avec Hermès
              </h1>
              <p className="text-sm mt-3 max-w-3xl" style={{ color: 'var(--color-text-secondary)' }}>
                Point d’entrée conversationnel principal. Écris normalement, Hermès répond ici.
              </p>
            </div>

            <div className="lg:ml-auto">
              <Link
                to="/jarvis-personal"
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                <MoveLeft size={15} />
                Revenir au cockpit
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ChatArea
          title="Oui Ruth. Dis-moi ce que tu veux reprendre."
          subtitle="Chat officiel Hermès. Réponse réelle via le backend OpenJarvis."
          forceInputFocus
        />
      </div>
    </div>
  );
}
