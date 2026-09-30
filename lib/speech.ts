export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string) {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.96;
  utterance.pitch = 1;
  const english =
    synth
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith("en") && voice.localService) ??
    synth.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (english) utterance.voice = english;
  synth.speak(utterance);
}

export function silence() {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
}
