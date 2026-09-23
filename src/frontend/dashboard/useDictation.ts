'use client';
import { useEffect, useRef, useState } from 'react';
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function useDictation(text: string, setText: (value: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draft = useRef('');
  const cleanup = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    const w = window as SpeechWindow;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      cleanup();
      if (recognition.current) {
        recognition.current.onresult =
          recognition.current.onerror =
          recognition.current.onend =
            null;
        recognition.current.abort();
        recognition.current = null;
      }
    };
  }, []);
  function start() {
    if (recognition.current) return;
    const w = window as SpeechWindow;
    const Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) return;
    draft.current = text;
    const r = new Constructor();
    recognition.current = r;
    r.lang = 'pt-BR';
    r.continuous = true;
    r.interimResults = true;
    let transcript = '',
      error = false;
    r.onresult = (event) => {
      if (recognition.current !== r) return;
      transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ')
        .trim();
      const merged = [draft.current, transcript].filter(Boolean).join(' ');
      setText(merged);
      if (merged.length > 6000) {
        error = true;
        setNotice('A transcrição excede 6.000 caracteres. Revise o texto antes de enviar.');
        r.stop();
      }
    };
    r.onerror = (event) => {
      if (recognition.current !== r) return;
      error = true;
      setNotice(
        (
          {
            'not-allowed': 'Permissão de microfone negada. Você pode continuar digitando.',
            'service-not-allowed': 'O navegador não permitiu o serviço de ditado.',
            'audio-capture': 'Microfone indisponível.',
            'no-speech': 'Nenhuma fala reconhecida. Tente novamente.',
            network: 'Falha de conexão no ditado. O rascunho foi preservado.',
            aborted: 'Ditado interrompido.',
          } as Record<string, string>
        )[event.error] ?? 'Não foi possível concluir o ditado. Continue digitando.',
      );
      cleanup();
      recognition.current = null;
      setListening(false);
      r.onresult = null;
      r.abort();
    };
    r.onend = () => {
      if (recognition.current !== r) return;
      cleanup();
      recognition.current = null;
      setListening(false);
      if (!error)
        setNotice(
          transcript
            ? 'Ditado concluído. Revise o texto e envie quando quiser.'
            : 'Nenhuma fala reconhecida. Seu rascunho foi preservado.',
        );
    };
    try {
      r.start();
      setListening(true);
      setNotice('Escutando… até 60 segundos.');
      timer.current = setTimeout(() => r.stop(), 60000);
    } catch {
      recognition.current = null;
      setListening(false);
      setNotice('Não foi possível iniciar o microfone. Continue digitando.');
    }
  }
  function cancel() {
    const r = recognition.current;
    recognition.current = null;
    cleanup();
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      r.abort();
    }
    setText(draft.current);
    setListening(false);
    setNotice('Ditado cancelado. Rascunho preservado.');
  }
  return { supported, listening, notice, start, cancel, stop: () => recognition.current?.stop() };
}
