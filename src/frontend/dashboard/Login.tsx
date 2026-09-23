'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Circle, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { Brand } from './Brand';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [device, setDevice] = useState('Meu dispositivo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ needsCode: boolean }>('login', {
        password,
        code: code || undefined,
        trusted,
        device,
      });
      if (result.needsCode) setNeedsCode(true);
      else onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-story">
        <Brand light />
        <div className="login-copy">
          <span className="eyebrow">MENOS RUÍDO. MAIS CLAREZA.</span>
          <h1>
            Uma coisa
            <br />
            de cada vez<span>.</span>
          </h1>
          <p>
            Suas ideias, tarefas e próximos passos.
            <br />
            Tudo no seu lugar, no seu ritmo.
          </p>
          <div className="login-illustration" aria-hidden="true">
            <div>
              <span className="mini-check">
                <Check size={15} />
              </span>
              <i />
              <span className="mini-tag">feito</span>
            </div>
            <div>
              <Circle size={19} />
              <i />
              <span className="mini-dot" />
            </div>
            <div>
              <Circle size={19} />
              <i />
            </div>
          </div>
        </div>
        <span className="login-footer">Organização pessoal, feita para você.</span>
      </div>
      <main className="login-panel">
        <div className="login-card">
          <span className="login-icon">
            <ShieldCheck size={28} />
          </span>
          <span className="eyebrow">SEU ESPAÇO PESSOAL</span>
          <h2>Bom ter você por aqui.</h2>
          <p>Entre para cuidar do que vem a seguir.</p>
          <form onSubmit={submit}>
            <label htmlFor="password">Sua senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              placeholder="Digite sua senha de acesso"
            />
            {needsCode && (
              <>
                <label htmlFor="login-code">Código do autenticador ou recuperação</label>
                <input
                  id="login-code"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  maxLength={64}
                />
              </>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={trusted}
                onChange={(e) => setTrusted(e.target.checked)}
              />
              Confiar neste dispositivo por 90 dias
            </label>
            {trusted && (
              <>
                <label htmlFor="device-name">Nome do dispositivo</label>
                <input
                  id="device-name"
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  maxLength={100}
                />
                <small>
                  Use apenas em aparelhos pessoais. Você poderá encerrar este acesso nas
                  configurações.
                </small>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  Entrar no meu espaço
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <small>Acesso exclusivo ao seu AgendaMagna.</small>
        </div>
      </main>
    </div>
  );
}
