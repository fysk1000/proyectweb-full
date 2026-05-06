/**
 * Accesibilidad (A11y): panel flotante, preferencias persistentes, lectura guiada, voz.
 */
(function () {
  const LS_KEY = 'proyectweb_a11y_prefs';
  const defaults = {
    highContrast: false,
    darkMode: false,
    grayscale: false,
    fontScale: 1,
    readingGuide: false
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
    } catch (_) {
      return { ...defaults };
    }
  }

  let prefs = loadPrefs();

  function savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  function applyBodyClasses() {
    document.body.classList.toggle('high-contrast', !!prefs.highContrast);
    document.body.classList.toggle('dark-mode', !!prefs.darkMode);
    document.documentElement.classList.toggle('a11y-grayscale', !!prefs.grayscale);
    var scale = Math.min(2, Math.max(1, Number(prefs.fontScale) || 1));
    prefs.fontScale = scale;
    document.documentElement.style.setProperty('--a11y-font-scale', String(scale));
  }

  /** Línea horizontal de lectura guiada */
  var readingLine = null;
  function ensureReadingLine() {
    if (readingLine) return readingLine;
    readingLine = document.createElement('div');
    readingLine.className = 'a11y-reading-line';
    readingLine.setAttribute('aria-hidden', 'true');
    readingLine.hidden = true;
    document.body.appendChild(readingLine);
    return readingLine;
  }

  function setReadingGuide(on) {
    prefs.readingGuide = !!on;
    savePrefs();
    var line = ensureReadingLine();
    line.hidden = !prefs.readingGuide;
    line.classList.toggle('a11y-reading-line--active', prefs.readingGuide);
  }

  function onMouseMove(e) {
    if (!prefs.readingGuide || !readingLine) return;
    readingLine.style.transform = 'translateY(' + e.clientY + 'px)';
  }

  function speakMainContent() {
    if (!window.speechSynthesis) {
      window.alert('Tu navegador no admite lectura por voz (Web Speech API).');
      return;
    }
    var main = document.getElementById('main-content');
    if (!main) return;
    var text = main.innerText || '';
    text = text.replace(/\s+/g, ' ').trim().slice(0, 8000);
    if (!text) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    var voices = window.speechSynthesis.getVoices();
    var es = voices.find(function (v) { return /^es/i.test(v.lang); });
    if (es) u.voice = es;
    window.speechSynthesis.speak(u);
  }

  function buildUI() {
    var root = document.createElement('div');
    root.id = 'a11y-widget';
    root.className = 'a11y-widget';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'a11y-widget-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'a11y-panel');
    toggle.setAttribute('aria-label', 'Abrir menú de accesibilidad');
    toggle.innerHTML = '<i class="fa-solid fa-universal-access" aria-hidden="true"></i>';

    var panel = document.createElement('div');
    panel.id = 'a11y-panel';
    panel.className = 'a11y-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Opciones de accesibilidad');
    panel.hidden = true;

    panel.innerHTML =
      '<h2 class="a11y-panel-title">Accesibilidad</h2>' +
      '<div class="a11y-panel-grid">' +
      '<label class="a11y-switch"><input type="checkbox" id="a11y-high-contrast" data-key="highContrast"> <span>Alto contraste</span></label>' +
      '<label class="a11y-switch"><input type="checkbox" id="a11y-dark-mode" data-key="darkMode"> <span>Modo nocturno</span></label>' +
      '<label class="a11y-switch"><input type="checkbox" id="a11y-grayscale" data-key="grayscale"> <span>Escala de grises</span></label>' +
      '<label class="a11y-switch"><input type="checkbox" id="a11y-reading-guide" data-key="readingGuide"> <span>Lectura guiada (sigue al cursor)</span></label>' +
      '</div>' +
      '<div class="a11y-panel-row">' +
      '<label for="a11y-font-slider" class="a11y-label">Tamaño de texto</label>' +
      '<input type="range" id="a11y-font-slider" min="100" max="200" step="10" value="100" aria-valuemin="100" aria-valuemax="200" aria-valuetext="100%">' +
      '<span id="a11y-font-pct" class="a11y-font-pct">100%</span>' +
      '</div>' +
      '<div class="a11y-panel-actions">' +
      '<button type="button" id="a11y-speak" class="a11y-btn">Leer página en voz alta</button>' +
      '<button type="button" id="a11y-stop-speak" class="a11y-btn a11y-btn--secondary">Detener voz</button>' +
      '</div>';

    root.appendChild(panel);
    root.appendChild(toggle);
    var skip = document.querySelector('.skip-link');
    if (skip) skip.insertAdjacentElement('afterend', root);
    else document.body.prepend(root);

    function syncForm() {
      panel.querySelector('#a11y-high-contrast').checked = !!prefs.highContrast;
      panel.querySelector('#a11y-dark-mode').checked = !!prefs.darkMode;
      panel.querySelector('#a11y-grayscale').checked = !!prefs.grayscale;
      panel.querySelector('#a11y-reading-guide').checked = !!prefs.readingGuide;
      var pct = Math.round((prefs.fontScale || 1) * 100);
      var slider = panel.querySelector('#a11y-font-slider');
      slider.value = String(pct);
      slider.setAttribute('aria-valuetext', pct + '%');
      panel.querySelector('#a11y-font-pct').textContent = pct + '%';
    }

    syncForm();
    setReadingGuide(prefs.readingGuide);

    toggle.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Cerrar menú de accesibilidad' : 'Abrir menú de accesibilidad');
      if (open) {
        panel.querySelector('#a11y-high-contrast').focus();
      }
    });

    panel.querySelectorAll('input[data-key]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var key = inp.getAttribute('data-key');
        prefs[key] = inp.checked;
        savePrefs();
        applyBodyClasses();
        if (key === 'readingGuide') setReadingGuide(inp.checked);
      });
    });

    var slider = panel.querySelector('#a11y-font-slider');
    var fontPctEl = panel.querySelector('#a11y-font-pct');
    slider.addEventListener('input', function () {
      var v = parseInt(slider.value, 10);
      prefs.fontScale = v / 100;
      fontPctEl.textContent = v + '%';
      slider.setAttribute('aria-valuetext', v + '%');
      savePrefs();
      applyBodyClasses();
    });

    document.getElementById('a11y-speak').addEventListener('click', speakMainContent);
    document.getElementById('a11y-stop-speak').addEventListener('click', function () {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    });

    document.addEventListener('mousemove', onMouseMove, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Abrir menú de accesibilidad');
        toggle.focus();
      }
    });
  }

  applyBodyClasses();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }

  document.querySelector('.skip-link')?.addEventListener('click', function () {
    window.requestAnimationFrame(function () {
      var m = document.getElementById('main-content');
      if (m) m.focus({ preventScroll: true });
    });
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', function () {}, { once: true });
  }
})();
