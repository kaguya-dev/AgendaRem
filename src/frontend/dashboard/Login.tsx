'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Circle, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { Brand } from './Brand';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('login', { password });
      onLogin();
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
          <small>Acesso exclusivo ao seu AgendaMagno.</small>
        </div>
      </main>
    </div>
  );
}
