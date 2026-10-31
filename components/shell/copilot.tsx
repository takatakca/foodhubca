'use client';

// The console shell opens this when the person taps « Copilote » / the sparkle (or on the `takatak:copilot` event).
// It is now the Food Hub Assistant: page summaries and next steps, chat over every channel, approval cards that never
// apply themselves (components/assistant, lib/foodhub/assistant, docs/ASSISTANT.md). The export name stays so the shell
// keeps working unchanged.
import { AssistantPanel } from '@/components/assistant/assistant-panel';

export function CopilotDrawer({ onClose }: { onClose: () => void }) {
  return <AssistantPanel onClose={onClose} />;
}

export { openAssistant } from '@/components/assistant/open';
