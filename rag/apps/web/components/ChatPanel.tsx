const demoMetric = (action: string, capability = "document") => {
	try {
		window.dispatchEvent(
			new CustomEvent("superdoc:demo", { detail: { action, capability } }),
		);
	} catch {
		/* Analytics must not affect the demo. */
	}
};

import { useEffect, useRef, useState } from "react";
import { type Citation, queryDocuments } from "../lib/api";
import { ChatMessage } from "./ChatMessage";

type Message = {
	id: number;
	role: "user" | "assistant";
	content: string;
	citations?: Citation[];
	loading?: boolean;
};

const SAMPLE_QUESTIONS = [
	"What services does Nexus provide under the agreement?",
	"What's the monthly fee for the Professional tier?",
	"What does the reviewer suggest about capping liability?",
	"What changes have been proposed to the termination notice period?",
	"Which customers have confirmed participation in the beta launch?",
];

type Props = {
	onCitationClick: (citation: Citation) => void;
	disabled?: boolean;
};

export function ChatPanel({ onCitationClick, disabled }: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const nextIdRef = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length]);

	async function handleSend() {
		const q = input.trim();
		if (!q || loading || disabled) return;

		const userMsg: Message = {
			id: nextIdRef.current++,
			role: "user",
			content: q,
		};
		const loadingMsg: Message = {
			id: nextIdRef.current++,
			role: "assistant",
			content: "",
			loading: true,
		};

		setMessages((m) => [...m, userMsg, loadingMsg]);
		setInput("");
		setLoading(true);

		try {
			demoMetric("ai_started", "answer");
			const result = await queryDocuments(q);
			demoMetric("ai_succeeded", "answer");
			setMessages((m) =>
				m.map((msg) =>
					msg.id === loadingMsg.id
						? {
								...msg,
								content: result.answer,
								citations: result.citations,
								loading: false,
							}
						: msg,
				),
			);
		} catch (err) {
			demoMetric("ai_failed", "answer");
			setMessages((m) =>
				m.map((msg) =>
					msg.id === loadingMsg.id
						? {
								...msg,
								content: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
								loading: false,
							}
						: msg,
				),
			);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="chat-sidebar">
			<div className="chat-header">Document Q&A</div>
			<div className="chat-body">
				{messages.length === 0 && (
					<div className="chat-empty">
						{disabled ? (
							<>
								<span className="chat-empty-title">Waiting for documents</span>
								<span className="chat-empty-hint">
									Documents need to be uploaded, processed, and indexed before
									you can ask questions.
								</span>
							</>
						) : (
							<>
								<span className="chat-empty-title">Ask your documents</span>
								<span className="chat-empty-hint">
									Get cited answers from paragraphs, comments, and tracked
									changes. Click a citation to see the source.
								</span>
							</>
						)}
					</div>
				)}
				{messages.map((msg) => (
					<ChatMessage
						key={msg.id}
						role={msg.role}
						content={msg.content}
						citations={msg.citations}
						loading={msg.loading}
						onCitationClick={onCitationClick}
					/>
				))}
				<div ref={bottomRef} />
			</div>
			{!disabled && (
				<div className="sample-questions">
					{SAMPLE_QUESTIONS.map((q) => (
						<button
							type="button"
							key={q}
							className="sample-question"
							disabled={loading}
							onClick={() => {
								setInput(q);
							}}
						>
							{q}
						</button>
					))}
				</div>
			)}
			<div className="chat-input">
				<input
					placeholder="Ask about your documents..."
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					disabled={loading || disabled}
				/>
				<button
					type="button"
					className="btn-send"
					onClick={handleSend}
					disabled={loading || disabled || !input.trim()}
				>
					Send
				</button>
			</div>
		</div>
	);
}
