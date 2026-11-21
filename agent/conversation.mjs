export const CONVERSATION_LIMITS = Object.freeze({ messages: 12, messageChars: 1200, totalChars: 6000 });

// Retain the opening goal/recommendation and the most recent exchanges. No extra
// model call or unbounded transcript is needed to discuss an example over time.
function bounded(entries) {
  entries = entries
    .map(({ role, content }) => ({ role, content: content.slice(0, CONVERSATION_LIMITS.messageChars) }));
  while (entries.length > CONVERSATION_LIMITS.messages || entries.reduce((sum, entry) => sum + entry.content.length, 0) > CONVERSATION_LIMITS.totalChars) {
    entries.splice(entries.length > 4 ? 2 : 0, 2);
  }
  return entries;
}

export function rememberConversation(history, prompt, result) {
  const references = result.matches?.map((demo) => `${demo.title} (${demo.liveDemoUri})`).join('; ');
  const reply = `${references ? `Demos discussed: ${references}\n` : ''}${result.message}`;
  return bounded([...history, { role: 'user', content: prompt }, { role: 'assistant', content: reply }]);
}

export function rememberBuild(history, project) {
  return bounded([...history, { role: 'assistant', content: `The requested demo is now built: ${project.title}. ${project.summary}\nGuidance: ${project.guidance || ''}` }]);
}
