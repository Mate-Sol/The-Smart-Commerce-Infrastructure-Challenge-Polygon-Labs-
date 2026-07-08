import { Message, Role, TextMessage } from "@copilotkit/runtime-client-gql";

const invoiceMateSystemPrompt = (textareaPurpose, contextString) => {
  return `You are AMIGO, the AI assistant for InvoiceMate, specializing in blockchain-based invoice management.

Your role is to predict the next word or phrase based on the user's input and context.

The user is currently engaged in: "${textareaPurpose}"

Analyze the text before the cursor to understand the user's intent and provide the most likely next word or phrase.

<TextBeforeCursor>
<YourPrediction>

Ensure your prediction is accurate, contextually relevant, and formatted appropriately.

Utilize the following context to enhance your prediction:
\`\`\`
${contextString}
\`\`\`
`;
};

const invoiceMateFewShotMessages = [
  new TextMessage({
    role: Role.User,
    content: "<TextBeforeCursor>Dear CARA,</TextBeforeCursor><TextAfterCursor>Thank you for your prompt payment.</TextAfterCursor>",
  }),
  new TextMessage({
    role: Role.Assistant,
    content: " We have updated your account accordingly. If you have any questions, feel free to reach out.",
  }),
  new TextMessage({
    role: Role.User,
    content: "<TextBeforeCursor>Please find attached the invoice for</TextBeforeCursor><TextAfterCursor>the services rendered in January.</TextAfterCursor>",
  }),
  new TextMessage({
    role: Role.Assistant,
    content: " Kindly review and process the payment by the due date mentioned.",
  }),
];

export const invoiceMateSuggestionsApiConfig = {
  makeSystemPrompt: invoiceMateSystemPrompt,
  fewShotMessages: invoiceMateFewShotMessages,
  maxTokens: 5, // Limits the length of the AI's response
  stop: ["\n", ".", "?", "!"], // Defines characters where the AI should stop generating text
  temperature: 0.7, // Controls the randomness of the AI's responses
};

