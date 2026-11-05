(function () {
  "use strict";

  let voiceEnabled = false;
  let voices = [];

  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    voices = window.speechSynthesis.getVoices();
  }

  loadVoices();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speakFamaReply(text) {
    if (!voiceEnabled || !text || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fa-IR";
    utterance.rate = 0.9;
    utterance.pitch = 0.85;

    const persianVoice = voices.find(v =>
      /^fa([-_]|$)/i.test(v.lang)
    );

    if (persianVoice) {
      utterance.voice = persianVoice;
    }

    window.speechSynthesis.speak(utterance);
  }

  function addVoiceButton() {
    if (document.getElementById("famaVoiceButton")) return;

    const sendButton = document.getElementById("famaSendButton");
    if (!sendButton) return;

    const button = document.createElement("button");
    button.id = "famaVoiceButton";
    button.className = "action secondary";
    button.textContent = "🔊 فعال‌کردن صدای فاما";

    button.onclick = function () {
      voiceEnabled = !voiceEnabled;

      if (voiceEnabled) {
        button.textContent = "🔇 خاموش‌کردن صدای فاما";
        speakFamaReply("سلام، من فاما هستم.");
      } else {
        button.textContent = "🔊 فعال‌کردن صدای فاما";
        window.speechSynthesis.cancel();
      }
    };

    sendButton.insertAdjacentElement("afterend", button);
  }

  window.speakFamaReply = speakFamaReply;

  const originalSend = window.sendFamaMessage;

  if (typeof originalSend === "function") {
    window.sendFamaMessage = async function (customPrompt) {
      const previousCount = famaMessages.length;

      await originalSend.apply(this, arguments);

      if (famaMessages.length > previousCount) {
        const lastMessage = famaMessages[famaMessages.length - 1];

        if (lastMessage && lastMessage.role === "assistant") {
          speakFamaReply(lastMessage.content);
        }
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addVoiceButton);
  } else {
    addVoiceButton();
  }
})();
