
(function () {
  "use strict";

  let voiceEnabled = false;
  let continuousMode = false;
  let busy = false;
  let recognition = null;
  let voices = [];

  const status = () => document.getElementById("famaStatus");

  function setStatus(message) {
    const el = status();
    if (el) el.textContent = message;
  }

  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    voices = speechSynthesis.getVoices();
  }

  loadVoices();

  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speakFamaReply(text) {
    return new Promise(resolve => {
      if (!voiceEnabled || !text || !("speechSynthesis" in window)) {
        resolve();
        return;
      }

      speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fa-IR";
      utterance.rate = 0.9;
      utterance.pitch = 0.85;

      const persianVoice = voices.find(v =>
        /^fa([-_]|$)/i.test(v.lang)
      );

      if (persianVoice) utterance.voice = persianVoice;

      utterance.onend = resolve;
      utterance.onerror = resolve;

      speechSynthesis.speak(utterance);
    });
  }

  function restartListening() {
    if (!continuousMode || busy || !recognition) return;

    setTimeout(() => {
      if (!continuousMode || busy) return;

      try {
        recognition.start();
        setStatus("🎙️ فاما گوش می‌دهد...");
      } catch (error) {
        setStatus("برای ادامه مکالمه دوباره میکروفون را بزن.");
      }
    }, 500);
  }

  function setupRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setStatus("تشخیص گفتار در این مرورگر پشتیبانی نمی‌شود.");
      return false;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "fa-IR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = async function (event) {
      const transcript =
        event.results[event.results.length - 1][0].transcript.trim();

      if (!transcript) return;

      busy = true;
      setStatus("حرفت رو شنیدم؛ فاما داره جواب می‌ده...");

      try {
        await window.sendFamaMessage(transcript);
      } catch (error) {
        setStatus("ارسال پیام انجام نشد.");
      }
    };

    recognition.onerror = function (event) {
      if (event.error === "not-allowed") {
        continuousMode = false;
        setStatus("اجازه استفاده از میکروفون داده نشده.");
      } else if (event.error === "no-speech") {
        setStatus("صدایی نشنیدم؛ دوباره صحبت کن.");
      } else {
        setStatus("خطای میکروفون: " + event.error);
      }
    };

    recognition.onend = function () {
      if (continuousMode && !busy) {
        restartListening();
      }
    };

    return true;
  }

  function addButtons() {
    const sendButton = document.getElementById("famaSendButton");
    if (!sendButton) return;

    if (!document.getElementById("famaVoiceButton")) {
      const voiceButton = document.createElement("button");
      voiceButton.id = "famaVoiceButton";
      voiceButton.className = "action secondary";
      voiceButton.style.margin = "8px 4px";
      voiceButton.textContent = "🔊 فعال‌کردن صدای فاما";

      voiceButton.onclick = function () {
        voiceEnabled = !voiceEnabled;

        if (voiceEnabled) {
          voiceButton.textContent = "🔇 خاموش‌کردن صدای فاما";
          speakFamaReply("سلام، من فاما هستم. صدای من فعاله.");
        } else {
          voiceButton.textContent = "🔊 فعال‌کردن صدای فاما";
          speechSynthesis.cancel();
        }
      };

      sendButton.insertAdjacentElement("afterend", voiceButton);
    }

    if (!document.getElementById("famaMicButton")) {
      const micButton = document.createElement("button");
      micButton.id = "famaMicButton";
      micButton.className = "action";
      micButton.style.margin = "8px 4px";
      micButton.textContent = "🎙️ شروع مکالمه صوتی";

      micButton.onclick = function () {
        if (continuousMode) {
          continuousMode = false;
          busy = false;

          if (recognition) recognition.stop();
          if ("speechSynthesis" in window) speechSynthesis.cancel();

          micButton.textContent = "🎙️ شروع مکالمه صوتی";
          setStatus("مکالمه صوتی متوقف شد.");
          return;
        }

        if (!recognition && !setupRecognition()) return;

        voiceEnabled = true;

        const voiceButton =
          document.getElementById("famaVoiceButton");

        if (voiceButton) {
          voiceButton.textContent = "🔇 خاموش‌کردن صدای فاما";
        }

        continuousMode = true;
        busy = false;
        micButton.textContent = "⏹️ توقف مکالمه صوتی";

        try {
          recognition.start();
          setStatus("🎙️ فاما گوش می‌دهد؛ صحبت کن.");
        } catch (error) {
          continuousMode = false;
          micButton.textContent = "🎙️ شروع مکالمه صوتی";
          setStatus("میکروفون آماده نشد. دوباره امتحان کن.");
        }
      };

      voiceButtonAfter(sendButton, micButton);
    }
  }

  function voiceButtonAfter(sendButton, micButton) {
    const voiceButton = document.getElementById("famaVoiceButton");

    if (voiceButton) {
      voiceButton.insertAdjacentElement("afterend", micButton);
    } else {
      sendButton.insertAdjacentElement("afterend", micButton);
    }
  }

  const originalSend = window.sendFamaMessage;

  if (typeof originalSend === "function") {
    window.sendFamaMessage = async function () {
      const before = famaMessages.length;

      await originalSend.apply(this, arguments);

      const last = famaMessages[famaMessages.length - 1];

      if (
        famaMessages.length > before &&
        last &&
        last.role === "assistant"
      ) {
        await speakFamaReply(last.content);
      }

      busy = false;

      if (continuousMode) {
        restartListening();
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addButtons);
  } else {
    addButtons();
  }

  window.speakFamaReply = speakFamaReply;
})();
