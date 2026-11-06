
(() => {
  "use strict";

  const SERVER = "https://fama-ai-voice.farzad-tattoo72.workers.dev";
  const SILENCE_LIMIT = 1300;
  const NO_SPEECH_LIMIT = 12000;
  const MAX_RECORDING_TIME = 20000;
  const SILENCE_THRESHOLD = 0.022;

  const micButton = document.getElementById("famaMicButton");
  const voiceButton = document.getElementById("famaVoiceButton");
  const statusBox = document.getElementById("famaStatus");

  if (!micButton) {
    console.error("FAMA: دکمه میکروفون پیدا نشد.");
    return;
  }

  let conversationActive = false;
  let voiceEnabled = true;
  let currentSession = 0;
  let currentRecorder = null;
  let currentStream = null;
  let currentAudioContext = null;
  let animationFrame = null;
  let currentAbortController = null;
  let stopReason = "normal";
  let chunks = [];

  function status(message) {
    if (statusBox) statusBox.textContent = message;
  }

  function updateMicButton() {
    micButton.textContent = conversationActive
      ? "توقف مکالمه"
      : "شروع مکالمه صوتی";

    micButton.setAttribute(
      "aria-label",
      conversationActive ? "توقف مکالمه صوتی" : "شروع مکالمه صوتی"
    );
  }

  function getMessages() {
    try {
      if (typeof famaMessages !== "undefined") {
        return famaMessages;
      }
    } catch (error) {}

    return [];
  }

  function getLastAssistantMessage() {
    const messages = getMessages();

    for (let i = messages.length - 1; i >= 0; i--) {
      if (
        messages[i] &&
        messages[i].role === "assistant" &&
        typeof messages[i].content === "string"
      ) {
        return messages[i].content;
      }
    }

    return "";
  }

  function speakFamaReply(text) {
    return new Promise((resolve) => {
      if (!voiceEnabled || !text || !("speechSynthesis" in window)) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fa-IR";
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }

  // حفظ پاسخ صوتی برای پیام‌های متنی و صوتی
  if (
    typeof window.sendFamaMessage === "function" &&
    !window.sendFamaMessage.__famaVoiceWrapped
  ) {
    const originalSend = window.sendFamaMessage;

    const wrappedSend = async function (...args) {
      const previousMessages = getMessages().length;

      await originalSend.apply(this, args);

      const messages = getMessages();
      const lastMessage = messages[messages.length - 1];

      if (
        messages.length > previousMessages &&
        lastMessage &&
        lastMessage.role === "assistant" &&
        typeof lastMessage.content === "string"
      ) {
        await speakFamaReply(lastMessage.content);
      }
    };

    wrappedSend.__famaVoiceWrapped = true;
    window.sendFamaMessage = wrappedSend;
  }

  function stopAudioResources() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }

    if (currentAudioContext) {
      try {
        currentAudioContext.close();
      } catch (error) {}

      currentAudioContext = null;
    }

    currentRecorder = null;
  }

  function stopConversation() {
    conversationActive = false;
    currentSession++;

    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    if (
      currentRecorder &&
      currentRecorder.state !== "inactive"
    ) {
      stopReason = "cancelled";

      try {
        currentRecorder.stop();
      } catch (error) {}
    }

    stopAudioResources();

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    updateMicButton();
    status("مکالمه صوتی متوقف شد.");
  }

  function getSupportedMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return "";
    }

    const types = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus"
    ];

    return types.find((type) =>
      MediaRecorder.isTypeSupported(type)
    ) || "";
  }

  function getFileExtension(type) {
    if (type.includes("mp4")) return "mp4";
    if (type.includes("ogg")) return "ogg";
    return "webm";
  }

  async function startListening(session) {
    if (!conversationActive || session !== currentSession) return;

    status("در حال آماده‌سازی میکروفون...");

    try {
      if (!navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia) {
        throw new Error("مرورگر امکان دسترسی به میکروفون را ندارد.");
      }

      if (!window.MediaRecorder) {
        throw new Error("ضبط صدا در این مرورگر پشتیبانی نمی‌شود.");
      }

      currentStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (!conversationActive || session !== currentSession) {
        stopAudioResources();
        return;
      }

      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("تحلیل صدای میکروفون پشتیبانی نمی‌شود.");
      }

      currentAudioContext = new AudioContextClass();

      if (currentAudioContext.state === "suspended") {
        await currentAudioContext.resume();
      }

      const source = currentAudioContext.createMediaStreamSource(
        currentStream
      );

      const analyser = currentAudioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      const mimeType = getSupportedMimeType();

      let recorder;

      try {
        recorder = mimeType
          ? new MediaRecorder(currentStream, { mimeType })
          : new MediaRecorder(currentStream);
      } catch (error) {
        recorder = new MediaRecorder(currentStream);
      }

      currentRecorder = recorder;
      chunks = [];
      stopReason = "normal";

      let speechDetected = false;
      let silenceStarted = null;
      const startedAt = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        status("خطا در ضبط صدا. دوباره تلاش می‌کنم...");
      };

      recorder.onstop = async () => {
        const actualType =
          recorder.mimeType || mimeType || "audio/webm";

        const blob = new Blob(chunks, { type: actualType });

        stopAudioResources();

        if (!conversationActive || session !== currentSession) {
          return;
        }

        if (stopReason === "cancelled") return;

        if (stopReason === "no-speech" || !speechDetected) {
          status("منتظر صدای شما هستم...");
          setTimeout(() => {
            if (conversationActive && session === currentSession) {
              startListening(session);
            }
          }, 500);
          return;
        }

        if (blob.size < 1000) {
          status("صدای واضحی دریافت نشد. دوباره گوش می‌دهم...");
          setTimeout(() => {
            if (conversationActive && session === currentSession) {
              startListening(session);
            }
          }, 700);
          return;
        }

        await transcribeAndReply(blob, actualType, session);
      };

      recorder.start(250);
      status("گوش می‌دم... صحبت کن.");

      function detectSpeech() {
        if (
          !conversationActive ||
          session !== currentSession ||
          !currentRecorder ||
          currentRecorder.state === "inactive"
        ) {
          return;
        }

        analyser.getByteTimeDomainData(data);

        let sum = 0;

        for (let i = 0; i < data.length; i++) {
          const value = (data[i] - 128) / 128;
          sum += value * value;
        }

        const rms = Math.sqrt(sum / data.length);
        const now = Date.now();

        if (rms > SILENCE_THRESHOLD) {
          speechDetected = true;
          silenceStarted = null;
          status("دارم گوش می‌دم...");
        } else if (speechDetected) {
          if (silenceStarted === null) {
            silenceStarted = now;
          }

          if (now - silenceStarted >= SILENCE_LIMIT) {
            stopReason = "silence";
            recorder.stop();
            return;
          }
        }

        if (!speechDetected && now - startedAt >= NO_SPEECH_LIMIT) {
          stopReason = "no-speech";
          recorder.stop();
          return;
        }

        if (now - startedAt >= MAX_RECORDING_TIME) {
          stopReason = "maximum";
          recorder.stop();
          return;
        }

        animationFrame = requestAnimationFrame(detectSpeech);
      }

      animationFrame = requestAnimationFrame(detectSpeech);

    } catch (error) {
      stopAudioResources();

      if (!conversationActive || session !== currentSession) return;

      status("خطای میکروفون: " + (error.message || "دسترسی ممکن نیست."));
      conversationActive = false;
      updateMicButton();
    }
  }

  async function transcribeAndReply(blob, mimeType, session) {
    if (!conversationActive || session !== currentSession) return;

    status("در حال تبدیل صدای شما به متن...");

    const extension = getFileExtension(mimeType);
    const formData = new FormData();

    formData.append("audio", blob, "fama-recording." + extension);

    currentAbortController = new AbortController();

    try {
      const response = await fetch(SERVER + "/transcribe", {
        method: "POST",
        body: formData,
        signal: currentAbortController.signal
      });

      if (!response.ok) {
        throw new Error("خطا در تبدیل صدا: " + response.status);
      }

      const data = await response.json();

      if (!conversationActive || session !== currentSession) return;

      const transcript = (
        data.text ||
        data.transcript ||
        data.transcription ||
        ""
      ).trim();

      if (!transcript) {
        status("متوجه صدات نشدم؛ دوباره گوش می‌دم...");
        setTimeout(() => {
          if (conversationActive && session === currentSession) {
            startListening(session);
          }
        }, 700);
        return;
      }

      status("فاما در حال فکر کردنه...");

      if (typeof window.sendFamaMessage !== "function") {
        throw new Error("تابع ارسال پیام فاما پیدا نشد.");
      }

      await window.sendFamaMessage(transcript);

      if (!conversationActive || session !== currentSession) return;

      status("پاسخ فاما تمام شد؛ دوباره گوش می‌دم...");

      setTimeout(() => {
        if (conversationActive && session === currentSession) {
          startListening(session);
        }
      }, 400);

    } catch (error) {
      if (error.name === "AbortError") return;

      console.error("FAMA voice error:", error);

      if (conversationActive && session === currentSession) {
        status("خطای ارسال صدا: " + (error.message || error));

        setTimeout(() => {
          if (conversationActive && session === currentSession) {
            startListening(session);
          }
        }, 1800);
      }
    } finally {
      currentAbortController = null;
    }
  }

  async function startConversation() {
    if (conversationActive) return;

    conversationActive = true;
    currentSession++;

    const session = currentSession;

    updateMicButton();

    if (voiceEnabled) {
      status("فاما آماده مکالمه است...");

      await speakFamaReply("جانم، گوش می‌دم.");

      if (!conversationActive || session !== currentSession) return;
    }

    startListening(session);
  }

  micButton.addEventListener("click", () => {
    if (conversationActive) {
      stopConversation();
    } else {
      startConversation();
    }
  });

  if (voiceButton) {
    voiceButton.addEventListener("click", () => {
      voiceEnabled = !voiceEnabled;

      voiceButton.textContent = voiceEnabled
        ? "صدای فاما: روشن"
        : "صدای فاما: خاموش";

      if (!voiceEnabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      status(
        voiceEnabled
          ? "صدای فاما روشن شد."
          : "صدای فاما خاموش شد."
      );
    });

    voiceButton.textContent = "صدای فاما: روشن";
  }

  updateMicButton();
  status("فاما آماده است. برای مکالمه صوتی دکمه را بزن.");

  window.addEventListener("pagehide", stopConversation);
})();
