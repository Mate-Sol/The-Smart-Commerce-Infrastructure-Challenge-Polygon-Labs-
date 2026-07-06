import { CopilotKit } from '@copilotkit/react-core';
import AIChatView from './AIChatView';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from '../Sidebar';

import { ErrorBoundary } from './ErrorBoundary';

const AIChat = () => {
  const [searchParams] = useSearchParams();
  const threadId = searchParams.get('threadId');
  const { user } = useAuth();
  const userId = user?.id || '';
  const publicApiKey = "Cau8FEwJmpogKNkZGdSmhk9oNgEbkk7VCxwdbdgZHjPd8KKVnp4uJQQJ99BAACfhMk5XJ3w3AAABACOGl9o5";

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-hidden">
      <Sidebar />
      <main className="ml-64 flex-1 flex flex-col h-screen p-4">
        <ErrorBoundary>
          <CopilotKit
            runtimeUrl=" https://amigo.invoicemate.net/api/copilotkit"
            transcribeAudioUrl="https://amigo.invoicemate.net/api/transcribe"
            // publicApiKey={publicApiKey || undefined}
            agent="conversation_agent"
            showDevConsole={true}
            headers={{
              "x-borrower-id": userId,
              thread_id: (threadId != 'new-chat' && threadId != 'start-chat') ? threadId : null,
            }}
          >
            <AIChatView />
          </CopilotKit>
        </ErrorBoundary>
      </main>
    </div>
  );
};

export default AIChat;