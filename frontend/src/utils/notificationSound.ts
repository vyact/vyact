export function playNotificationSound(): void {
    try {
        const AudioContextClass = window.AudioContext
            || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
        if (!AudioContextClass) return;

        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.setValueAtTime(880, context.currentTime);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.23);
        oscillator.addEventListener('ended', () => void context.close());
    } catch {
        // Audio may be unavailable until the browser has received user interaction.
    }
}
