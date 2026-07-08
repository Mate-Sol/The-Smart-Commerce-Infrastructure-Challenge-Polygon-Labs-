import {
  useCoAgent,
  useCopilotChat
} from '@copilotkit/react-core';
import '@copilotkit/react-ui/styles.css';
import { AgentStateMessage, Role, TextMessage } from '@copilotkit/runtime-client-gql';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { v4 as generateUUID } from 'uuid';
import toast from 'react-hot-toast';
import AISuggestions from './ai-suggestions';
import MessageInput from './MessageInput';
import { CheckCircle, Loader2, StopCircle, Bot, FileText, Star, Upload, Handshake, AlertTriangle, Calculator, TrendingDown, ShieldAlert, FileSearch } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PREPAID_PROMPTS = [
  {
    icon: <AlertTriangle className="w-6 h-6" />,
    title: 'Critical Risk Factors',
    prompt: 'Which risk factor could break this deal if not managed properly?',
  },
  {
    icon: <Calculator className="w-6 h-6" />,
    title: 'Score Breakdown',
    prompt: 'Explain how the score of 89/100 was calculated',
  },
  {
    icon: <TrendingDown className="w-6 h-6" />,
    title: 'Volume Drop Impact',
    prompt: 'What happens if transaction volumes drop by 30%?',
  },
  {
    icon: <ShieldAlert className="w-6 h-6" />,
    title: 'Counterparty Default',
    prompt: 'What happens if a major counterparty defaults?',
  },
  // {
  //   icon: <FileSearch className="w-6 h-6" />,
  //   title: 'Data & Reporting Risks',
  //   prompt: 'Are there any signs of over-reporting or data risk?',
  // },
];

const AGENTS = {
  AI_INTERN: 'AI Search',
  PANDA: 'AI Search',
  AI_FUNDING: 'AI Search',
  AI_SEARCH: 'AI Search',
  CARA_AGENT: 'CARA AGENT',
  CARA_AGENT_LENDER_ANALYSIS: 'CARA AGENT ANALYZER',
};

export const initialState = {
  name: '',
  model: undefined,
  logs: [],
  messagesData: [],
  agent: '',
  user_input: '',
  system_instructions: undefined,
  history: [],
  streaming: {
    current_token: undefined,
  },
  Defa_data: {
    data: undefined,
    error: undefined,
  },
  follow_up: [],
  question_type: 'AI Intern',
  search_info: {
    strategy: undefined,
    rephrased_text: undefined,
    documents: undefined,
  },
  azure_ai_response: undefined,
  agent_call: '',
  thread_id: undefined,
};

export const InitialStateArray = {
  history_state: [initialState],
  thread_id: null,
  borrower_id: null,
};

export default function AIChatView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const messagesEndRef = useRef(null);
  const [questionaireStatus, setQuestionaireStatus] = useState(true);
  const [isNewChat, SetIsNewChat] = useState(false);
  const userId = user?.id || '';

  const [searchParams] = useSearchParams();
  const threadId = searchParams.get('threadId');

  const {
    visibleMessages,
    appendMessage,
    setMessages,
    deleteMessage,
    reloadMessages,
    stopGeneration,
    isLoading,
  } = useCopilotChat();

  const { state, setState, stop } = useCoAgent({
    name: 'conversation_agent',
    initialState: InitialStateArray,
  });

  useEffect(() => {
    document.title = 'AI Chat Assistant | Mate Finance';
  }, []);

  useEffect(() => {
    if (threadId === "start-chat" && state?.thread_id) {
      SetIsNewChat(true);
      navigate("/ai-chat?threadId=" + state?.thread_id);
    }
  }, [state?.thread_id, navigate, threadId]);

  const sendMessage = async (content, agent) => {
    try {
      if (visibleMessages.length === 0 && !state.thread_id) {
        navigate("/ai-chat?threadId=start-chat");
      }

      setState((prevState) => {
        const newHistoryState = {
          ...initialState,
          user_input: content,
          agent: 'ai_search' || AGENTS.PANDA,
          logs: [],
          borrower_id: userId,
          thread_id: threadId !== 'new-chat' ? threadId : null,
        };

        return {
          ...prevState,
          history_state: [...prevState.history_state, newHistoryState],
          borrower_id: userId,
          thread_id: threadId !== 'new-chat' ? threadId : null,
        };
      });

      appendMessage(
        new TextMessage({
          content,
          role: Role.User,
          id: `ck-${generateUUID()}`,
          status: { code: 'Success' },
          createdAt: new Date().toISOString(),
          type: 'TextMessage',
        })
      );
    } catch (error) {
      console.error('Error in sendMessage:', error);
    }
  };

  const handleSend = async (input, agent) => {
    if (!input.trim() || state.running) return;
    sendMessage(input, agent || AGENTS.AI_INTERN);
  };

  const handleFileUpload = async (file) => {
    try {
      if (visibleMessages.length === 0 && !state.thread_id) {
        navigate("/ai-chat?threadId=start-chat");
      }

      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      const fileUrl = URL.createObjectURL(file);
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';

      let userMsgContent = '';
      if (isImage) {
        userMsgContent = `![${file.name}](${fileUrl})`;
      } else if (isPdf) {
        userMsgContent = `[PDF_PREVIEW_${file.name}](${fileUrl})`;
      } else {
        userMsgContent = `📎 **Attached Document:** ${file.name}\n*Size: ${fileSizeMB} MB*`;
      }

      const userMessage = new TextMessage({
        content: userMsgContent,
        role: Role.User,
        id: `ck-${generateUUID()}`,
        status: { code: 'Success' },
        createdAt: new Date().toISOString(),
        type: 'TextMessage',
      });
      // Push it directly to messages instead of appending to avoid triggering AI response
      setMessages([...visibleMessages, userMessage]);

      // 2. Simulate AI processing and responding to the document
      setTimeout(() => {
        const aiMsg = new TextMessage({
          content: `I've successfully received and processed **${file.name}**. I've added it to my context window.\n\nHow can I help you analyze or extract information from this document today?`,
          role: Role.Assistant,
          id: `a-${generateUUID()}`,
          status: { code: 'Success' },
          createdAt: new Date().toISOString(),
          type: 'TextMessage',
        })

        setMessages((prevMessages) => [...prevMessages, aiMsg]);
      }, 1500);


    } catch (error) {
      console.error('Error in handleFileUpload:', error);
      toast.error('Failed to process document');
    }
  };

  function transformMessages(inputData) {
    const messages = [];
    inputData.forEach((historyState) => {
      historyState.messagesData.forEach((message) => {
        if (message.type === "constructor") {
          const content = message.kwargs.content;
          const type = message.kwargs.type;

          if (type === "human") {
            messages.push(
              new TextMessage({
                content,
                role: Role.User,
                id: `ck-${generateUUID()}`,
                status: { code: "Success" },
                createdAt: new Date().toISOString(),
                type: "TextMessage",
              })
            );

            messages.push(
              new AgentStateMessage({
                id: `ck-${generateUUID()}`,
                role: Role.Assistant,
                agentName: "conversation_agent",
                nodeName: "ai_intern",
                runId: generateUUID(),
                active: true,
                running: true,
                state: { history_state: [historyState] },
                createdAt: new Date().toISOString(),
                status: { code: "Success" },
                type: "AgentStateMessage",
              })
            );
          } else if (type === "ai" || type === "tool") {
            messages.push(
              new TextMessage({
                content,
                role: Role.Assistant,
                id: `a-${generateUUID()}`,
                status: { code: "Success" },
                createdAt: new Date().toISOString(),
                type: "TextMessage",
              })
            );
          }
        } else {
          const { content, type } = message;

          if (type === "human") {
            messages.push(
              new TextMessage({
                content,
                role: Role.User,
                id: message.id || `ck-${generateUUID()}`,
                status: { code: "Success" },
                createdAt: new Date().toISOString(),
                type: "TextMessage",
              })
            );

            messages.push(
              new AgentStateMessage({
                id: `ck-${generateUUID()}`,
                role: "assistant",
                agentName: "conversation_agent",
                nodeName: "ai_intern",
                runId: generateUUID(),
                active: true,
                running: true,
                state: { history_state: [historyState] },
                createdAt: new Date().toISOString(),
                status: { code: "Success" },
                type: "AgentStateMessage",
              })
            );
          } else if (type === "ai" || type === "tool") {
            messages.push(
              new TextMessage({
                content,
                role: Role.Assistant,
                id: message.id || `a-${generateUUID()}`,
                status: { code: "Success" },
                createdAt: new Date().toISOString(),
                type: "TextMessage",
              })
            );
          }
        }
      });
    });
    return messages;
  }

  const onClickChatHistory = async (threadId) => {
    try {
      const res = await axios.get("https://amigo.invoicemate.net/api/v1/checkpoint?thread_id=" + threadId, {
        headers: { "borrower-id": userId },
      });
      const chatHistory = res?.data?.data || [];
      const messages = await transformMessages(chatHistory?.history_state);
      setState(chatHistory);
      setMessages(messages);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      toast.error(error.message || "Failed to load chat history");
      navigate("/ai-chat?threadId=new-chat");
    }
  };

  useEffect(() => {
    SetIsNewChat(false);
    if (!threadId && !state.thread_id) {
      navigate("/ai-chat?threadId=new-chat");
    } else if (threadId === "new-chat" && state?.thread_id) {
      setState(InitialStateArray);
      setMessages([]);
    } else if (threadId !== "new-chat" && threadId !== "start-chat") {
      // !isNewChat && onClickChatHistory(threadId);
    }
  }, [threadId, navigate, isNewChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages?.length]);

  const handlePrepaidPrompt = (prompt) => {
    if (isLoading) return;
    sendMessage(prompt);
  };

  const handleSuggestionClick = (prompt) => {
    if (isLoading) return;
    sendMessage(prompt);
  };

  const Logs = ({ logs }) => {
    return (
      <div className="flex pl-14 my-4">
        <div className="bg-gray-100 rounded-lg p-4 w-full max-h-96 overflow-y-auto shadow-sm">
          {logs.length > 0 ? logs.map((log, index) => (
            <div key={index} className="flex items-center gap-3 p-2 border-b border-gray-200 last:border-0">
              <div className="min-w-[24px] flex items-center justify-center">
                {log.done ? (
                  <CheckCircle className="text-brand-purple w-5 h-5" />
                ) : (
                  <Loader2 className="text-brand-purple w-5 h-5 animate-spin" />
                )}
              </div>
              <p className={`flex-1 text-sm ${log.status === 'error' ? 'text-red-500' : 'text-gray-700'}`}>
                {log.message}
              </p>
            </div>
          )) : null}
        </div>
      </div>
    );
  };

  console.log(visibleMessages, 'visibleMessages');
  console.log(state, 'state')
  return (
    <div className="max-w-7xl mx-auto h-[85vh] p-4 w-full flex-1">
      <div className="card h-full flex flex-col relative overflow-hidden bg-white/90 backdrop-blur-md border border-white/20">
        <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-6 scrollbar-thin">

          {!visibleMessages?.length && questionaireStatus && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-8 relative">
              <div className="absolute w-[70%] h-[70%] top-[15%] left-[15%] animate-gradient opacity-10 blur-3xl pointer-events-none rounded-full"
                style={{ background: 'linear-gradient(45deg, #0ea5e9, #3b82f6, transparent)' }} />

              <h2 className="text-xl text-gray-500 relative z-10 font-medium">
                Hello, How can I help you today?
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl relative z-10">
                {PREPAID_PROMPTS.map((item) => (
                  <div
                    key={item.title}
                    onClick={() => handlePrepaidPrompt(item.prompt)}
                    className="p-6 h-full cursor-pointer transition-all duration-200 border border-gray-200 rounded-xl bg-white/80 backdrop-blur-sm hover:border-brand-purple hover:bg-white hover:-translate-y-1 shadow-sm"
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 text-brand-purple bg-brand-purple/5">
                          {item.icon}
                        </div>
                        <h3 className="font-semibold text-gray-800">{item.title}</h3>
                      </div>
                      <p className="text-sm text-gray-500 min-h-[40px]">{item.prompt}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleMessages?.filter(m => m.type === 'TextMessage' || m.type === 'AgentStateMessage').map((message, index) => (
            <div key={index} className="w-full">
              {message.type === 'AgentStateMessage' && (
                <Logs logs={message?.state?.history_state?.[message?.state?.history_state?.length - 1]?.logs || []} />
              )}

              <div className={`flex gap-4 mb-4 ${message.role === Role.User ? 'justify-end' : 'justify-start'}`}>
                {message.role === Role.Assistant && message.content && (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center text-white flex-shrink-0">
                    <img src="/paymate.png" alt="AI" className="w-6 h-6 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                  </div>
                )}

                {message?.content && (
                  <div className={`p-4 max-w-[75%] rounded-2xl shadow-sm ${message.role === Role.User
                    ? 'bg-brand-purple/5 text-gray-800 rounded-tr-sm'
                    : 'bg-gray-50 text-gray-800 border border-gray-100 rounded-tl-sm'
                    }`}>
                    <div className="prose prose-sm max-w-none break-words">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={(url) => url} // Disable default sanitization to allow blob: and data: URLs
                        components={{
                          img: ({ node, ...props }) => {
                            if (!props.src) return null;
                            return <img {...props} className="max-w-full h-auto rounded-lg shadow-sm border border-gray-200 mt-2 max-h-64 object-contain bg-white" />;
                          },
                          a: ({ node, ...props }) => {
                            if (props.children?.[0]?.includes('PDF_PREVIEW_')) {
                              const fileName = props.children[0].replace('PDF_PREVIEW_', '');
                              if (!props.href) return null;
                              return (
                                <div className="flex flex-col gap-2 mt-2 w-full min-w-[280px]">
                                  <div className="flex items-center gap-2 text-brand-purple">
                                    <FileText className="w-5 h-5" />
                                    <span className="font-medium text-sm truncate">{fileName}</span>
                                  </div>
                                  <iframe src={props.href} className="w-full h-64 rounded-lg border border-gray-200 bg-white" title={fileName} />
                                </div>
                              );
                            }
                            return <a {...props} className="text-brand-purple hover:underline" />;
                          }
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {message.role === Role.User && message.content && (
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-bold flex-shrink-0">
                    {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />

          {isLoading && (
            <div className="flex items-center justify-center gap-4 py-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center text-white">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <button
                onClick={stopGeneration}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <StopCircle className="w-4 h-4" /> Stop Generating
              </button>
            </div>
          )}
        </div>

        {visibleMessages && !isLoading && (
          <AISuggestions
            data={state?.history_state?.[state?.history_state?.length - 1]?.follow_up || []}
            onSuggestionClick={handleSuggestionClick}
          />
        )}

        <div className="mt-auto border-t border-gray-100 bg-gray-50/50 p-2 rounded-b-xl">
          <MessageInput handleSubmitPrompt={handleSend} handleFileUpload={handleFileUpload} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}