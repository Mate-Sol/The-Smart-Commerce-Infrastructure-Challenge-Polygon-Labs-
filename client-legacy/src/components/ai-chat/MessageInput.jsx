import React, { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Check, X, SlidersHorizontal, Send, Loader2, Paperclip } from "lucide-react";
import { invoiceMateSuggestionsApiConfig } from "./suggestions-api-config";
import { CopilotTextarea } from "@copilotkit/react-textarea";

// Mock hooks since src/hooks/use-audio-recording is not available in the new project structure
const useAudioRecording = () => ({
  isRecording: false,
  isTranscribing: false,
  transcription: "",
  recordingTime: 0,
  error: null,
  setTranscription: () => { },
  setError: () => { },
  startRecording: async () => { },
  stopRecording: () => { },
  waveformContainerRef: useRef(null),
});

const AGENTS = {
  AI_SEARCH: "AI Search",
  BORROWER_PROFILE_TRACKER: "Borrower Profile Tracker",
  PAYMENT_ADVISOR: "Payment Advisor",
};

const DEFAULT_AGENT_KEY = "ai_search";

export default function MessageInput({ handleSubmitPrompt, handleFileUpload, isLoading = false }) {
  const [input, setInput] = useState("");
  const [showAgentPopup, setShowAgentPopup] = useState(false);
  const [selectedAgentKey, setSelectedAgentKey] = useState(DEFAULT_AGENT_KEY);
  const agentMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);

  const {
    isRecording,
    isTranscribing,
    transcription,
    setTranscription,
    startRecording,
    stopRecording,
    waveformContainerRef,
  } = useAudioRecording();

  // Handle outside click for agent popup
  useEffect(() => {
    function handleClickOutside(event) {
      if (agentMenuRef.current && !agentMenuRef.current.contains(event.target)) {
        setShowAgentPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e) => setInput(e.target.value);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    // Simulate upload delay for realism
    setTimeout(() => {
      setIsUploading(false);
      if (handleFileUpload) {
        handleFileUpload(file);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }, 1500);
  };

  const handleSend = (e) => {
    if (e) e.preventDefault();
    if (input.trim() && !isLoading) {
      handleSubmitPrompt(input, AGENTS[selectedAgentKey]);
      setInput("");
    }
  };

  const handleAgentSelect = (agentKey) => {
    setSelectedAgentKey(agentKey);
    setShowAgentPopup(false);
  };

  const handleDeselectAgent = (e) => {
    e.stopPropagation();
    setSelectedAgentKey(DEFAULT_AGENT_KEY);
  };

  const handleVoiceToggle = async () => {
    if (isRecording) stopRecording();
    else await startRecording();
  };

  const handleRecordingConfirm = () => {
    stopRecording();
  };

  const handleRecordingCancel = () => {
    stopRecording();
    setTranscription("");
    setInput("");
  };

  useEffect(() => {
    if (!isRecording && transcription) {
      setInput(transcription);
      setTranscription("");
    }
  }, [transcription]);

  const currentAgentName = AGENTS[selectedAgentKey];
  const isDefaultAgent = selectedAgentKey === DEFAULT_AGENT_KEY;

  return (
    <div className="p-0 bg-transparent relative">
      <div className="bg-white rounded-[24px] px-4 py-3 flex flex-col relative border border-brand-purple/20 shadow-sm">
        <div className="flex-1 w-full">
          {!isRecording && (
            <CopilotTextarea
              value={input}
              className="w-full pt-1 outline-none font-inherit text-lg font-normal text-gray-800 bg-transparent min-h-[48px] max-h-[180px] resize-none"
              placeholder={isDefaultAgent ? "Ask Anything" : `Search with ${currentAgentName}...`}
              onChange={handleInputChange}
              disabled={isLoading || isTranscribing}
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              autosuggestionsConfig={{
                textareaPurpose: 'Drafting InvoiceMate and DEFA-related queries and information',
                chatApiConfigs: {
                  suggestionsApiConfig: invoiceMateSuggestionsApiConfig,
                },
              }}
              rows={2}
            />
          )}

          <div
            ref={waveformContainerRef}
            className={`z-[111111] bg-white ${isRecording ? "block" : "hidden"}`}
          />
        </div>

        <div className="flex flex-row items-center justify-between pt-2 border-t border-gray-100 w-full mt-2">
          {/* Left: Tools, agent chip, agent selector */}
          <div className="flex items-center gap-2 relative mt-1">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isLoading}
              title="Upload Document"
              className="flex items-center text-gray-500 hover:bg-brand-purple/5 hover:text-brand-purple p-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="w-5 h-5 animate-spin text-brand-purple" /> : <Paperclip className="w-5 h-5" />}
            </button>

            {/* <button
              onClick={() => setShowAgentPopup(!showAgentPopup)}
              className="flex items-center text-brand-purple hover:bg-brand-purple/5 p-1.5 rounded-lg transition-colors"
            >
              <SlidersHorizontal className="w-5 h-5 mr-1.5" />
              <span className="text-sm font-medium mr-1">Tools</span>
            </button> */}

            {!isDefaultAgent && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-brand-purple/10 text-brand-purple rounded-full font-medium text-xs">
                <span>{currentAgentName}</span>
                <button onClick={handleDeselectAgent} className="hover:bg-brand-purple/20 rounded-full p-0.5">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {showAgentPopup && (
              <div ref={agentMenuRef} className="absolute bottom-full left-0 mb-2 w-64 max-h-60 overflow-y-auto bg-white rounded-xl shadow-lg border border-gray-100 z-50 py-1">
                {Object.entries(AGENTS).map(([key, value]) => (
                  <button
                    key={key}
                    onClick={() => handleAgentSelect(key)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between text-sm transition-colors hover:bg-gray-50 ${selectedAgentKey === key ? 'text-brand-purple bg-brand-purple/5 font-medium' : 'text-gray-700'}`}
                  >
                    <span>{value}</span>
                    {selectedAgentKey === key && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Mic/Recording Controls and Send */}
          <div className="flex items-center gap-2">
            {isRecording ? (
              <>
                <button
                  onClick={handleRecordingCancel}
                  disabled={isTranscribing}
                  className="w-10 h-10 rounded-full bg-gray-800 text-white flex items-center justify-center hover:bg-red-500 transition-colors disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
                <button
                  onClick={handleRecordingConfirm}
                  disabled={isTranscribing}
                  className="w-10 h-10 rounded-full bg-brand-purple/80 text-white flex items-center justify-center hover:bg-brand-purple transition-colors disabled:opacity-50"
                >
                  {isTranscribing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleVoiceToggle}
                  disabled={isLoading || isTranscribing}
                  className="w-10 h-10 rounded-full bg-brand-purple/5 text-brand-purple flex items-center justify-center hover:bg-brand-purple/10 transition-colors disabled:opacity-50"
                >
                  <MicOff className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="w-11 h-11 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}