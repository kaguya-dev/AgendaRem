'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import { Dialog } from './Dialog';
import { timestamp } from './format';
type Info = {
  twoFactor: boolean;
  recoveryRemaining: number;
  currentId: string;
  sessions: {
    id: string;
    label: string;
    trusted: boolean;
    expires_at: string;
    last_seen: string;
  }[];
};
export function SecurityDialog({ close }: { close: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function refresh() {
    setInfo(await api<Info>('security'));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function change(action: string, sessionId?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ secret?: string; uri?: string; recoveryCodes?: string[] }>(
        'security',
        {
          action,
          password,
          code: code || undefined,
          newPassword: action === 'password' ? nextPassword : undefined,
          sessionId,
        },
      );
      if (result.secret) setSetup({ secret: result.secret, uri: result.uri! });
      if (result.recoveryCodes) {
        setRecovery(result.recoveryCodes);
        setSetup(null);
      }
      if (action === 'password') {
        setPassword(nextPassword);
        setNextPassword('');
      }
      if (action === 'revoke' && sessionId === info?.currentId) {
        window.dispatchEvent(new Event('agenda:logout'));
        return;
      }
      setCode('');
      setNotice('Configuração atualizada.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Segurança e dispositivos"
      subtitle="Mantenha o acesso fácil nos seus aparelhos e controle as sessões."
      close={close}
      wide
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="editor-form">
        <p>
          Dispositivos confiáveis ficam conectados por até 90 dias. Nos demais, a sessão dura 12
          horas. O código de duas etapas é solicitado ao entrar novamente e para alterações de
          segurança.
        </p>
        <label htmlFor="security-password">Senha atual para confirmar alterações</label>
        <input
          id="security-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={256}
        />
        {(info?.twoFactor || setup) && (
          <>
            <label htmlFor="security-code">Código do autenticador ou recuperação</label>
            <input
              id="security-code"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={64}
            />
          </>
        )}
        <section>
          <h3>Trocar senha</h3>
          <label htmlFor="new-password">Nova senha (mínimo de 12 caracteres)</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
            minLength={12}
            maxLength={256}
          />
          <p className="field-help">A troca encerra o acesso dos outros dispositivos.</p>
          <button
            className="button secondary"
            disabled={busy || !password || nextPassword.length < 12}
            onClick={() => void change('password')}
          >
            Salvar nova senha
          </button>
        </section>
        <section>
          <h3>Autenticação em duas etapas · {info?.twoFactor ? 'Ativa' : 'Desativada'}</h3>
          {!info?.twoFactor && !setup && (
            <button
              className="button secondary"
              disabled={busy || !password}
              onClick={() => void change('setup')}
            >
              Configurar autenticador
            </button>
          )}
          {setup && (
            <div className="confirmation-panel">
              <p>
                No aplicativo autenticador, adicione uma conta com chave de configuração, tipo
                “baseado em tempo”.
              </p>
              <label htmlFor="totp-secret">Chave de configuração</label>
              <input id="totp-secret" readOnly value={setup.secret} />
              <p className="field-help">
                Nome: AgendaRem. Digite o código de 6 dígitos no campo acima para ativar. Esta
                configuração expira em 10 minutos.
              </p>
              <button
                className="button primary"
                disabled={busy || !password || !/^\d{6}$/.test(code)}
                onClick={() => void change('enable')}
              >
                Ativar duas etapas
              </button>
            </div>
          )}
          {info?.twoFactor && (
            <>
              <p>{info.recoveryRemaining} códigos de recuperação disponíveis.</p>
              <button
                className="button danger"
                disabled={busy || !password || !code}
                onClick={() => void change('disable')}
              >
                Desativar duas etapas
              </button>
            </>
          )}
          {recovery.length > 0 && (
            <div className="confirmation-panel">
              <h4>Guarde estes códigos de recuperação</h4>
              <p>
                Cada código funciona uma vez. Eles só são exibidos agora e permitem entrar se você
                perder o autenticador.
              </p>
              <pre className="recovery-codes">{recovery.join('\n')}</pre>
              <button
                className="button secondary"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([recovery.join('\n')], { type: 'text/plain' }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'agendarem-recuperacao.txt';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Baixar códigos
              </button>
            </div>
          )}
        </section>
        <section>
          <h3>Dispositivos conectados</h3>
          <div className="session-list">
            {info?.sessions.map((s) => (
              <div className="session-item" key={s.id}>
                <div>
                  <strong>
                    {s.label}
                    {s.id === info.currentId ? ' · Este dispositivo' : ''}
                  </strong>
                  <small>
                    {s.trusted ? 'Confiável' : 'Sessão comum'} · Expira em {timestamp(s.expires_at)}
                  </small>
                  <small>Último acesso: {timestamp(s.last_seen)}</small>
                </div>
                <button
                  className="text-button danger"
                  disabled={busy || !password}
                  onClick={() => void change('revoke', s.id)}
                >
                  Encerrar acesso
                </button>
              </div>
            ))}
          </div>
          <button
            className="button secondary"
            disabled={busy || !password}
            onClick={() => void change('revoke-others')}
          >
            Encerrar outros dispositivos
          </button>
        </section>
      </div>
    </Dialog>
  );
}
