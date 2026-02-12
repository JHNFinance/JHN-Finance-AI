import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { TranscriptionEntry } from '../types';
import { PurpleStar, CloseIcon, ThumbsUpIcon, ThumbsDownIcon } from './icons';

// Helper to get API Key: Vite build or server-injected
const getApiKey = (): string => {
  const fromVite = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (fromVite) return fromVite;
  const env = (window as any).process?.env || {};
  return env.GOOGLE_GEMINI_API_KEY || env.API_KEY || env.GEMINI_API_KEY || '';
};

const SYSTEM_INSTRUCTION = `You are an AI text chat assistant for JHN Finance, a financial services company. Your name is the JHN Finance AI Agent. Your goal is to efficiently gather information from potential clients for an insurance or annuity quote. You must be friendly, professional, and get straight to the point.

Your conversation flow MUST be as follows:
1. Start with the exact introduction: "Hi! You're here so let's get started right away without the paperwork! What are you looking for today? Life insurance, health insurance, or annuities?"
2. Based on their answer, acknowledge their choice.
3. Then, explain the benefit by saying: "Great! Skip the Phone Tag: Start Your Quote Using AI for you and your Broker! To get started, I just need a few details."
4. Ask for the following information one by one. Do not ask for it all at once. Be conversational.
    - Full Name
    - Zip Code
    - Approximate monthly budget
    - Whether they are a smoker (ask as a 'yes' or 'no' question)
    - How they would like to be contacted: "How can we contact you? Phone or email?"
    - If they say phone, ask for the phone number.
    - If they say email, ask for the email address.
5. Once you have all the information, confirm it back to the user. For example: "Okay, just to confirm, your name is John Doe, you're in zip code 12345, you're a non-smoker with a budget of $200/month, looking for life insurance, and we can contact you at john.doe@email.com. Is that correct?"
6. If they confirm, end the conversation by saying: "Perfect! A JHN Finance representative will review your information and get in touch with you shortly with your personalized quote. Thank you for using the JHN Finance AI Agent!"
7. If they say something is incorrect, ask them to clarify the incorrect part and then re-confirm.

IMPORTANT: Do not deviate from this script. Do not provide financial advice. Your sole purpose is information gathering. Keep your responses concise.`;

type ChatRole = 'user' | 'model';

interface ContentTurn {
  role: ChatRole;
  parts: { text: string }[];
}

export const ChatbotText: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const chatHistoryRef = useRef<ContentTurn[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false);
  const introShownRef = useRef(false);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcription]);

  // Show bot intro when chat opens
  useEffect(() => {
    if (isOpen && transcription.length === 0 && !introShownRef.current) {
      introShownRef.current = true;
      const intro =
        "Hi! You're here so let's get started right away without the paperwork! What are you looking for today? Life insurance, health insurance, or annuities?";
      const botEntry: TranscriptionEntry = { speaker: 'bot', text: intro, isFinal: true };
      setTranscription([botEntry]);
      chatHistoryRef.current.push({ role: 'model', parts: [{ text: intro }] });
    }
    if (!isOpen) introShownRef.current = false;
  }, [isOpen, transcription.length]);

  const resetChat = useCallback(() => {
    setTranscription([]);
    setError(null);
    setShowFeedback(false);
    setFeedbackSubmitted(false);
    setIsSubmitting(false);
    isSubmittingRef.current = false;
    setInputValue('');
    chatHistoryRef.current = [];
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    resetChat();
  }, [resetChat]);

  const handleDataSubmission = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const transcriptText = transcription.map((t) => `${t.speaker}: ${t.text}`).join('\n');
    let success = false;

    try {
      const apiKey = getApiKey();
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `From the following conversation transcript, extract the client's information.
Transcript:
${transcriptText}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fullName: { type: Type.STRING },
              zipCode: { type: Type.STRING },
              monthlyBudget: { type: Type.STRING },
              isSmoker: { type: Type.BOOLEAN },
              contactMethod: { type: Type.STRING },
              contactDetail: { type: Type.STRING },
            },
          },
        },
      });

      const extractedData = JSON.parse(response.text ?? '{}');
      // Proxy via our backend to avoid CORS; server forwards to Wix webhook
      const apiUrl = '/api/submit-quote';
      const webhookRes = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractedData),
      });
      const result = await webhookRes.json().catch(() => ({}));
      if (!webhookRes.ok || !result.ok) {
        console.error('Webhook failed:', webhookRes.status, result);
        throw new Error(result.error || `Webhook failed (${webhookRes.status}).`);
      }
      success = true;
    } catch (e: any) {
      console.error('Submission error:', e);
      setError(e?.message || 'Quote submission failed. Check console.');
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
      if (success) {
        setShowFeedback(true);
      }
    }
  };

  const sendMessage = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    setInputValue('');
    setError(null);

    const lastBotMessage = transcription.filter((e) => e.speaker === 'bot').pop()?.text ?? '';
    const isConfirmationAnswer =
      /^(yes|correct|that's right|yep|yeah|sounds good)$/i.test(text.trim()) ||
      text.toLowerCase().includes('yes') ||
      text.toLowerCase().includes('correct');

    // User confirming "Is that correct?" -> add messages and trigger submission
    if (lastBotMessage.includes('Is that correct?') && isConfirmationAnswer) {
      const userEntry: TranscriptionEntry = { speaker: 'user', text, isFinal: true };
      setTranscription((prev) => [...prev, userEntry]);
      chatHistoryRef.current.push({ role: 'user', parts: [{ text }] });
      const closingMessage =
        'Perfect! A JHN Finance representative will review your information and get in touch with you shortly with your personalized quote. Thank you for using the JHN Finance AI Agent!';
      const botEntry: TranscriptionEntry = { speaker: 'bot', text: closingMessage, isFinal: true };
      setTranscription((prev) => [...prev, botEntry]);
      chatHistoryRef.current.push({ role: 'model', parts: [{ text: closingMessage }] });
      return;
    }

    // Add user message
    const userEntry: TranscriptionEntry = { speaker: 'user', text, isFinal: true };
    setTranscription((prev) => [...prev, userEntry]);
    chatHistoryRef.current.push({ role: 'user', parts: [{ text }] });

    setIsLoading(true);

    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        setError('Connection setup is incomplete. Please ensure GEMINI_API_KEY is set.');
        setIsLoading(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: chatHistoryRef.current,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });

      const botText = response.text?.trim() ?? 'I apologize, I could not generate a response.';
      const botEntry: TranscriptionEntry = { speaker: 'bot', text: botText, isFinal: true };
      setTranscription((prev) => [...prev, botEntry]);
      chatHistoryRef.current.push({ role: 'model', parts: [{ text: botText }] });
    } catch (err: any) {
      console.error('Send failed:', err);
      setError(err.message || 'Connection failed. Please check your API key.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <div className="w-full max-w-lg mx-auto flex flex-col items-center gap-4">
        <div className="relative bg-purple-700 text-white px-4 py-2 rounded-2xl shadow-lg animate-bounce">
          <p className="text-base font-bold text-center">Get an AI Instant Quote!</p>
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="w-28 h-28 bg-white rounded-full flex items-center justify-center glow-effect shadow-lg"
        >
          <img
            src="https://static.wixstatic.com/media/09d8fd_6285ad48bc614daa8fe08d6c1c4d2b25~mv2.png/v1/fill/w_170,h_167,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/JHN%20FINANCE%20SEAL%20ON%20TRANSPARENT.png"
            alt="Logo"
            className="h-24 w-24"
          />
        </button>
        <div className="flex items-center gap-1">
          <p className="text-xs text-gray-600">Powered by Google Gemini</p>
          <PurpleStar className="w-3 h-3" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto flex flex-col items-center">
      <div className="w-full bg-white rounded-2xl shadow-2xl border-4 border-purple-500 p-4 flex flex-col h-[600px] relative overflow-hidden">
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 p-1 z-10"
        >
          <CloseIcon className="h-6 w-6" />
        </button>

        <div className="flex-shrink-0 flex flex-col items-center pb-3">
          <img
            src="https://static.wixstatic.com/media/09d8fd_6285ad48bc614daa8fe08d6c1c4d2b25~mv2.png/v1/fill/w_170,h_167,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/JHN%20FINANCE%20SEAL%20ON%20TRANSPARENT.png"
            alt="Logo"
            className="h-16 w-16"
          />
          <h1 className="text-xl font-bold text-gray-800 mt-1">JHN Finance AI Agent</h1>
        </div>

        <div
          className="flex-grow my-2 overflow-y-auto px-2 flex flex-col"
          style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
        >
          {error ? (
            <div className="flex-grow flex flex-col items-center justify-center text-center space-y-4 px-4">
              <svg
                className="h-12 w-12 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-lg font-semibold text-red-600">Connection Issue</p>
              <p className="text-gray-600 text-sm">{error}</p>
            </div>
          ) : transcription.length === 0 && !showFeedback ? (
            <div className="flex-grow flex flex-col items-center justify-center text-center space-y-4">
              <p className="text-lg font-semibold text-gray-600">
                Skip the Phone Tag: Start Your Quote Using AI for you and your Broker!
              </p>
              <p className="text-sm text-gray-400 italic">Type your message below to begin.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {transcription.map((entry, index) => (
                <div
                  key={index}
                  className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 ${
                      entry.speaker === 'user' ? 'bg-purple-100 text-purple-800' : 'bg-lime-300 text-lime-900'
                    }`}
                  >
                    <p className="text-sm">{entry.text}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg px-3 py-2 bg-lime-200 text-lime-900 opacity-70">
                    <p className="text-sm">Typing...</p>
                  </div>
                </div>
              )}
              {showFeedback && (
                <div className="flex justify-center pt-4">
                  {feedbackSubmitted ? (
                    <p className="text-green-600 font-bold">Feedback received. Thank you!</p>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-sm font-bold text-gray-600">Rate your experience:</p>
                      <div className="flex gap-4">
                        <button
                          onClick={() => setFeedbackSubmitted(true)}
                          className="p-2 bg-gray-100 rounded-full hover:bg-green-100"
                        >
                          <ThumbsUpIcon className="w-6 h-6 text-green-600" />
                        </button>
                        <button
                          onClick={() => setFeedbackSubmitted(true)}
                          className="p-2 bg-gray-100 rounded-full hover:bg-red-100"
                        >
                          <ThumbsDownIcon className="w-6 h-6 text-red-600" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>

        {(() => {
          const botSaidThankYou = transcription.some((e) => e.speaker === 'bot' && e.text.includes('Thank you for using the JHN Finance AI Agent!'));
          const showSubmit = transcription.length >= 2 && botSaidThankYou && !showFeedback && !isSubmitting;
          return showSubmit ? (
            <div className="flex-shrink-0 flex flex-col items-center pt-2 pb-2 border-t">
              <button
                onClick={() => handleDataSubmission()}
                disabled={isSubmitting}
                className="w-full max-w-xs px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white font-bold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting...' : 'Submit quote'}
              </button>
            </div>
          ) : null;
        })()}

        {!showFeedback && !error && (
          <div className="flex-shrink-0 flex gap-2 pt-3 border-t mt-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Type your message..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled={isLoading || isSubmitting}
            />
            <button
              onClick={sendMessage}
              disabled={!inputValue.trim() || isLoading || isSubmitting}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
            >
              Send
            </button>
          </div>
        )}

        <div className="flex-shrink-0 flex items-center justify-center space-x-1 mt-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest">Built with Google AI Technology</p>
          <PurpleStar className="w-2 h-2" />
        </div>
      </div>
    </div>
  );
};
