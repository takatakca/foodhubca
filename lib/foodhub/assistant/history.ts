// Chat history per person, in Food Hub's key-value store (fh_kv in production, memory in tests): the list of chats and
// one record per chat. Only the person who wrote a chat can read it.
import crypto from 'node:crypto';
import { getRepo } from '../repo';
import type { ChatMessage, ChatSummary } from './types';

const LIST_KEY = (user: string) => `assistant_chats_v1:${user}`;
const CHAT_KEY = (user: string, id: string) => `assistant_chat_v1:${user}:${id}`;
const MAX_CHATS = 50;
const MAX_MESSAGES = 200;

export interface StoredChat { id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }

export const isChatId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
export const newId = () => crypto.randomUUID();

export async function listChats(user: string): Promise<ChatSummary[]> {
  const list = await getRepo().getKv<ChatSummary[]>(LIST_KEY(user)).catch(() => null);
  return Array.isArray(list) ? list : [];
}

export async function getChat(user: string, id: string): Promise<StoredChat | null> {
  if (!isChatId(id)) return null;
  return getRepo().getKv<StoredChat>(CHAT_KEY(user, id)).catch(() => null);
}

/** Title from the first question: first 60 characters, on one line. */
export function titleOf(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'Chat';
}

/** Adds messages to a chat (created when new) and moves it to the top of the person's list. */
export async function appendMessages(user: string, id: string, messages: ChatMessage[]): Promise<StoredChat> {
  const repo = getRepo();
  const now = new Date().toISOString();
  const cur = (await getChat(user, id)) ?? { id, title: titleOf(messages.find((m) => m.role === 'user')?.text ?? ''), createdAt: now, updatedAt: now, messages: [] };
  const chat: StoredChat = { ...cur, updatedAt: now, messages: [...cur.messages, ...messages].slice(-MAX_MESSAGES) };
  await repo.setKv(CHAT_KEY(user, id), chat);
  const list = (await listChats(user)).filter((c) => c.id !== id);
  await repo.setKv(LIST_KEY(user), [{ id, title: chat.title, updatedAt: now, messages: chat.messages.length }, ...list].slice(0, MAX_CHATS));
  return chat;
}

/** Updates the card shown in a chat after Approve / Dismiss, so reopening the chat shows the decision. */
export async function updateProposalInChat(user: string, chatId: string | null, proposal: NonNullable<ChatMessage['proposals']>[number]): Promise<void> {
  if (!chatId) return;
  const chat = await getChat(user, chatId);
  if (!chat) return;
  let changed = false;
  const messages = chat.messages.map((m) => {
    if (!m.proposals?.some((p) => p.id === proposal.id)) return m;
    changed = true;
    return { ...m, proposals: m.proposals.map((p) => (p.id === proposal.id ? proposal : p)) };
  });
  if (changed) await getRepo().setKv(CHAT_KEY(user, chatId), { ...chat, messages });
}
