// ─── ntfy Message Types ────────────────────────────────────────────────────

export type NtfyEvent =
	| "open"
	| "keepalive"
	| "message"
	| "message_delete"
	| "message_clear"
	| "poll_request";

export interface NtfyAttachment {
	name: string;
	url: string;
	type?: string;
	size?: number;
	expires?: number;
}

export interface NtfyMessage {
	id: string;
	time: number;
	expires?: number;
	event: NtfyEvent;
	topic: string;
	sequence_id?: string;
	message?: string;
	title?: string;
	tags?: string[];
	/** 1=min 2=low 3=default 4=high 5=max/urgent */
	priority?: 1 | 2 | 3 | 4 | 5;
	click?: string;
	attachment?: NtfyAttachment;
	/** locally added: which vault file paths were attached when sending */
	_vaultFiles?: string[];
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export type AuthMode = "none" | "basic" | "token";

export interface NtfyAuth {
	mode: AuthMode;
	username?: string;
	password?: string;
	token?: string;
}

// ─── Per-Topic Settings ────────────────────────────────────────────────────

export type NotificationSound = "default" | "none" | "chime" | "ping" | "pop" | "beep";

export interface TopicSettings {
	name: string;
	/** hex color for Notice badge e.g. "#ff6b6b" */
	color: string;
	/** 0 = stays until clicked; positive number = ms */
	noticeDuration: number;
	/** if true, no Notice() is shown */
	mute: boolean;
	sound: NotificationSound;
	/** whether to show this topic in the sidebar */
	enabled: boolean;
}

// ─── Plugin Settings ───────────────────────────────────────────────────────

export interface NtfyPluginSettings {
	serverUrl: string;
	auth: NtfyAuth;
	topics: TopicSettings[];
	/** vault-relative folder for downloads, e.g. "ntfy-downloads" */
	downloadFolder: string;
	/** reconnect delay in ms */
	reconnectDelayMs: number;
	/** fetch messages since connection start, or a duration like "10m" */
	since: string;
	/** global: disable the Notice pop-up for ALL topics */
	disableNotice: boolean;
	/** global: silent mode — disable the notification sound for ALL topics */
	disableSound: boolean;
}

export const DEFAULT_TOPIC_SETTINGS: Omit<TopicSettings, "name"> = {
	color: "#7c3aed",
	noticeDuration: 5000,
	mute: false,
	sound: "default",
	enabled: true,
};

export const DEFAULT_SETTINGS: NtfyPluginSettings = {
	serverUrl: "https://ntfy.sh",
	auth: { mode: "none" },
	topics: [],
	downloadFolder: "ntfy-downloads",
	reconnectDelayMs: 5000,
	since: "10m",
	disableNotice: false,
	disableSound: false,
};

export const NTFY_ICON: string = `<g fill="none" stroke="currentColor" stroke-width="3.175" stroke-linecap="round" stroke-linejoin="round" transform="scale(1.968504)">
	<path d="M44.98 39.952V10.848H7.407v27.814l-1.587 4.2 8.393-2.91Z" />
	<path d="M27.781 31.485h8.202" />
	<path d="M14.169 19.253L23.680 24.745L14.169 30.236" />
</g>`;
