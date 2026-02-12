import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, Type } from '@google/genai';
import { ChatStatus, TranscriptionEntry } from '../types';
import { PurpleStar, MicrophoneIcon, CloseIcon, ThumbsUpIcon, ThumbsDownIcon } from './icons';
import { encode, decode, decodeAudioData } from '../services/audioUtils';

// Helper to get API Key: Vite build (Vercel) or server-injected (local)
const getApiKey = (): string => {
  const fromVite = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (fromVite) return fromVite;
  const env = (window as any).process?.env || {};
  return env.GOOGLE_GEMINI_API_KEY || env.API_KEY || env.GEMINI_API_KEY || '';
};

const SYSTEM_INSTRUCTION = `You are an AI voice assistant for JHN Finance, a financial services company. Your name is the JHN Finance AI Agent. Your goal is to efficiently gather information from potential clients for an insurance or annuity quote. You must be friendly, professional, and get straight to the point.

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

const getChatUrl = () => {
  const base = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname || '/'}`.replace(/\/$/, '') : '';
  return `${base}?open=1`;
};

export const Chatbot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('open') === '1';
  });
  const [status, setStatus] = useState<ChatStatus>(ChatStatus.IDLE);
  const [transcription, setTranscription] = useState<TranscriptionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextAudioStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcription]);

  const stopAudioPlayback = () => {
    if (outputAudioContextRef.current) {
        audioSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) {}
        });
        audioSourcesRef.current.clear();
        nextAudioStartTimeRef.current = 0;
    }
  };

  const cleanup = useCallback(() => {
    stopAudioPlayback();
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
      microphoneStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close();
    }
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    if(sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close()).catch(() => {});
        sessionPromiseRef.current = null;
    }
    isSubmittingRef.current = false;
  }, []);

  const resetChat = useCallback(() => {
    setTranscription([]);
    setError(null);
    setShowFeedback(false);
    setFeedbackSubmitted(false);
    setIsSubmitting(false);
    isSubmittingRef.current = false;
    setStatus(ChatStatus.IDLE);
    cleanup();
  }, [cleanup]);

  const stopSession = useCallback(() => {
    setStatus(ChatStatus.IDLE);
    cleanup();
  }, [cleanup]);
  
  const handleClose = useCallback(() => {
      setIsOpen(false);
      resetChat();
  }, [resetChat]);

  const handleDataSubmission = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatus(ChatStatus.PROCESSING);

    const transcriptText = transcription.map(t => `${t.speaker}: ${t.text}`).join('\n');
    let success = false;
    try {
        const apiKey = getApiKey();
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `From the following conversation transcript, extract the client's information. 
            Transcript:\n${transcriptText}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        fullName: { type: Type.STRING },
                        zipCode: { type: Type.STRING },
                        monthlyBudget: { type: Type.STRING },
                        isSmoker: { type: Type.BOOLEAN },
                        contactMethod: { type: Type.STRING },
                        contactDetail: { type: Type.STRING },
                    }
                }
            }
        });

        const extractedData = JSON.parse(response.text);
        // Proxy via our backend to avoid CORS; server forwards to Wix webhook
        const apiUrl = '/api/submit-quote';
        const webhookRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(extractedData),
        });
        const result = await webhookRes.json().catch(() => ({}));
        if (!webhookRes.ok || !result.ok) {
            console.error("Webhook failed:", webhookRes.status, result);
            throw new Error(result.error || `Webhook failed (${webhookRes.status}).`);
        }
        success = true;
    } catch (e: any) {
        console.error("Submission error:", e);
        setError(e?.message || "Quote submission failed. Check console.");
        setStatus(ChatStatus.ERROR);
    } finally {
        setIsSubmitting(false);
        if (success) {
            setShowFeedback(true);
        }
        stopSession();
    }
};

  const startSession = async () => {
    resetChat();
    const apiKey = getApiKey();

    if (!apiKey) {
        console.error("API Key is missing in environment.");
        setError('Connection setup is incomplete. Please ensure GOOGLE_GEMINI_API_KEY is set.');
        setStatus(ChatStatus.ERROR);
        return;
    }

    if (!window.isSecureContext) {
        setError('Microphone access requires a secure connection (HTTPS).');
        setStatus(ChatStatus.ERROR);
        return;
    }

    setStatus(ChatStatus.CONNECTING);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey });
      
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      nextAudioStartTimeRef.current = 0;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
        },
        callbacks: {
          onopen: () => {
            if (!inputAudioContextRef.current || !microphoneStreamRef.current) return;
            setStatus(ChatStatus.LISTENING);
            const source = inputAudioContextRef.current.createMediaStreamSource(microphoneStreamRef.current);
            const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) { int16[i] = inputData[i] * 32768; }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then((s) => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
                const text = message.serverContent.inputTranscription.text;
                currentInputTranscriptionRef.current += text;
                setTranscription(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.speaker === 'user' && !last.isFinal) {
                        return [...prev.slice(0, -1), { ...last, text: currentInputTranscriptionRef.current }];
                    }
                    return [...prev, { speaker: 'user', text: currentInputTranscriptionRef.current, isFinal: false }];
                });
            }

            if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                currentOutputTranscriptionRef.current += text;
                setTranscription(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.speaker === 'bot' && !last.isFinal) {
                        return [...prev.slice(0, -1), { ...last, text: currentOutputTranscriptionRef.current }];
                    }
                    return [...prev, { speaker: 'bot', text: currentOutputTranscriptionRef.current, isFinal: false }];
                });
            }

            if(message.serverContent?.turnComplete) {
                setTranscription(prev => prev.map(entry => ({ ...entry, isFinal: true })));
                currentInputTranscriptionRef.current = '';
                currentOutputTranscriptionRef.current = '';
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              setStatus(ChatStatus.SPEAKING);
              const audioCtx = outputAudioContextRef.current;
              const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioCtx.destination);
              const startTime = Math.max(audioCtx.currentTime, nextAudioStartTimeRef.current);
              source.start(startTime);
              nextAudioStartTimeRef.current = startTime + audioBuffer.duration;
              audioSourcesRef.current.add(source);
              source.onended = () => {
                audioSourcesRef.current.delete(source);
                if (audioSourcesRef.current.size === 0) setStatus(ChatStatus.LISTENING);
              };
            }

            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
              audioSourcesRef.current.clear();
              nextAudioStartTimeRef.current = 0;
            }
          },
          onerror: (e: any) => {
            console.error('Session error:', e);
            setError('We encountered a problem connecting. Please check your API key.');
            setStatus(ChatStatus.ERROR);
            cleanup();
          },
          onclose: () => cleanup(),
        }
      });
      sessionPromiseRef.current = sessionPromise;
      await sessionPromise;

    } catch (err: any) {
      console.error('Startup failed:', err);
      setError(err.message || 'Connection failed.');
      setStatus(ChatStatus.ERROR);
      cleanup();
    }
  };

  const isActive = status !== ChatStatus.IDLE && status !== ChatStatus.ERROR;

  const botSaidThankYou = transcription.some((e) => e.speaker === 'bot' && e.text.includes('Thank you for using the JHN Finance AI Agent!'));
  const showSubmitButton = transcription.length >= 2 && botSaidThankYou && !showFeedback && !isSubmitting;

  const ButtonGroup = (
    <div className="flex flex-col items-center">
         <p className={`text-sm h-5 mb-3 ${status === ChatStatus.ERROR ? 'text-red-500 font-bold' : 'text-gray-600'}`}>
            {status === ChatStatus.CONNECTING ? 'Connecting...' : status === ChatStatus.LISTENING ? 'Listening...' : status === ChatStatus.SPEAKING ? 'AI Speaking...' : status === ChatStatus.IDLE ? 'Ready' : status === ChatStatus.ERROR ? 'Setup Error' : ''}
         </p>
         <button
            onClick={isActive ? stopSession : startSession}
            disabled={isSubmitting}
            className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 text-white shadow-lg focus:outline-none focus:ring-4 focus:ring-opacity-50 ${isActive ? 'bg-red-500 hover:bg-red-600 focus:ring-red-300' : 'bg-purple-500 hover:bg-purple-600 focus:ring-purple-500'} disabled:bg-gray-400 disabled:cursor-not-allowed`}
        >
            <MicrophoneIcon className="h-10 w-10"/>
            {status === ChatStatus.LISTENING && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lime-600 opacity-75"></span>}
            {status === ChatStatus.SPEAKING && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-500 opacity-75"></span>}
        </button>
        <span className="mt-2 text-lg font-semibold text-gray-700">{isActive ? 'Stop' : status === ChatStatus.ERROR ? 'Retry' : 'Speak'}</span>
    </div>
  );

  if (!isOpen) {
    return (
        <div className="w-full max-w-lg mx-auto flex flex-col items-center gap-4">
             <div className="relative bg-purple-700 text-white px-4 py-2 rounded-2xl shadow-lg animate-bounce">
                <p className="text-base font-bold text-center">'Speak' for an AI Instant Quote!”</p>
            </div>
            <button onClick={() => window.open(getChatUrl(), '_blank', 'noopener,noreferrer')} className="w-28 h-28 bg-white rounded-full flex flex-col items-center justify-center gap-1 glow-effect shadow-lg">
                <img src="https://static.wixstatic.com/media/09d8fd_6285ad48bc614daa8fe08d6c1c4d2b25~mv2.png/v1/fill/w_170,h_167,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/JHN%20FINANCE%20SEAL%20ON%20TRANSPARENT.png" alt="Logo" className="h-20 w-20" />
                <MicrophoneIcon className="h-6 w-6 text-purple-600" />
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
            <button onClick={handleClose} className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 p-1 z-10"><CloseIcon className="h-6 w-6" /></button>
            
            <div className="flex-shrink-0 flex flex-col items-center pb-3">
                <img src="https://static.wixstatic.com/media/09d8fd_6285ad48bc614daa8fe08d6c1c4d2b25~mv2.png/v1/fill/w_170,h_167,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/JHN%20FINANCE%20SEAL%20ON%20TRANSPARENT.png" alt="Logo" className="h-16 w-16" />
                <h1 className="text-xl font-bold text-gray-800 mt-1">JHN Finance AI Agent</h1>
            </div>

            <div className="flex-grow my-2 overflow-y-auto px-2 flex flex-col" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
                {status === ChatStatus.ERROR ? (
                    <div className="flex-grow flex flex-col items-center justify-center text-center space-y-4 px-4">
                        <svg className="h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <p className="text-lg font-semibold text-red-600">Connection Issue</p>
                        <p className="text-gray-600 text-sm">{error}</p>
                    </div>
                ) : transcription.length === 0 && !showFeedback ? (
                    <div className="flex-grow flex flex-col items-center justify-center text-center space-y-4">
                        <p className="text-lg font-semibold text-gray-600">Skip the Phone Tag: Start Your Quote Using AI for you and your Broker!</p>
                        <p className="text-sm text-gray-400 italic">Click the microphone below to begin.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {transcription.map((entry, index) => (
                            <div key={index} className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-lg px-3 py-2 ${entry.speaker === 'user' ? 'bg-purple-100 text-purple-800' : 'bg-lime-300 text-lime-900'} ${!entry.isFinal ? 'opacity-70 animate-pulse' : ''}`}>
                                    <p className="text-sm">{entry.text}</p>
                                </div>
                            </div>
                        ))}
                         {showFeedback && (
                            <div className="flex justify-center pt-4">
                                {feedbackSubmitted ? <p className="text-green-600 font-bold">Feedback received. Thank you!</p> : (
                                    <div className="flex flex-col items-center gap-2">
                                        <p className="text-sm font-bold text-gray-600">Rate your experience:</p>
                                        <div className="flex gap-4">
                                            <button onClick={() => setFeedbackSubmitted(true)} className="p-2 bg-gray-100 rounded-full hover:bg-green-100"><ThumbsUpIcon className="w-6 h-6 text-green-600"/></button>
                                            <button onClick={() => setFeedbackSubmitted(true)} className="p-2 bg-gray-100 rounded-full hover:bg-red-100"><ThumbsDownIcon className="w-6 h-6 text-red-600"/></button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                         <div ref={transcriptEndRef} />
                    </div>
                )}
            </div>
            
            {/* Submit quote button: shown after user confirms, fires webhook */}
            {showSubmitButton && (
                 <div className="flex-shrink-0 flex flex-col items-center pt-2 pb-2 border-t">
                    <button
                      onClick={() => handleDataSubmission()}
                      disabled={isSubmitting}
                      className="w-full max-w-xs px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white font-bold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit quote'}
                    </button>
                 </div>
            )}
            {/* Microphone button: always visible in footer (except feedback state) */}
            {!showFeedback && (
                 <div className="flex-shrink-0 flex flex-col items-center pt-3 border-t">
                    {ButtonGroup}
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
