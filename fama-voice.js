
(function () {
  "use strict";

  const SERVER = "https://fama-ai-voice.farzad-tattoo72.workers.dev";

  let recorder = null;
  let stream = null;
  let chunks = [];
  let recording = false;
  let voiceEnabled = true;
  let voices = [];

  const status = () => document.getElementById("famaStatus");

  function setStatus(message) {
    if (status()) status().textContent = message;
  }

  function loadVoices() {
    if ("speechSynthesis" in window) {
      voices = speechSynthesis.getVoices();
    }
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
      utterance.pitch = 0.95;

      const persianVoice = voices.find(v =>
        /^fa([-_]|$)/i.test(v.lang)
      );

      if (persianVoice) utterance.voice = persianVoice;

      utterance.onend = resolve;
      utterance.onerror = resolve;

      speechSynthesis.speak(utterance);
    });
  }

  async function startRecording(button) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("مرورگر امکان دسترسی به میکروفون را ندارد.");
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });

      let mimeType = "";

      const formats = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus"
      ];

      if (window.MediaRecorder.isTypeSupported) {
        mimeType = formats.find(type =>
          MediaRecorder.isTypeSupported(type)
        ) || "";
      }

      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunks = [];

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const type = recorder.mimeType || "audio/mp4";
        const extension = type.includes("webm") ? "webm" :
                         type.includes("ogg") ? "ogg" : "m4a";

        const audioBlob = new Blob(chunks, { type });

        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          stream = null;
        }

        button.disabled = true;
        button.textContent = "⏳ در حال ارسال صدا...";

        try {
          if (!audioBlob.size) {
            throw new Error("صدایی ضبط نشد.");
          }

          const form = new FormData();
          form.append("file", audioBlob, "fama-recording." + extension);

          setStatus("🎧 فاما داره صدات رو به متن تبدیل می‌کنه...");

          const response = await fetch(SERVER + "/transcribe", {
            method: "POST",
            body: form
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "خطا در تبدیل صدا");
          }

          const transcript = (data.text || "").trim();

          if (!transcript) {
            throw new Error("صدای واضحی دریافت نشد؛ دوباره امتحان کن.");
          }

          setStatus("🗣️ شنیدم: " + transcript);

          await window.sendFamaMessage(transcript);

        } catch (error) {
          setStatus("خطا: " + error.message);
        } finally {
          button.disabled = false;
          button.textContent = "🎙️ شروع ضبط صدا";
          chunks = [];
        }
      };

      recorder.start();

      recording = true;
      button.textContent = "⏹️ پایان ضبط و ارسال";
      setStatus("🎙️ فاما گوش می‌دهد؛ صحبت کن.");

    } catch (error) {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }

      recording = false;
      button.textContent = "🎙️ شروع ضبط صدا";
      setStatus("مشکل میکروفون: " + error.message);
    }
  }

  function stopRecording(button) {
    if (recorder && recording && recorder.state !== "inactive") {
      recording = false;
      button.textContent = "⏳ در حال آماده‌سازی صدا...";
      setStatus("ضبط تمام شد؛ در حال آماده‌سازی...");
      recorder.stop();
    }
  }

  function addButtons() {
    const sendButton = document.getElementById("famaSendButton");

    if (!sendButton) return;

    if (!document.getElementById("famaVoiceButton")) {
      const voiceButton = document.createElement("button");
      voiceButton.id = "famaVoiceButton";
      voiceButton.className = "action secondary";
      voiceButton.style.margin = "8px 4px";
      voiceButton.textContent = "🔊 صدای فاما روشن";

      voiceButton.onclick = function () {
        voiceEnabled = !voiceEnabled;

        voiceButton.textContent = voiceEnabled
          ? "🔊 صدای فاما روشن"
          : "🔇 صدای فاما خاموش";

        if (!voiceEnabled && "speechSynthesis" in window) {
          speechSynthesis.cancel();
        }

        if (voiceEnabled) {
          speakFamaReply("سلام، من فاما هستم.");
        }
      };

      sendButton.insertAdjacentElement("afterend", voiceButton);
    }

    if (!document.getElementById("famaMicButton")) {
      const micButton = document.createElement("button");
      micButton.id = "famaMicButton";
      micButton.className = "action";
      micButton.style.margin = "8px 4px";
      micButton.textContent = "🎙️ شروع ضبط صدا";

      micButton.onclick = function () {
        if (recording) {
          stopRecording(micButton);
        } else {
          startRecording(micButton);
        }
      };

      const voiceButton = document.getElementById("famaVoiceButton");

      if (voiceButton) {
        voiceButton.insertAdjacentElement("afterend", micButton);
      } else {
        sendButton.insertAdjacentElement("afterend", micButton);
      }
    }
  }

  const originalSend = window.sendFamaMessage;

  if (typeof originalSend === "function") {
    window.sendFamaMessage = async function () {
      await originalSend.apply(this, arguments);

      const last = window.famaMessages &&
        window.famaMessages[window.famaMessages.length - 1];

      if (last && last.role === "assistant") {
        await speakFamaReply(last.content);
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
