import { NtfyAuth, NtfyMessage, NtfyPluginSettings } from "../types";

type MessageHandler = (msg: NtfyMessage) => void;
type DeleteHandler = (sequenceId: string | undefined, topic: string) => void;
type ClearHandler = (sequenceId: string | undefined, topic: string) => void;
type ErrorHandler = (err: Error) => void;

// ─── Auth helpers ──────────────────────────────────────────────────────────

function buildAuthHeader(auth: NtfyAuth): string | undefined {
	switch (auth.mode) {
		case "basic":
			return `Basic ${btoa(`${auth.username ?? ""}:${auth.password ?? ""}`)}`;
		case "token":
			return `Bearer ${auth.token ?? ""}`;
		default:
			return undefined;
	}
}

/**
 * Build the ?auth= query parameter for EventSource connections.
 * ntfy expects base64(Authorization-header-value), e.g.:
 *   Basic mode  → base64("Basic dXNlcjpwYXNz")
 *   Token mode  → base64("Bearer tk_abc123")
 *
 * Self-hosted: credentials appear in access logs. For self-hosted instances
 * this is acceptable since you control the logs. For ntfy.sh use tokens.
 */
function buildAuthQueryParam(auth: NtfyAuth): string | undefined {
	const header = buildAuthHeader(auth);
	if (!header) return undefined;
	return btoa(header);
}

// ─── SSE Client ────────────────────────────────────────────────────────────

/**
 * Transport decision:
 *
 * We use SSE via EventSource (not fetch/JSON-stream) because:
 *   • Auto-reconnect is handled by the browser — zero manual reconnect code
 *   • HTTP/2 multiplexing — multiple topics share one TCP connection
 *   • Lower battery/CPU on mobile: browser event loop handles backpressure
 *   • Server-side identical to JSON stream — no extra ntfy config needed
 *
 * Auth via ?auth=<base64(header)> query param (ntfy's own mechanism,
 * used by the official ntfy web app). On self-hosted instances you control
 * the server logs; for ntfy.sh, use access tokens (short-lived leak impact).
 *
 * The alternative (fetch + ReadableStream) only makes sense when you need
 * custom headers AND cannot use query-param auth — not our case.
 */
export class NtfyStreamClient {
	private settings: NtfyPluginSettings;
	private sources: Map<string, EventSource> = new Map();
	/** Last time we surfaced an SSE error per topic — debounces rapid-fire onerror. */
	private lastErrorAt: Map<string, number> = new Map();
	private readonly ERROR_DEBOUNCE_MS = 5000;
	private onMessage: MessageHandler;
	private onDelete: DeleteHandler;
	private onClear: ClearHandler;
	private onError: ErrorHandler;

	constructor(
		settings: NtfyPluginSettings,
		onMessage: MessageHandler,
		onDelete: DeleteHandler,
		onClear: ClearHandler,
		onError: ErrorHandler,
	) {
		this.settings = settings;
		this.onMessage = onMessage;
		this.onDelete = onDelete;
		this.onClear = onClear;
		this.onError = onError;
	}

	updateSettings(settings: NtfyPluginSettings) {
		this.settings = settings;
	}

	/** Subscribe to a topic via SSE. Idempotent – closes existing connection first. */
	connect(topicName: string) {
		this.disconnect(topicName);

		const url = this._sseUrl(topicName);
		const es = new EventSource(url);

		es.onmessage = (e: MessageEvent) => {
			try {
				const msg: NtfyMessage = JSON.parse(e.data as string);
				if (msg.event === "message") {
					this.onMessage(msg);
				} else if (msg.event === "message_delete") {
					// Server deleted the notification for this sequence_id
					// (removes it from the client DB).
					this.onDelete(msg.sequence_id, msg.topic);
				} else if (msg.event === "message_clear") {
					// Server dismisses the notification(s) for a sequence_id
					// (targeted clear). When no sequence_id is present, falls
					// back to clearing all notifications in the topic.
					this.onClear(msg.sequence_id, msg.topic);
				}
				// open, keepalive, poll_request → silently ignored
			} catch {
				// malformed JSON – ignore
			}
		};

		es.onerror = () => {
			// EventSource auto-reconnects. On self-hosted servers a brief
			// connection drop can make onerror fire thousands of times per
			// second, which freezes Obsidian — debounce to one surfacing per
			// topic every ERROR_DEBOUNCE_MS.
			const now = Date.now();
			const last = this.lastErrorAt.get(topicName) ?? 0;
			if (now - last < this.ERROR_DEBOUNCE_MS) return;
			this.lastErrorAt.set(topicName, now);
			this.onError(new Error(`ntfy SSE error on topic "${topicName}" — reconnecting…`));
		};

		this.sources.set(topicName, es);
	}

	disconnect(topicName: string) {
		const es = this.sources.get(topicName);
		if (es) {
			es.close();
			this.sources.delete(topicName);
		}
	}

	disconnectAll() {
		for (const topic of [...this.sources.keys()]) {
			this.disconnect(topic);
		}
	}

	isConnected(topicName: string): boolean {
		const es = this.sources.get(topicName);
		return es !== undefined && es.readyState !== EventSource.CLOSED;
	}

	// ─── URL builder ────────────────────────────────────────────────────────

	private _sseUrl(topicName: string): string {
		const { serverUrl, auth } = this.settings;
		const base = serverUrl.replace(/\/$/, "");
		const params = new URLSearchParams();
		const authParam = buildAuthQueryParam(auth);
		if (authParam) params.set("auth", authParam);
		return `${base}/${encodeURIComponent(topicName)}/sse?${params.toString()}`;
	}

	private _apiUrl(path: string): string {
		const base = this.settings.serverUrl.replace(/\/$/, "");
		return `${base}/${path}`;
	}

	private _authHeaders(): Record<string, string> {
		const headers: Record<string, string> = {};
		const h = buildAuthHeader(this.settings.auth);
		if (h) headers["Authorization"] = h;
		return headers;
	}

	// ─── Publishing ──────────────────────────────────────────────────────────

	async publish(options: {
		topic: string;
		message: string;
		title?: string;
		priority?: 1 | 2 | 3 | 4 | 5;
		tags?: string[];
		markdown?: boolean;
		clickUrl?: string;
		attachUrl?: string;
		attachFilename?: string;
	}): Promise<void> {
		const headers: Record<string, string> = {
			"Content-Type": "text/plain; charset=utf-8",
			...this._authHeaders(),
		};
		if (options.title) headers["Title"] = options.title;
		if (options.priority) headers["X-Priority"] = String(options.priority);
		if (options.tags?.length) headers["Tags"] = options.tags.join(",");
		if (options.markdown) headers["Markdown"] = "yes";
		if (options.clickUrl) headers["Click"] = options.clickUrl;
		if (options.attachUrl) headers["Attach"] = options.attachUrl;
		if (options.attachFilename) headers["Filename"] = options.attachFilename;

		const res = await fetch(this._apiUrl(encodeURIComponent(options.topic)), {
			method: "POST",
			headers,
			body: options.message,
		});
		if (!res.ok)
			throw new Error(`Publish failed ${res.status}: ${await res.text().catch(() => res.statusText)}`);
	}

	/** Upload a vault file as binary attachment (PUT endpoint). */
	async publishWithFileAttachment(options: {
		topic: string;
		message: string;
		title?: string;
		priority?: 1 | 2 | 3 | 4 | 5;
		tags?: string[];
		markdown?: boolean;
		clickUrl?: string;
		fileData: ArrayBuffer;
		filename: string;
		mimeType?: string;
	}): Promise<void> {
		const headers: Record<string, string> = {
			"Content-Type": options.mimeType ?? "application/octet-stream",
			Filename: options.filename,
			...this._authHeaders(),
		};
		if (options.title) headers["Title"] = options.title;
		if (options.priority) headers["X-Priority"] = String(options.priority);
		if (options.tags?.length) headers["Tags"] = options.tags.join(",");
		if (options.markdown) headers["Markdown"] = "yes";
		if (options.clickUrl) headers["Click"] = options.clickUrl;
		if (options.message) headers["Message"] = options.message;

		const res = await fetch(this._apiUrl(encodeURIComponent(options.topic)), {
			method: "PUT",
			headers,
			body: options.fileData,
		});
		if (!res.ok)
			throw new Error(
				`File publish failed ${res.status}: ${await res.text().catch(() => res.statusText)}`,
			);
	}

	// ─── Poll cached messages ─────────────────────────────────────────────────

	/**
	 * Poll cached events from the server (history backfill) and apply each
	 * parsed event immediately via `apply` — right during parsing, not
	 * collect-then-batch. This keeps `message_delete` / `message_clear` /
	 * revive ordering correct against the still-growing message list. The
	 * caller wraps the call in a store batch so only one re-render fires.
	 */
	async pollAndApply(
		topicName: string,
		since: string,
		apply: (ev: NtfyMessage) => void,
	): Promise<void> {
		const params = new URLSearchParams({ poll: "1", since });
		const authParam = buildAuthQueryParam(this.settings.auth);
		if (authParam) params.set("auth", authParam);

		const url = `${this.settings.serverUrl.replace(/\/$/, "")}/${encodeURIComponent(topicName)}/json?${params}`;
		const res = await fetch(url, { headers: this._authHeaders() });
		if (!res.ok) throw new Error(`Poll failed ${res.status}`);

		const text = await res.text();
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const ev: NtfyMessage = JSON.parse(trimmed);
				if (
					ev.event === "message" ||
					ev.event === "message_clear" ||
					ev.event === "message_delete"
				) {
					apply(ev);
				}
			} catch {
				/* skip malformed line */
			}
		}
	}

	// ─── Notification Deletion ────────────────────────────────────────────────

	/**
	 * Clear (mark as read / dismiss) the notification for a sequence_id.
	 * API: PUT /<topic>/<sequence_id>/clear  (alias: /read)
	 * ntfy docs: "Clearing notifications" — marks it read and dismisses it from
	 * the drawer; the message stays in the cache/history.
	 */
	async clearNotification(topicName: string, sequenceId: string): Promise<void> {
		const url = this._apiUrl(
			`${encodeURIComponent(topicName)}/${encodeURIComponent(sequenceId)}/clear`,
		);
		const res = await fetch(url, {
			method: "PUT",
			headers: this._authHeaders(),
		});
		if (!res.ok) throw new Error(`Clear notification failed ${res.status}`);
	}

	/**
	 * Delete the notification for a sequence_id entirely (drawer + client DB).
	 * API: DELETE /<topic>/<sequence_id>
	 * ntfy docs: "Deleting notifications". A later message with the same
	 * sequence_id revives it as a new message.
	 */
	async deleteNotification(topicName: string, sequenceId: string): Promise<void> {
		const url = this._apiUrl(`${encodeURIComponent(topicName)}/${encodeURIComponent(sequenceId)}`);
		const res = await fetch(url, {
			method: "DELETE",
			headers: this._authHeaders(),
		});
		// 200 or 404 (already deleted) are both fine
		if (!res.ok && res.status !== 404) {
			throw new Error(`Delete notification failed ${res.status}`);
		}
	}

	// ─── Attachment download ──────────────────────────────────────────────────

	async downloadAttachment(attachmentUrl: string): Promise<ArrayBuffer> {
		const res = await fetch(attachmentUrl, { headers: this._authHeaders() });
		if (!res.ok) throw new Error(`Download failed ${res.status}`);
		return res.arrayBuffer();
	}
}
