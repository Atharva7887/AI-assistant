import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from "../utils/audio";
import { BusinessConfig, SummaryResult, TranscriptItem } from "../types";

// Configuration for audio contexts
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

let audioContext: AudioContext | null = null;
let inputAudioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let sourceInput: MediaStreamAudioSourceNode | null = null;
let nextStartTime = 0;
let session: any = null; // Holds the active live session

// Helper to generate system instruction based on user config
const getSystemInstruction = (config: BusinessConfig) => {
  const languageInstruction = config.language === 'English' 
    ? "Speak in English."
    : `Speak in ${config.language}. You must understand and reply in ${config.language}. If the user speaks another language, politely steer them to ${config.language} or answer in their language if necessary, but prioritize ${config.language}.`;

  return `You are an AI assistant for "${config.businessName}". Your role is "${config.role}". 
  Context about the business: ${config.context}.
  
  Language Requirement: ${languageInstruction}
  
  Your goals:
  1. Be professional, polite, and helpful.
  2. Answer questions based on general knowledge and common business practices.
  3. If you don't know something, ask for clarification or offer to take a message.
  4. Keep responses concise and conversational (spoken word style).
  
  IMPORTANT: You are speaking via voice. Do not use markdown, lists, or complex formatting in your speech. Speak naturally.`;
};

export const startLiveSession = async (
  config: BusinessConfig,
  onTranscriptUpdate: (text: string, isUser: boolean, isFinal: boolean) => void,
  onAudioData: (amplitude: number) => void, // For visualizer
  onClose: () => void,
  onError: (err: Error) => void
) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Initialize Audio Contexts
    inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
    
    nextStartTime = audioContext.currentTime;

    // Get Microphone Stream
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Setup Audio Output Node
    const outputNode = audioContext.createGain();
    outputNode.connect(audioContext.destination);

    // Current Transcription Buffers
    let currentInputTranscription = '';
    let currentOutputTranscription = '';

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: async () => {
          console.log("Gemini Live Session Opened");
          
          if (!inputAudioContext || !mediaStream) return;

          sourceInput = inputAudioContext.createMediaStreamSource(mediaStream);
          processor = inputAudioContext.createScriptProcessor(4096, 1, 1);
          
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Calculate amplitude for visualizer
            let sum = 0;
            for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
            const rms = Math.sqrt(sum / inputData.length);
            onAudioData(rms * 5); // Scale up a bit for visualizer

            const pcmBlob = createPcmBlob(inputData);
            
            sessionPromise.then((sess) => {
               sess.sendRealtimeInput({ media: pcmBlob });
            });
          };

          sourceInput.connect(processor);
          processor.connect(inputAudioContext.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          // Handle Audio Output
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          
          if (base64Audio && audioContext) {
            // Visualizer feedback for AI speaking (simulated by random or smooth data)
            onAudioData(0.5); 

            nextStartTime = Math.max(nextStartTime, audioContext.currentTime);
            
            const audioBuffer = await decodeAudioData(
              base64ToUint8Array(base64Audio),
              audioContext,
              OUTPUT_SAMPLE_RATE,
              1
            );

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(outputNode);
            source.start(nextStartTime);
            nextStartTime += audioBuffer.duration;
          }

          // Handle Transcriptions
          if (message.serverContent?.outputTranscription) {
            const text = message.serverContent.outputTranscription.text;
            currentOutputTranscription += text;
            onTranscriptUpdate(currentOutputTranscription, false, false);
          } else if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            currentInputTranscription += text;
            onTranscriptUpdate(currentInputTranscription, true, false);
          }

          if (message.serverContent?.turnComplete) {
            // Finalize turns
            if (currentInputTranscription.trim()) {
                onTranscriptUpdate(currentInputTranscription, true, true);
                currentInputTranscription = '';
            }
            if (currentOutputTranscription.trim()) {
                onTranscriptUpdate(currentOutputTranscription, false, true);
                currentOutputTranscription = '';
            }
          }
          
          // Handle Interruption
          if (message.serverContent?.interrupted && audioContext) {
             // We can't easily stop specific nodes without tracking them all, 
             // but resetting time helps sync.
             nextStartTime = audioContext.currentTime;
             currentOutputTranscription = ''; // Clear partial text on interrupt
          }
        },
        onclose: () => {
          console.log("Session Closed");
          onClose();
        },
        onerror: (err) => {
          console.error("Session Error", err);
          onError(new Error("Connection error occurred."));
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName || 'Fenrir' } }
        },
        systemInstruction: getSystemInstruction(config),
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      }
    });

    session = await sessionPromise;
    return session;

  } catch (error: any) {
    console.error("Failed to start session:", error);
    onError(error);
    throw error;
  }
};

export const stopLiveSession = () => {
  if (processor && inputAudioContext) {
    processor.disconnect();
    if (sourceInput) sourceInput.disconnect();
    processor = null;
    sourceInput = null;
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (session) {
    // There isn't a direct .close() on the session object in some versions of the SDK interface,
    // but disconnecting the stream and letting the object GC usually works.
    // However, if the SDK supports it:
    if (typeof session.close === 'function') {
        session.close();
    }
    session = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  if (inputAudioContext) {
    inputAudioContext.close();
    inputAudioContext = null;
  }
};

export const generateMeetingSummary = async (transcripts: TranscriptItem[]): Promise<SummaryResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Format transcript for the model
  const conversationText = transcripts
    .map(t => `${t.role.toUpperCase()}: ${t.text}`)
    .join('\n');

  const prompt = `Analyze the following conversation between a business assistant and a user.
  
  Conversation:
  ${conversationText}

  Please provide:
  1. A concise summary of the call.
  2. A list of action items or key points noted.
  3. The detected sentiment of the user (Positive, Neutral, Negative).

  Return ONLY valid JSON in this format:
  {
    "summary": "string",
    "actionItems": ["string", "string"],
    "sentiment": "string"
  }`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
            summary: { type: Type.STRING },
            actionItems: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
            },
            sentiment: { type: Type.STRING }
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No summary generated");
  
  return JSON.parse(text) as SummaryResult;
};