import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, MagicIcon, XMarkIcon, SparklesIcon } from './Icons';
import { ChatMessage, TranscriptSegment, Language } from '../types';
import { queryTranscript } from '../services/geminiService';

interface AIAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  segments: TranscriptSegment[];
  language: Language;
}

export const AIAssistant: React.FC<AIAssistantProps> = ({ isOpen, onClose, segments, language }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isLoading || segments.length === 0) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const responseText = await queryTranscript(segments, text, language);
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: language === 'es' ? 'Error al conectar con Gemini.' : 'Errorea Gemini-rekin konektatzean.',
        isError: true
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickActions = language === 'es' ? [
    "Resumir los puntos clave",
    "Sugerir 3 titulares",
    "Extraer las mejores citas",
    "¿Cuál es el tono general?"
  ] : [
    "Laburtu puntu nagusiak",
    "Iradoki 3 titular",
    "Atera aipu onenak",
    "Zein da tonu orokorra?"
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-50 flex flex-col border-l border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
        <div className="flex items-center gap-2 text-indigo-700">
          <SparklesIcon />
          <h2 className="font-serif font-bold">Copiloto IA</h2>
        </div>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-indigo-100 rounded-full transition-colors">
          <XMarkIcon />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center mt-10">
            <div className="bg-white p-4 rounded-xl shadow-sm inline-block mb-4">
                <MagicIcon />
            </div>
            <p className="text-gray-500 text-sm px-6">
              {language === 'es' 
                ? "Hola. Soy tu asistente editorial. Puedo analizar la entrevista, buscar datos o redactar por ti." 
                : "Kaixo. Zure laguntzaile editoriala naiz. Elkarrizketa aztertu, datuak bilatu edo zuretzat idatz dezaket."}
            </p>
          </div>
        )}
        
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-br-none' 
                : msg.isError 
                  ? 'bg-red-50 text-red-600 border border-red-100 rounded-bl-none'
                  : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-none'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 rounded-bl-none flex gap-1">
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      {messages.length === 0 && (
        <div className="px-4 py-2 bg-gray-50 flex flex-wrap gap-2 justify-center">
          {quickActions.map(action => (
            <button
              key={action}
              onClick={() => handleSend(action)}
              className="text-xs bg-white border border-indigo-100 text-indigo-600 px-3 py-1.5 rounded-full hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
            >
              {action}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 bg-white border-t border-gray-200">
        <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-xl border border-gray-200 focus-within:border-indigo-300 focus-within:ring-1 focus-within:ring-indigo-300 transition-all">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={language === 'es' ? "Pregunta sobre el texto..." : "Galdetu testuari buruz..."}
            disabled={isLoading}
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-gray-800 placeholder-gray-400"
          />
          <button 
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
};