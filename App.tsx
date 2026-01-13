import React, { useState, useEffect, useRef } from 'react';
import { 
  Phone, 
  PhoneOff, 
  Settings, 
  FileText, 
  Mic, 
  Loader2, 
  CheckCircle2, 
  Building2, 
  UserCircle,
  Languages,
  PhoneCall,
  Save,
  Trash2,
  AlertCircle,
  Volume2
} from 'lucide-react';
import AudioVisualizer from './components/AudioVisualizer';
import { startLiveSession, stopLiveSession, generateMeetingSummary } from './services/gemini';
import { makeTwilioCall } from './services/twilio';
import { AppState, BusinessConfig, TranscriptItem, SummaryResult, Language } from './types';

/**
 * ==============================================================================
 * CONFIGURATION INSTRUCTIONS
 * ==============================================================================
 * To deploy or run this application, you must set the following Environment Variables
 * in your .env file (local) or your Deployment Platform Settings (Netlify/Vercel).
 * 
 * API_KEY:                     Your Google Gemini API Key.
 * TWILIO_ACCOUNT_SID:          Your Twilio Account SID.
 * TWILIO_AUTH_TOKEN:           Your Twilio Auth Token.
 * TWILIO_PHONE_NUMBER:         Your Twilio Phone Number (e.g., +1234567890).
 * TWILIO_VERIFIED_CALLER_ID:   Your personal phone number (to bridge calls).
 * ==============================================================================
 */

const INITIAL_CONFIG: BusinessConfig = {
  businessName: "Acme Corp",
  role: "Executive Assistant",
  context: "You are handling general inquiries, scheduling appointments, and taking messages for the CEO.",
  language: 'English',
  voiceName: 'Fenrir', // Default to Male voice
  twilio: {
    // These values are pulled from environment variables for security.
    accountSid: process.env.TWILIO_ACCOUNT_SID || "", 
    authToken: process.env.TWILIO_AUTH_TOKEN || "", 
    myPhoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
    verifiedCallerId: process.env.TWILIO_VERIFIED_CALLER_ID || "" 
  }
};

const VOICE_OPTIONS = [
  { name: 'Fenrir', label: 'Fenrir (Male, Deep)', gender: 'Male' },
  { name: 'Puck', label: 'Puck (Male, Standard)', gender: 'Male' },
  { name: 'Charon', label: 'Charon (Male, Deep)', gender: 'Male' },
  { name: 'Kore', label: 'Kore (Female)', gender: 'Female' },
  { name: 'Zephyr', label: 'Zephyr (Female)', gender: 'Female' },
];

export default function App() {
  // Load config from LocalStorage if available, else use INITIAL_CONFIG
  const [config, setConfig] = useState<BusinessConfig>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('bizvoice_config');
        if (saved) {
            try {
                // Merge saved config with initial to ensure new fields are present
                const parsed = JSON.parse(saved);
                return { 
                    ...INITIAL_CONFIG, 
                    ...parsed,
                    twilio: { ...INITIAL_CONFIG.twilio, ...parsed.twilio }
                };
            } catch(e) {
                console.error("Failed to load config", e);
            }
        }
    }
    return INITIAL_CONFIG;
  });

  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [amplitude, setAmplitude] = useState<number>(0);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Dialer State
  const [dialNumber, setDialNumber] = useState("");
  const [isDialing, setIsDialing] = useState(false);
  const [activeTab, setActiveTab] = useState<'assistant' | 'phone'>('assistant');

  const transcriptsRef = useRef<TranscriptItem[]>([]);

  // Auto-save config whenever it changes
  useEffect(() => {
    localStorage.setItem('bizvoice_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  const resetConfig = () => {
    if(confirm("Are you sure you want to reset all settings to default?")) {
        setConfig(INITIAL_CONFIG);
        localStorage.removeItem('bizvoice_config');
    }
  };

  const handleStartCall = async (skipTwilio = false) => {
    // 1. Validation Checks
    if (!process.env.API_KEY) {
        setAppState(AppState.ERROR);
        setErrorMsg("API Key Not Found. Please set process.env.API_KEY in your environment variables.");
        return;
    }

    if (!skipTwilio && activeTab === 'phone') {
        if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.myPhoneNumber) {
            setAppState(AppState.ERROR);
            setErrorMsg("Twilio credentials missing. Please configure them in Settings.");
            setShowConfig(true);
            return;
        }

        if (!config.twilio.verifiedCallerId || config.twilio.verifiedCallerId.length < 5) {
            setAppState(AppState.ERROR);
            setErrorMsg("Please enter 'Your Phone Number' in the dialer. Twilio needs this to connect the call to you.");
            return;
        }
        if (!dialNumber) {
            setAppState(AppState.ERROR);
            setErrorMsg("Please enter a customer number to dial.");
            return;
        }
    }

    try {
      setAppState(AppState.CONNECTING);
      setErrorMsg(null);
      setTranscripts([]);
      setSummary(null);

      // 2. Start Gemini Assistant
      await startLiveSession(
        config,
        (text, isUser, isFinal) => {
          setTranscripts(prev => {
            const now = new Date();
            if (isFinal) {
                const last = prev[prev.length - 1];
                if (last && last.isPartial && last.role === (isUser ? 'user' : 'assistant')) {
                    const newHistory = [...prev];
                    newHistory[newHistory.length - 1] = { role: isUser ? 'user' : 'assistant', text, timestamp: now, isPartial: false };
                    return newHistory;
                }
                return [...prev, { role: isUser ? 'user' : 'assistant', text, timestamp: now, isPartial: false }];
            } else {
                 const last = prev[prev.length - 1];
                 if (last && last.isPartial && last.role === (isUser ? 'user' : 'assistant')) {
                     const newHistory = [...prev];
                     newHistory[newHistory.length - 1] = { ...last, text, timestamp: now };
                     return newHistory;
                 }
                 return [...prev, { role: isUser ? 'user' : 'assistant', text, timestamp: now, isPartial: true }];
            }
          });
        },
        (amp) => setAmplitude(amp),
        () => {
           if (appState !== AppState.SUMMARIZING && appState !== AppState.SUMMARY_VIEW) {
             setAppState(AppState.IDLE);
           }
        },
        (err) => {
           setErrorMsg(err.message || "Connection failed");
           setAppState(AppState.ERROR);
        }
      );

      // 3. Start Twilio Call (if applicable)
      if (!skipTwilio && activeTab === 'phone' && dialNumber) {
        setIsDialing(true);
        await makeTwilioCall(config.twilio, dialNumber, config.twilio.verifiedCallerId);
        setIsDialing(false);
      }

      setAppState(AppState.ACTIVE);
    } catch (e: any) {
      console.error(e);
      setIsDialing(false);
      setAppState(AppState.ERROR);
      
      let message = e.message || "Failed to start services.";
      
      // Friendly error handling for common Twilio issues
      if (message.includes("401") || message.includes("Unauthorized") || message.includes("Authenticate")) {
         message = "Twilio Authentication Failed: Please check your Account SID and Auth Token in Settings.";
         setShowConfig(true); // Open settings to help user fix it
      } else if (message.includes("CORS") || message.includes("Failed to fetch")) {
         message = "Network Error: Browser blocked the request to Twilio. Please check your network or CORS settings.";
      }
      
      setErrorMsg(message);
    }
  };

  const handleEndCall = async () => {
    stopLiveSession();
    setAmplitude(0);
    setIsDialing(false);
    
    if (transcripts.length > 0) {
      setAppState(AppState.SUMMARIZING);
      try {
        const result = await generateMeetingSummary(transcripts);
        setSummary(result);
        setAppState(AppState.SUMMARY_VIEW);
      } catch (e) {
        console.error("Summary failed", e);
        setErrorMsg("Call ended, but failed to generate summary.");
        setAppState(AppState.ERROR);
      }
    } else {
      setAppState(AppState.IDLE);
    }
  };

  const renderConfig = () => (
    <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-2xl shadow-2xl border border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2 text-indigo-400">
            <Settings size={20} /> Configuration
            </h2>
            <button onClick={resetConfig} className="text-slate-500 hover:text-rose-400 transition-colors" title="Reset to Defaults">
                <Trash2 size={18} />
            </button>
        </div>
        
        <div className="space-y-6">
          {/* General Config */}
          <section className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Assistant Settings</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Business Name</label>
                    <input 
                    type="text" 
                    value={config.businessName}
                    onChange={e => setConfig({...config, businessName: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Role</label>
                    <input 
                    type="text" 
                    value={config.role}
                    onChange={e => setConfig({...config, role: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Context</label>
                <textarea 
                  value={config.context}
                  onChange={e => setConfig({...config, context: e.target.value})}
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-sm"
                />
              </div>

              {/* Voice Selector */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Voice</label>
                <div className="relative">
                    <select
                        value={config.voiceName}
                        onChange={e => setConfig({...config, voiceName: e.target.value})}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-indigo-500 outline-none appearance-none text-sm"
                    >
                        {VOICE_OPTIONS.map(v => (
                            <option key={v.name} value={v.name}>{v.label}</option>
                        ))}
                    </select>
                    <Volume2 size={14} className="absolute right-3 top-3 text-slate-500 pointer-events-none" />
                </div>
              </div>
          </section>

          {/* Twilio Config */}
          <section className="space-y-4 pt-4 border-t border-slate-700">
             <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                 <PhoneCall size={14} /> Twilio Configuration
             </h3>
             <div className="bg-slate-900/50 p-4 rounded-xl space-y-3">
                 <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Account SID</label>
                    <input 
                        type="text" 
                        value={config.twilio.accountSid}
                        onChange={e => setConfig({...config, twilio: {...config.twilio, accountSid: e.target.value}})}
                        placeholder="AC..."
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1 flex justify-between">
                        <span>Auth Token</span>
                        <span className="text-rose-400">Required for calls</span>
                    </label>
                    <input 
                        type="password" 
                        placeholder="Paste your Twilio Auth Token here"
                        value={config.twilio.authToken}
                        onChange={e => setConfig({...config, twilio: {...config.twilio, authToken: e.target.value}})}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">My Twilio Number</label>
                        <input 
                            type="text" 
                            value={config.twilio.myPhoneNumber}
                            onChange={e => setConfig({...config, twilio: {...config.twilio, myPhoneNumber: e.target.value}})}
                            placeholder="+1..."
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                     </div>
                 </div>
             </div>
          </section>

          <button 
            onClick={() => setShowConfig(false)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Save size={18} /> Close & Save
          </button>
        </div>
      </div>
    </div>
  );

  const renderSummary = () => (
    <div className="max-w-2xl mx-auto w-full bg-slate-800 rounded-2xl overflow-hidden shadow-xl border border-slate-700 animate-fade-in">
        <div className="bg-slate-700/50 p-6 border-b border-slate-700 flex justify-between items-center">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <FileText className="text-indigo-400" /> Call Summary
            </h2>
            <button 
                onClick={() => setAppState(AppState.IDLE)}
                className="text-sm bg-slate-600 hover:bg-slate-500 px-4 py-2 rounded-full transition-colors"
            >
                Close
            </button>
        </div>
        <div className="p-6 space-y-6">
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">Overview</h3>
                <p className="text-slate-200 leading-relaxed">{summary?.summary}</p>
            </div>
            
            <div className="flex gap-4 flex-col sm:flex-row">
                <div className="flex-1 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                     <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Action Items</h3>
                     <ul className="space-y-2">
                        {summary?.actionItems.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-slate-300 text-sm">
                                <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                                <span>{item}</span>
                            </li>
                        ))}
                        {(!summary?.actionItems || summary.actionItems.length === 0) && (
                            <li className="text-slate-500 italic text-sm">No specific action items detected.</li>
                        )}
                     </ul>
                </div>
                <div className="sm:w-1/3 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                    <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">Sentiment</h3>
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium
                        ${summary?.sentiment.toLowerCase().includes('positive') ? 'bg-emerald-500/20 text-emerald-400' : 
                          summary?.sentiment.toLowerCase().includes('negative') ? 'bg-rose-500/20 text-rose-400' : 'bg-blue-500/20 text-blue-400'}`}>
                        {summary?.sentiment}
                    </div>
                </div>
            </div>

            <div className="mt-8 border-t border-slate-700 pt-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">Transcript</h3>
                <div className="space-y-4 max-h-60 overflow-y-auto pr-2 scrollbar-hide">
                    {transcripts.map((t, i) => (
                         <div key={i} className={`flex gap-3 ${t.role === 'assistant' ? 'flex-row' : 'flex-row-reverse'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${t.role === 'assistant' ? 'bg-indigo-600' : 'bg-slate-600'}`}>
                                {t.role === 'assistant' ? <Building2 size={14} /> : <UserCircle size={14} />}
                            </div>
                            <div className={`p-3 rounded-2xl max-w-[80%] text-sm ${t.role === 'assistant' ? 'bg-indigo-900/30 text-indigo-100 rounded-tl-none' : 'bg-slate-700 text-slate-100 rounded-tr-none'}`}>
                                {t.text}
                            </div>
                         </div>
                    ))}
                </div>
            </div>
        </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[128px] pointer-events-none" />

      {/* Header */}
      <header className="w-full p-6 flex justify-between items-center z-10 max-w-6xl">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mic size={18} className="text-white" />
           </div>
           <span className="font-bold text-xl tracking-tight">BizVoice<span className="text-indigo-400">AI</span></span>
        </div>
        
        {/* Language Selection in Header for visibility */}
        <div className="flex items-center gap-4">
             <div className="relative hidden md:block">
                <select
                    value={config.language}
                    onChange={e => setConfig({...config, language: e.target.value as Language})}
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2.5 pr-8 appearance-none"
                >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Marathi">Marathi</option>
                </select>
                <Languages size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
             </div>

            <button 
            onClick={() => setShowConfig(true)}
            className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
            disabled={appState === AppState.ACTIVE || appState === AppState.CONNECTING}
            >
            <Settings size={20} />
            </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-4xl flex flex-col justify-center items-center p-6 z-10">
        
        {showConfig && renderConfig()}

        {appState === AppState.ERROR && (
           <div className="bg-rose-500/10 border border-rose-500/20 text-rose-200 px-6 py-4 rounded-xl mb-8 flex items-start gap-3 max-w-md w-full animate-fade-in-up">
              <AlertCircle className="text-rose-400 shrink-0 mt-0.5" size={24} />
              <div className="flex-1">
                  <p className="font-semibold text-rose-300">Connection Error</p>
                  <p className="text-sm opacity-90 break-words mt-1">{errorMsg || "An unknown error occurred."}</p>
              </div>
              <button onClick={() => setAppState(AppState.IDLE)} className="text-rose-300 hover:text-white transition-colors">
                  Dismiss
              </button>
           </div>
        )}

        {appState === AppState.SUMMARY_VIEW && renderSummary()}

        {(appState === AppState.IDLE || appState === AppState.CONNECTING || appState === AppState.ACTIVE || appState === AppState.SUMMARIZING) && (
            <div className="flex flex-col items-center w-full">
                
                {/* Mode Selector */}
                {appState === AppState.IDLE && (
                    <div className="mb-8 flex gap-2 bg-slate-800 p-1 rounded-full shadow-lg">
                        <button 
                            onClick={() => setActiveTab('assistant')}
                            className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${activeTab === 'assistant' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
                        >
                            Voice Mode
                        </button>
                        <button 
                            onClick={() => setActiveTab('phone')}
                            className={`px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'phone' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
                        >
                            <PhoneCall size={14} /> Phone Call
                        </button>
                    </div>
                )}
                
                {/* Mobile Language Selector (if on mobile) */}
                {appState === AppState.IDLE && (
                    <div className="md:hidden mb-6 relative w-48">
                        <select
                            value={config.language}
                            onChange={e => setConfig({...config, language: e.target.value as Language})}
                            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2.5 pr-8 appearance-none text-center"
                        >
                            <option value="English">Speak: English</option>
                            <option value="Hindi">Speak: Hindi</option>
                            <option value="Marathi">Speak: Marathi</option>
                        </select>
                        <Languages size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
                    </div>
                )}

                {/* Status Indicator */}
                <div className={`mb-8 px-4 py-1.5 rounded-full text-sm font-medium border flex items-center gap-2 transition-all duration-300
                    ${appState === AppState.ACTIVE ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 
                      appState === AppState.CONNECTING ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                      appState === AppState.SUMMARIZING ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
                      'bg-slate-800 border-slate-700 text-slate-400'}`}>
                    <div className={`w-2 h-2 rounded-full ${appState === AppState.ACTIVE ? 'bg-emerald-500 animate-pulse' : appState === AppState.CONNECTING ? 'bg-amber-500 animate-bounce' : 'bg-slate-500'}`} />
                    {appState === AppState.IDLE && `Ready to assist in ${config.language}`}
                    {appState === AppState.CONNECTING && (isDialing ? "Dialing & Connecting..." : "Connecting...")}
                    {appState === AppState.ACTIVE && "Active Session"}
                    {appState === AppState.SUMMARIZING && "Generating Summary..."}
                </div>

                {/* Visualizer / Call Interface */}
                {activeTab === 'phone' && appState === AppState.IDLE ? (
                    <div className="w-full max-w-sm bg-slate-800 p-6 rounded-3xl border border-slate-700 mb-8 shadow-2xl space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider text-center">Dial Customer</label>
                            <input 
                                type="tel"
                                placeholder="+1 (555) 000-0000"
                                value={dialNumber}
                                onChange={(e) => setDialNumber(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 text-center text-2xl py-4 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono placeholder:text-slate-700"
                            />
                        </div>
                        
                        <div className="pt-2 border-t border-slate-700">
                             <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider text-center flex items-center justify-center gap-1">
                                Your Phone <span className="normal-case opacity-50 font-normal">(for bridging)</span>
                             </label>
                             <input 
                                type="tel"
                                placeholder="+1..."
                                value={config.twilio.verifiedCallerId || ''}
                                onChange={(e) => setConfig({...config, twilio: {...config.twilio, verifiedCallerId: e.target.value}})}
                                className="w-full bg-slate-900 border border-slate-700 text-center text-sm py-2 rounded-lg text-indigo-300 focus:ring-1 focus:ring-indigo-500 outline-none font-mono placeholder:text-slate-700"
                             />
                             <p className="text-[10px] text-center text-slate-500 mt-2 leading-tight">
                                Twilio will call <strong>Your Phone</strong> first, then connect you to the Customer. Put your phone on <strong>Speaker</strong> so AI can hear.
                             </p>
                        </div>
                    </div>
                ) : (
                    <div className="relative mb-12">
                        <AudioVisualizer isActive={appState === AppState.ACTIVE} amplitude={amplitude} />
                        
                        {/* Context Overlay inside visualizer circle (Subtle) */}
                        {appState === AppState.ACTIVE && (
                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                                <p className="text-xs text-indigo-200/50 uppercase tracking-widest font-semibold">
                                    {isDialing ? 'Dialing...' : 'Listening'}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Controls */}
                <div className="flex items-center gap-6">
                   {appState === AppState.IDLE ? (
                        <button 
                            onClick={() => handleStartCall(activeTab !== 'phone')}
                            disabled={activeTab === 'phone' && (!dialNumber || !config.twilio.verifiedCallerId)}
                            className={`group relative flex items-center justify-center w-20 h-20 rounded-full shadow-2xl transition-all transform hover:scale-105 disabled:opacity-50 disabled:scale-100
                                ${activeTab === 'phone' ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/30' : 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/30'}`}
                        >
                            {activeTab === 'phone' ? <PhoneCall size={32} className="text-white" /> : <Mic size={32} className="text-white fill-current" />}
                            <span className="absolute -bottom-10 text-sm font-medium text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                {activeTab === 'phone' ? 'Dial' : 'Start'}
                            </span>
                        </button>
                   ) : appState === AppState.ACTIVE ? (
                        <button 
                            onClick={handleEndCall}
                            className="group relative flex items-center justify-center w-20 h-20 bg-rose-500 hover:bg-rose-400 rounded-full shadow-2xl shadow-rose-500/30 transition-all transform hover:scale-105"
                        >
                            <PhoneOff size={32} className="text-white" />
                            <span className="absolute -bottom-10 text-sm font-medium text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">End Call</span>
                        </button>
                   ) : appState === AppState.SUMMARIZING || appState === AppState.CONNECTING ? (
                       <div className="w-20 h-20 rounded-full border-4 border-slate-700 border-t-indigo-500 animate-spin" />
                   ) : null}
                </div>

                {/* Current Transcript Snippet (Live feedback) */}
                {appState === AppState.ACTIVE && transcripts.length > 0 && (
                    <div className="mt-12 w-full max-w-md text-center space-y-2 animate-fade-in-up">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Live Transcript</p>
                        <p className="text-lg text-slate-200 font-light leading-relaxed">
                            "{transcripts[transcripts.length - 1].text}"
                        </p>
                    </div>
                )}
            </div>
        )}
      </main>

      <footer className="w-full p-6 text-center text-slate-600 text-sm z-10">
        <p>Powered by Gemini 2.5 Live API & Twilio</p>
      </footer>
    </div>
  );
}