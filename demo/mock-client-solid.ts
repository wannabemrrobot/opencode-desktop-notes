export const lastAssistantWithUsage = (messages: any[]) => [...messages].reverse().find((m) => m.type === "assistant" && m.tokens)
