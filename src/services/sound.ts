import { NotificationSound } from "../types";

// Map sound names to web audio tone sequences (Hz).
const FREQUENCIES: Record<string, number[]> = {
	chime: [523, 659, 784], // C5, E5, G5
	ping: [880],
	pop: [440, 220],
	beep: [660, 660],
};

/**
 * Play a notification sound via the Web Audio API.
 * "default" (system) and "none" (silent) produce no output here — they are
 * only meaningful when a real notification arrives.
 */
export function playNotificationSound(sound: NotificationSound): void {
	if (sound === "none" || sound === "default") return;

	const freqs = FREQUENCIES[sound];
	if (!freqs) return;

	try {
		const ctx = new AudioContext();
		let time = ctx.currentTime;
		for (const freq of freqs) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.frequency.value = freq;
			osc.type = "sine";
			gain.gain.setValueAtTime(0.3, time);
			gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
			osc.start(time);
			osc.stop(time + 0.2);
			time += 0.15;
		}
		// Close context after sounds finish
		setTimeout(() => ctx.close(), (time - ctx.currentTime + 0.5) * 1000);
	} catch {
		// AudioContext not available – skip
	}
}
