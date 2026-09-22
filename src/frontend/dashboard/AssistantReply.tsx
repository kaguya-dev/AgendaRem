'use client';

export function AssistantReply({ text }: { text: string }) {
  return (
    <div className="assistant-reply">
      {text.split('\n\n').map((block, index) => {
        const lines = block.split('\n');
        return (
          <section key={index}>
            {lines.map((line, i) => {
              const task = line.match(/^#(\d+) (.+) — (.+)$/);
              if (task)
                return (
                  <div className="reply-task" key={i}>
                    <span className="reply-task-id">#{task[1]}</span>
                    <div>
                      <strong>{task[2]}</strong>
                      <small>{task[3]}</small>
                    </div>
                  </div>
                );
              if (/^\d+ tarefa\(s\)/.test(line))
                return (
                  <p className="reply-summary" key={i}>
                    {line}
                  </p>
                );
              return <p key={i}>{line}</p>;
            })}
          </section>
        );
      })}
    </div>
  );
}
