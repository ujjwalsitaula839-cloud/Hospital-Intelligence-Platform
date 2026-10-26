import { Fragment, useEffect, useRef, useState } from "react";
import { queryClinicalCopilot } from "./emsService";
import AiMark from "./AiMark";

const SUGGESTIONS = [
  { title: "Ambulances", text: "Which ambulances are coming, and which still need an answer?" },
  { title: "Next bed", text: "Which ED bed should the next ESI 2 ambulance get?" },
  { title: "Capacity", text: "How many beds are open in each unit right now?" },
  { title: "Bottlenecks", text: "What is keeping beds closed right now?" },
];

const ROOM_TOKEN = /\b[A-Z]{2,5}-[A-Z0-9]{1,3}\b/g;

// **bold** only; the assistant keeps formatting light.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <b key={index}>{part.slice(2, -2)}</b>
      : <Fragment key={index}>{part}</Fragment>,
  );
}

function Reply({ text }) {
  const blocks = [];
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^#{1,4}\s+/, "");
    if (!line) {
      list = null;
      continue;
    }
    const next = line.match(/^\**next:?\**:?\s*(.*)$/i);
    if (next) {
      list = null;
      blocks.push({ next: next[1] });
      continue;
    }
    const bullet = line.match(/^([-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = [];
        blocks.push({ list });
      }
      list.push(bullet[2]);
    } else {
      list = null;
      blocks.push({ line });
    }
  }
  return blocks.map((block, index) => {
    if (block.list) return <ul key={index}>{block.list.map((item, row) => <li key={row}>{inline(item)}</li>)}</ul>;
    if (block.next !== undefined) {
      return (
        <p key={index} className="assist-next">
          <span>Next</span>
          {inline(block.next)}
        </p>
      );
    }
    return <p key={index} className="assist-line">{inline(block.line)}</p>;
  });
}

export default function ChatPanel({ open, onClose, roomIds, onOpenRoom }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState({ configured: true, model: "" });
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setStatus({ configured: true, model: "gemini-clinical-copilot" });
    setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, error]);

  async function ask(text) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...messages, { role: "user", content: question, at: new Date() }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      await new Promise((r) => setTimeout(r, 250));
      const reply = queryClinicalCopilot(question);
      setMessages([...next, { role: "assistant", content: reply, at: new Date() }]);
    } catch {
      setError("The assistant could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  function roomsIn(text) {
    const found = [...new Set(text.match(ROOM_TOKEN) || [])];
    return roomIds ? found.filter((id) => roomIds.has(id)) : found;
  }

  if (!open) return null;
  const time = (at) => at?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="assist-sheet" role="dialog" aria-label="HIP Clinical AI">
      <header className="assist-head">
        <AiMark size={38} className="assist-logo" />
        <div className="assist-title">
          <strong>HIP Clinical AI</strong>
          <small>
            <i className={status.configured ? "is-on" : ""} />
            {status.configured ? "Reads the live database · 10 tables" : "Offline · API key missing on the server"}
          </small>
        </div>
        {messages.length > 0 && (
          <button type="button" className="assist-clear" onClick={() => { setMessages([]); setError(""); }}>
            New chat
          </button>
        )}
        <button type="button" className="assist-close" onClick={onClose} aria-label="Close assistant">×</button>
      </header>

      <div className="assist-thread" ref={logRef}>
        {messages.length === 0 && (
          <div className="assist-welcome">
            <AiMark size={68} className="assist-logo is-big" />
            <h3>Ask the hospital anything.</h3>
            <p>Beds in every unit, patients and vitals, ambulances on the way, staff and cleaning. Every bed it names becomes a button to the live map.</p>
            <div className="assist-cards">
              {SUGGESTIONS.map((item) => (
                <button key={item.title} type="button" onClick={() => ask(item.text)} disabled={busy}>
                  <small>{item.title}</small>
                  <span>{item.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => {
          if (message.role === "user") {
            return (
              <div key={index} className="msg msg-user">
                <p>{message.content}</p>
                <time>{time(message.at)}</time>
              </div>
            );
          }
          const rooms = roomsIn(message.content);
          return (
            <div key={index} className="msg msg-ai">
              <AiMark size={30} className="assist-logo" />
              <div className="msg-body">
                <Reply text={message.content} />
                {rooms.length > 0 && onOpenRoom && (
                  <div className="assist-rooms">
                    {rooms.slice(0, 4).map((id) => (
                      <button key={id} type="button" onClick={() => onOpenRoom(id)}>
                        Go to {id}
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <path d="m4.5 2.5 3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
                <time>{time(message.at)}</time>
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="msg msg-ai">
            <AiMark size={30} thinking className="assist-logo" />
            <div className="msg-body is-typing" aria-label="Thinking"><i /><i /><i /><span>Reading the live database…</span></div>
          </div>
        )}
        {error && <p className="assist-error">{error}</p>}
      </div>

      {messages.length > 0 && (
        <div className="assist-chips">
          {SUGGESTIONS.slice(0, 3).map((item) => (
            <button key={item.title} type="button" onClick={() => ask(item.text)} disabled={busy}>{item.title}</button>
          ))}
        </div>
      )}
      <form
        className="assist-form"
        onSubmit={(event) => {
          event.preventDefault();
          ask(draft);
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about beds, ambulances, patients or staff"
          aria-label="Message"
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3.5 10h12M10.5 4.5 16 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </form>
      <p className="assist-foot">Synthetic demo data · answers use only what is in the database</p>
    </div>
  );
}
