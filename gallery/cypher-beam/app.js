// CypherBeam — Echtzeit-Rap-Visualisierung & Simultanübersetzung
// Web Speech API + MyMemory Translation + Emoji Mapper

(function () {
  "use strict";

  // ═══════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════

  const TRANSLATION_API = "https://api.mymemory.translated.net/get";
  const TRANSLATE_DEBOUNCE_MS = 800;
  const MAX_EMOJIS = 40;
  const EMOJI_FADE_AFTER = 30000; // 30s

  // Language codes for Web Speech API and translation
  const LANG_CONFIG = {
    de: { speech: "de-DE", flag: "\ud83c\udde9\ud83c\uddea", label: "Deutsch" },
    en: { speech: "en-US", flag: "\ud83c\uddec\ud83c\udde7", label: "English" },
    fr: { speech: "fr-FR", flag: "\ud83c\uddeb\ud83c\uddf7", label: "Fran\u00e7ais" },
    es: { speech: "es-ES", flag: "\ud83c\uddea\ud83c\uddf8", label: "Espa\u00f1ol" },
  };

  const ALL_LANGS = ["de", "en", "fr", "es"];

  // ═══════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════

  let recognition = null;
  let isListening = false;
  let sourceLang = "de";
  let finalTranscript = "";
  let lastTranslatedText = "";
  let translateTimer = null;
  let emojiCount = 0;
  let positiveScore = 0;
  let negativeScore = 0;

  // ═══════════════════════════════════════
  // DOM REFS
  // ═══════════════════════════════════════

  const micBtn = document.getElementById("mic-btn");
  const langSelect = document.getElementById("lang-select");
  const statusText = document.getElementById("status-text");
  const originalText = document.getElementById("original-text");
  const emojiZone = document.getElementById("emoji-zone");
  const toast = document.getElementById("toast");

  // Translation card text elements — built dynamically
  const translationCards = {};

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════

  function init() {
    // Check browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Browser unterst\u00fctzt keine Spracherkennung. Bitte Chrome/Edge nutzen.");
      micBtn.disabled = true;
      return;
    }

    // Setup recognition
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = handleResult;
    recognition.onerror = handleError;
    recognition.onend = handleEnd;

    // Setup UI
    micBtn.addEventListener("click", toggleMic);
    langSelect.addEventListener("change", handleLangChange);

    // Build translation cards based on initial language
    updateTranslationCards();

    setStatus("Bereit");
  }

  // ═══════════════════════════════════════
  // SPEECH RECOGNITION
  // ═══════════════════════════════════════

  function toggleMic() {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }

  function startListening() {
    sourceLang = langSelect.value;
    recognition.lang = LANG_CONFIG[sourceLang].speech;

    try {
      recognition.start();
      isListening = true;
      micBtn.classList.add("active");
      micBtn.textContent = "\u23f9";
      setStatus("LIVE", true);
      updateTranslationCards();
    } catch (e) {
      console.error("Speech start error:", e);
      showToast("Mikrofon-Fehler: " + e.message);
    }
  }

  function stopListening() {
    recognition.stop();
    isListening = false;
    micBtn.classList.remove("active");
    micBtn.textContent = "\ud83c\udfa4";
    setStatus("Gestoppt");
  }

  function handleResult(event) {
    let interimTranscript = "";
    let newFinalText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        newFinalText += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    // Append new final text
    if (newFinalText) {
      finalTranscript += newFinalText;
      // Process new words for emojis
      processWordsForEmoji(newFinalText);
      // Trigger translation
      scheduleTranslation(finalTranscript);
    }

    // Display
    displayOriginal(finalTranscript, interimTranscript);
  }

  function handleError(event) {
    console.error("Speech error:", event.error);
    if (event.error === "not-allowed") {
      showToast("Mikrofon-Zugriff verweigert. Bitte Berechtigung erteilen.");
      stopListening();
    } else if (event.error === "no-speech") {
      // Ignore, will auto-restart
    } else {
      showToast("Fehler: " + event.error);
    }
  }

  function handleEnd() {
    // Auto-restart if still supposed to be listening
    if (isListening) {
      try {
        recognition.start();
      } catch (e) {
        // Already started, ignore
      }
    }
  }

  function handleLangChange() {
    const wasListening = isListening;
    if (wasListening) {
      recognition.stop();
    }

    sourceLang = langSelect.value;
    updateTranslationCards();

    // Clear state for new language
    finalTranscript = "";
    lastTranslatedText = "";
    originalText.innerHTML = "";
    clearEmojis();

    if (wasListening) {
      setTimeout(() => startListening(), 200);
    }
  }

  // ═══════════════════════════════════════
  // DISPLAY
  // ═══════════════════════════════════════

  function displayOriginal(final, interim) {
    let html = "";
    if (final) {
      html += '<span class="final">' + escapeHtml(final) + "</span>";
    }
    if (interim) {
      html += ' <span class="interim">' + escapeHtml(interim) + "</span>";
    }
    originalText.innerHTML = html;

    // Auto-scroll
    const zone = document.getElementById("original-zone");
    zone.scrollTop = zone.scrollHeight;
  }

  function setStatus(text, live) {
    statusText.textContent = text;
    statusText.classList.toggle("live", !!live);
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 4000);
  }

  // ═══════════════════════════════════════
  // TRANSLATION
  // ═══════════════════════════════════════

  function updateTranslationCards() {
    const zone = document.getElementById("translation-zone");
    zone.innerHTML = "";

    const targetLangs = ALL_LANGS.filter((l) => l !== sourceLang);

    targetLangs.forEach((lang) => {
      const card = document.createElement("div");
      card.className = "translation-card";
      card.dataset.lang = lang;

      const cfg = LANG_CONFIG[lang];
      card.innerHTML =
        '<div class="lang-label">' +
        cfg.flag +
        " " +
        cfg.label +
        "</div>" +
        '<div class="translation-text" id="trans-' +
        lang +
        '"></div>';

      zone.appendChild(card);
      translationCards[lang] = document.getElementById("trans-" + lang);
    });
  }

  function scheduleTranslation(text) {
    clearTimeout(translateTimer);
    translateTimer = setTimeout(() => {
      if (text && text !== lastTranslatedText) {
        lastTranslatedText = text;
        translateAll(text);
      }
    }, TRANSLATE_DEBOUNCE_MS);
  }

  async function translateAll(text) {
    const targetLangs = ALL_LANGS.filter((l) => l !== sourceLang);

    // Take last ~200 chars for translation (API limit friendly)
    const trimmed = text.length > 200 ? text.slice(-200) : text;

    const promises = targetLangs.map((lang) =>
      translateText(trimmed, sourceLang, lang)
    );

    const results = await Promise.allSettled(promises);

    results.forEach((result, i) => {
      const lang = targetLangs[i];
      const el = translationCards[lang];
      if (el) {
        if (result.status === "fulfilled" && result.value) {
          el.textContent = result.value;
        }
      }
    });
  }

  async function translateText(text, from, to) {
    try {
      const url =
        TRANSLATION_API +
        "?q=" +
        encodeURIComponent(text) +
        "&langpair=" +
        from +
        "|" +
        to;

      const resp = await fetch(url);
      if (!resp.ok) throw new Error("HTTP " + resp.status);

      const data = await resp.json();
      if (
        data.responseStatus === 200 &&
        data.responseData &&
        data.responseData.translatedText
      ) {
        return data.responseData.translatedText;
      }
      return null;
    } catch (err) {
      console.warn("Translation error (" + from + "->" + to + "):", err);
      return null;
    }
  }

  // ═══════════════════════════════════════
  // EMOJI MAPPER
  // ═══════════════════════════════════════

  function processWordsForEmoji(text) {
    const words = text
      .toLowerCase()
      .replace(/[.,!?;:'"()]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1);

    // Check multi-word combos first (longest match)
    const lowerText = text.toLowerCase();
    const combos = Object.keys(window.EMOJI_DICT).filter(
      (k) => k.includes(" ")
    );
    for (const combo of combos) {
      if (lowerText.includes(combo)) {
        addEmojiParticle(window.EMOJI_DICT[combo]);
      }
    }

    // Single words
    for (const word of words) {
      // Update sentiment
      if (window.POSITIVE_WORDS.has(word)) positiveScore++;
      if (window.NEGATIVE_WORDS.has(word)) negativeScore++;

      const emoji = window.EMOJI_DICT[word];
      if (emoji) {
        addEmojiParticle(emoji);
      } else if (word.length > 3) {
        // No match — show as faint text particle
        addTextParticle(word);
      }
    }

    // Update mood background
    updateMood();
  }

  function addEmojiParticle(emoji) {
    // Limit total emojis
    if (emojiCount >= MAX_EMOJIS) {
      removeOldestEmoji();
    }

    const span = document.createElement("span");
    span.className = "emoji-particle";
    span.textContent = emoji;
    span.style.animationDelay = (Math.random() * 0.2).toFixed(2) + "s";

    emojiZone.appendChild(span);
    emojiCount++;

    // After pop animation, switch to float
    setTimeout(() => {
      if (span.parentNode) {
        span.classList.add("floating");
      }
    }, 600);

    // Schedule fade
    setTimeout(() => {
      if (span.parentNode) {
        span.classList.remove("floating");
        span.classList.add("fading");
        setTimeout(() => {
          if (span.parentNode) {
            span.remove();
            emojiCount--;
          }
        }, 1000);
      }
    }, EMOJI_FADE_AFTER);
  }

  function addTextParticle(word) {
    if (emojiCount >= MAX_EMOJIS) return;

    const span = document.createElement("span");
    span.className = "emoji-particle text-particle";
    span.textContent = word;

    emojiZone.appendChild(span);
    emojiCount++;

    // Remove faster than emojis
    setTimeout(() => {
      if (span.parentNode) {
        span.classList.add("fading");
        setTimeout(() => {
          if (span.parentNode) {
            span.remove();
            emojiCount--;
          }
        }, 1000);
      }
    }, 10000);
  }

  function removeOldestEmoji() {
    const first = emojiZone.querySelector(".emoji-particle");
    if (first) {
      first.remove();
      emojiCount--;
    }
  }

  function clearEmojis() {
    emojiZone.innerHTML = "";
    emojiCount = 0;
    positiveScore = 0;
    negativeScore = 0;
    emojiZone.classList.remove("mood-positive", "mood-negative");
  }

  function updateMood() {
    const diff = positiveScore - negativeScore;
    emojiZone.classList.remove("mood-positive", "mood-negative");
    if (diff > 2) {
      emojiZone.classList.add("mood-positive");
    } else if (diff < -2) {
      emojiZone.classList.add("mood-negative");
    }
  }

  // ═══════════════════════════════════════
  // UTILS
  // ═══════════════════════════════════════

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════
  // KEYBOARD SHORTCUT
  // ═══════════════════════════════════════

  document.addEventListener("keydown", function (e) {
    // Space to toggle mic (when not in input)
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      toggleMic();
    }
    // Escape to stop
    if (e.code === "Escape" && isListening) {
      stopListening();
    }
    // C to clear
    if (e.code === "KeyC" && !e.ctrlKey && !e.metaKey && e.target === document.body) {
      finalTranscript = "";
      lastTranslatedText = "";
      originalText.innerHTML = "";
      clearEmojis();
      Object.values(translationCards).forEach((el) => {
        if (el) el.textContent = "";
      });
    }
  });

  // ═══════════════════════════════════════
  // LAUNCH
  // ═══════════════════════════════════════

  document.addEventListener("DOMContentLoaded", init);
})();
