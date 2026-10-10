type ClaudeTextBlock = {
  type?: string;
  text?: string;
};

type ClaudeResponse = {
  content?: ClaudeTextBlock[];
  error?: { message?: string };
};

export async function askClaude(input: {
  apiKey: string;
  model: string;
  instructions: string;
  prompt: string;
}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 4096,
      system: input.instructions,
      messages: [{ role: 'user', content: input.prompt }],
    }),
  });

  const payload = await response.json() as ClaudeResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Claude devolvió HTTP ${response.status}.`);
  }

  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude no devolvió contenido para el análisis.');

  return JSON.parse(extractJson(text));
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? text).trim();
}
