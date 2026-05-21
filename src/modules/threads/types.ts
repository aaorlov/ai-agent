import type { AgentMessage } from "@/modules/agent";

export interface ThreadDoc {
	threadId: string;
	userId: string;
	lastMessage: AgentMessage;
	messageCount: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface MessageDoc {
	threadId: string;
	userId: string;
	message: AgentMessage;
	createdAt: Date;
}

export interface MessagesPage {
	messages: AgentMessage[];
	hasMore: boolean;
	nextBefore: string | null;
}

export interface ThreadSummary {
	threadId: string;
	lastMessage: AgentMessage;
	messageCount: number;
	updatedAt: string;
}

export interface ThreadsPage {
	threads: ThreadSummary[];
	hasMore: boolean;
	nextBefore: string | null;
}
