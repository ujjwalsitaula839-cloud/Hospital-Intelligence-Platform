import React, { useState, useRef, useEffect } from 'react';
import { api } from '../../lib/api';

interface ChatMessage {
  id: string;
  sender: 'elon' | 'user';
  text: string;
  timestamp: string;
}

const DEFAULT_SUGGESTIONS = [
  'Available beds',
  'Dirty beds queue',
  'Hospital capacity',
  'ER holds',
];

export default function ElonChatWidget(): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'elon',
      text: 'Hello! I am ELON, your hospital operations coordinator. Ask me about bed status, turnover queues, or clinical holds.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const msgCounterRef = useRef(1);

  const getNextId = (prefix: string) => {
    msgCounterRef.current += 1;
    return `${prefix}-${msgCounterRef.current}`;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputMessage).trim();
    if (!query || loading) return;

    const userMsg: ChatMessage = {
      id: getNextId('user'),
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage('');
    setLoading(true);

    try {
      const data = await api.chatWithElon({ message: query });
      const elonMsg: ChatMessage = {
        id: getNextId('elon'),
        sender: 'elon',
        text: data.response,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, elonMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: getNextId('elon-err'),
        sender: 'elon',
        text: 'Unable to reach ELON operations service right now. Please try again in a moment.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ========================================================================= */}
      {/* FLOATING CHAT CARD (Matching Image 1 Reference)                          */}
      {/* ========================================================================= */}
      {isOpen && (
        <div
          data-testid="elon-chat-dialog"
          className="fixed bottom-24 right-6 w-[360px] sm:w-[380px] bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col z-50 transition-all duration-200 animate-in fade-in slide-in-from-bottom-4"
        >
          {/* Blue Curved Header (Image 1 style) */}
          <div className="bg-gradient-to-r from-blue-600 via-sky-600 to-blue-700 px-4 py-3.5 text-white flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center font-bold text-lg shadow-sm">
                👨‍⚕️
              </div>
              <div>
                <div className="text-[11px] font-medium text-blue-100">Chat with</div>
                <div className="text-base font-bold tracking-tight leading-tight">ELON</div>
              </div>
            </div>

            {/* Controls: Minimize / Close button */}
            <button
              onClick={() => setIsOpen(false)}
              className="text-blue-100 hover:text-white p-1 rounded transition-colors"
              title="Close chat"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Subtitle / Status bar */}
          <div className="bg-blue-950/30 border-b border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-400 flex items-center justify-between font-mono">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Online • Operational Assistant</span>
            </div>
            <span className="text-[10px] text-zinc-500">HIPAA Protected</span>
          </div>

          {/* Messages Body */}
          <div className="p-4 space-y-3 overflow-y-auto max-h-[300px] min-h-[220px] text-xs font-sans">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex items-start space-x-2 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.sender === 'elon' && (
                  <div className="w-6 h-6 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-xs shrink-0 mt-0.5 text-blue-300 font-bold">
                    E
                  </div>
                )}
                <div
                  className={`px-3.5 py-2.5 max-w-[85%] leading-relaxed shadow-sm whitespace-pre-wrap ${
                    m.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm'
                      : 'bg-zinc-800 text-zinc-200 rounded-2xl rounded-tl-sm'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-start space-x-2">
                <div className="w-6 h-6 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-xs shrink-0 mt-0.5 text-blue-300 font-bold">
                  E
                </div>
                <div className="bg-zinc-800 text-zinc-400 px-3.5 py-2 rounded-2xl rounded-tl-sm flex items-center space-x-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0.2s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion Chips */}
          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
            {DEFAULT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSend(s)}
                className="px-2.5 py-1 rounded-full border border-blue-500/30 bg-blue-950/30 hover:bg-blue-900/40 text-blue-200 text-[11px] transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input Bar (Image 1 style) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 bg-zinc-950 border-t border-zinc-800 flex items-center space-x-2"
          >
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Ask ELON a question..."
              className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded-full px-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={loading || !inputMessage.trim()}
              className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white flex items-center justify-center shrink-0 shadow transition-colors"
              title="Send message"
              aria-label="Send message"
            >
              <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CIRCULAR BOTTOM-RIGHT LAUNCHER (Matching Image 2 Reference)               */}
      {/* ========================================================================= */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          data-testid="elon-fab-button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 border-2 border-white/20"
          title={isOpen ? 'Close Chat' : 'Chat with ELON'}
          aria-label="Chat with ELON"
        >
          {isOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
            </svg>
          )}
        </button>
      </div>
    </>
  );
}
