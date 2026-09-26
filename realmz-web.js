// Browser shell for the Realmz WebAssembly build: loading, save persistence,
// and the HTML replacement for the classic Mac menu bar.
(function () {
  "use strict";

  var Module = (window.Module = window.Module || {});
  var PERSIST_DIR = "/libsdl"; // SDL_GetPrefPath() lives under here on Emscripten
  var statusEl = document.getElementById("status");
  var progressEl = document.getElementById("progress");
  var overlayEl = document.getElementById("overlay");
  var startEl = document.getElementById("start");
  var canvas = document.getElementById("canvas");
  var stageEl = document.getElementById("stage");

  // ---------------------------------------------------------------------------
  // Save persistence (IndexedDB)

  var syncing = false;
  var syncQueued = false;
  function persist() {
    if (!Module.FS || !Module.FS.syncfs) return;
    if (syncing) {
      syncQueued = true;
      return;
    }
    syncing = true;
    Module.FS.syncfs(false, function (err) {
      syncing = false;
      if (err) console.warn("Realmz: save sync failed", err);
      if (syncQueued) {
        syncQueued = false;
        persist();
      }
    });
  }

  function listFiles(dir, out) {
    var FS = Module.FS;
    FS.readdir(dir).forEach(function (name) {
      if (name === "." || name === "..") return;
      var path = dir + "/" + name;
      var st = FS.stat(path);
      if (FS.isDir(st.mode)) listFiles(path, out);
      else out.push(path);
    });
    return out;
  }

  function toBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromBase64(str) {
    var s = atob(str);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  function exportSaves() {
    if (!Module.FS) return;
    var files = {};
    listFiles(PERSIST_DIR, []).forEach(function (path) {
      files[path] = toBase64(Module.FS.readFile(path));
    });
    var blob = new Blob([JSON.stringify({ realmz: 1, files: files })], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "realmz-saves-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importSaves(ev) {
    var file = ev.target.files[0];
    if (!file || !Module.FS) return;
    file.text().then(function (text) {
      var data = JSON.parse(text);
      if (!data || data.realmz !== 1 || !data.files) throw new Error("Not a Realmz save export");
      Object.keys(data.files).forEach(function (path) {
        if (path.indexOf(PERSIST_DIR + "/") !== 0) return;
        var parts = path.split("/");
        var dir = "";
        for (var i = 1; i < parts.length - 1; i++) {
          dir += "/" + parts[i];
          try { Module.FS.mkdir(dir); } catch (e) { /* exists */ }
        }
        Module.FS.writeFile(path, fromBase64(data.files[path]));
      });
      Module.FS.syncfs(false, function () {
        if (confirm("Saves imported. Reload now to use them?")) location.reload();
      });
    }).catch(function (e) {
      alert("Import failed: " + e.message);
    });
  }

  document.querySelectorAll(".export-saves").forEach(function (b) { b.addEventListener("click", exportSaves); });
  document.querySelectorAll(".import-saves").forEach(function (i) { i.addEventListener("change", importSaves); });

  setInterval(persist, 5000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") persist();
  });
  window.addEventListener("pagehide", persist);

  // ---------------------------------------------------------------------------
  // Menu bar

  var menuBarEl = document.getElementById("menubar");
  var currentMenus = { menus: [], submenus: [] };
  var openMenu = null; // {titleEl, panel}
  var popupState = null;

  Module.realmzMenuQueue = [];
  Module.realmzPopupResult = null;

  function displayTitle(title) {
    if (title === "\u0014" || title === "") return "";
    return title;
  }

  function markGlyph(item) {
    if (item.key === 0x1B) return ""; // submenu parent: mark holds the child id
    if (item.checked || item.mark === 0x12) return "✓";
    if (item.mark === 19) return "◆";
    if (item.mark) return "•";
    return "";
  }

  function findSubmenu(id) {
    for (var i = 0; i < currentMenus.submenus.length; i++) {
      if (currentMenus.submenus[i].id === id) return currentMenus.submenus[i];
    }
    return null;
  }

  function closeMenus() {
    document.querySelectorAll(".menu").forEach(function (m) { m.remove(); });
    document.querySelectorAll("#menubar .title.open").forEach(function (t) { t.classList.remove("open"); });
    openMenu = null;
  }

  function buildPanel(menu, onSelect, depth) {
    var panel = document.createElement("div");
    panel.className = "menu";
    menu.items.forEach(function (item, index) {
      if (item.hidden) return;
      var row = document.createElement("div");
      if (item.name === "-" || item.name === "") {
        row.className = "item separator";
        panel.appendChild(row);
        return;
      }
      var enabled = menu.enabled && item.enabled;
      row.className = "item" + (enabled ? "" : " disabled");
      if (item.style & 1) row.classList.add("bold");
      if (item.style & 2) row.classList.add("italic");
      if (item.style & 4) row.classList.add("underline");

      var mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = markGlyph(item);
      var label = document.createElement("span");
      label.className = "label";
      label.textContent = item.name;
      var key = document.createElement("span");
      key.className = "key";
      var sub = item.key === 0x1B && item.mark ? findSubmenu(item.mark) : null;
      if (sub) key.textContent = "▶";
      else if (item.key > 0x20) key.textContent = "⌘" + String.fromCharCode(item.key).toUpperCase();
      row.appendChild(mark);
      row.appendChild(label);
      row.appendChild(key);

      if (sub && enabled) {
        var child = null;
        row.addEventListener("mouseenter", function () {
          panel.querySelectorAll(":scope > .menu").forEach(function (m) { m.remove(); });
          child = buildPanel(sub, onSelect, depth + 1);
          child.style.left = panel.offsetWidth - 4 + "px";
          child.style.top = row.offsetTop + "px";
          panel.appendChild(child);
        });
      } else if (enabled) {
        row.addEventListener("mouseenter", function () {
          panel.querySelectorAll(":scope > .menu").forEach(function (m) { m.remove(); });
        });
        row.addEventListener("mouseup", function (ev) {
          ev.stopPropagation();
          onSelect(menu.id, index + 1);
        });
      }
      panel.appendChild(row);
    });
    return panel;
  }

  function queueSelection(menuId, item) {
    closeMenus();
    Module.realmzMenuQueue.push([menuId, item]);
    focusGame();
  }

  function openTitle(titleEl, menu) {
    closeMenus();
    if (!menu.enabled) return;
    titleEl.classList.add("open");
    var panel = buildPanel(menu, queueSelection, 0);
    var rect = titleEl.getBoundingClientRect();
    panel.style.left = rect.left + "px";
    panel.style.top = rect.bottom + "px";
    document.body.appendChild(panel);
    openMenu = { titleEl: titleEl, panel: panel };
  }

  function renderMenuBar() {
    menuBarEl.textContent = "";
    currentMenus.menus.forEach(function (menu) {
      var t = document.createElement("div");
      t.className = "title" + (menu.enabled ? "" : " disabled");
      t.textContent = displayTitle(menu.title);
      t.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
        if (openMenu && openMenu.titleEl === t) closeMenus();
        else openTitle(t, menu);
      });
      t.addEventListener("mouseenter", function () {
        if (openMenu && openMenu.titleEl !== t) openTitle(t, menu);
      });
      menuBarEl.appendChild(t);
    });
  }

  function dismissOutside(ev) {
    if (!ev.target.closest(".menu") && !ev.target.closest("#menubar")) {
      if (popupState) finishPopup(0);
      closeMenus();
    }
  }
  document.addEventListener("mousedown", dismissOutside, true);
  document.addEventListener("touchstart", dismissOutside, { capture: true, passive: true });

  function finishPopup(item) {
    if (!popupState) return;
    popupState = null;
    closeMenus();
    Module.realmzPopupResult = item;
  }

  function findKeyEquivalent(ch) {
    var lists = [currentMenus.menus, currentMenus.submenus];
    for (var l = 0; l < lists.length; l++) {
      for (var m = 0; m < lists[l].length; m++) {
        var menu = lists[l][m];
        if (!menu.enabled) continue;
        for (var i = 0; i < menu.items.length; i++) {
          var item = menu.items[i];
          if (item.enabled && item.key > 0x20 && String.fromCharCode(item.key).toUpperCase() === ch) {
            return [menu.id, i + 1];
          }
        }
      }
    }
    return null;
  }

  // Cmd/Ctrl+key shortcuts go to the menu bar, like on a classic Mac. This runs
  // in the capture phase so SDL never sees the keystroke.
  window.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && (openMenu || popupState)) {
      finishPopup(0);
      closeMenus();
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey || ev.key.length !== 1) return;
    var hit = findKeyEquivalent(ev.key.toUpperCase());
    if (hit) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      queueSelection(hit[0], hit[1]);
    }
  }, true);

  Module.realmzMenus = {
    sync: function (json) {
      currentMenus = JSON.parse(json);
      var wasOpen = openMenu ? Array.prototype.indexOf.call(menuBarEl.children, openMenu.titleEl) : -1;
      closeMenus();
      renderMenuBar();
      renderSheet();
      if (wasOpen >= 0 && menuBarEl.children[wasOpen]) {
        openTitle(menuBarEl.children[wasOpen], currentMenus.menus[wasOpen]);
      }
    },
    popup: function (json, x, y) {
      closeMenus();
      var menu = JSON.parse(json);
      var rect = canvas.getBoundingClientRect();
      var panel = buildPanel(menu, function (id, item) { finishPopup(item); }, 0);
      var scale = rect.width / 800;
      document.body.appendChild(panel);
      var left = rect.left + x * scale, top = rect.top + y * scale;
      left = Math.max(0, Math.min(left, window.innerWidth - panel.offsetWidth));
      top = Math.max(0, Math.min(top, window.innerHeight - panel.offsetHeight));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      popupState = { panel: panel };
    },
  };


  // ---------------------------------------------------------------------------
  // Touch devices: full-screen menu sheet, on-screen controls, soft keyboard

  var isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || /[?&]touch=1/.test(location.search);
  if (/[?&]touch=0/.test(location.search)) isTouch = false;
  if (isTouch) {
    document.body.classList.add("touch");
    // SDL listens for keys on the window, so the canvas never needs focus on
    // touch devices. Leaving it focusable lets a tap's synthetic mousedown
    // steal focus from the keyboard field and close the phone keyboard.
    canvas.removeAttribute("tabindex");
  }
  function focusGame() {
    if (!isTouch) canvas.focus();
  }

  var sheetEl = document.getElementById("sheet");
  var sheetMenusEl = document.getElementById("sheet-menus");
  var openSheetMenuId = null;

  function openSheet() {
    renderSheet();
    sheetEl.hidden = false;
  }

  function closeSheet() {
    sheetEl.hidden = true;
  }

  function buildSheetItems(menu, depth) {
    var list = document.createElement("div");
    list.className = "sheet-items";
    menu.items.forEach(function (item, index) {
      if (item.hidden) return;
      var row = document.createElement("div");
      if (item.name === "-" || item.name === "") {
        row.className = "separator";
        list.appendChild(row);
        return;
      }
      var enabled = menu.enabled && item.enabled;
      row.className = "item" + (enabled ? "" : " disabled");
      if (item.style & 1) row.classList.add("bold");
      if (item.style & 2) row.classList.add("italic");
      var mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = markGlyph(item);
      var label = document.createElement("span");
      label.className = "label";
      label.textContent = item.name;
      row.appendChild(mark);
      row.appendChild(label);
      list.appendChild(row);

      var sub = item.key === 0x1B && item.mark && depth < 3 ? findSubmenu(item.mark) : null;
      if (sub) {
        list.appendChild(buildSheetItems(sub, depth + 1));
      } else if (enabled) {
        row.addEventListener("click", function () {
          closeSheet();
          queueSelection(menu.id, index + 1);
        });
      }
    });
    return list;
  }

  function renderSheet() {
    if (!sheetMenusEl) return;
    sheetMenusEl.textContent = "";
    currentMenus.menus.forEach(function (menu) {
      var section = document.createElement("div");
      section.className = "sheet-menu" + (menu.enabled ? "" : " disabled") + (openSheetMenuId === menu.id ? " open" : "");
      var title = document.createElement("div");
      title.className = "sheet-title";
      title.textContent = displayTitle(menu.title) === "" ? "Apple" : displayTitle(menu.title);
      title.addEventListener("click", function () {
        if (!menu.enabled) return;
        var open = !section.classList.contains("open");
        sheetMenusEl.querySelectorAll(".sheet-menu.open").forEach(function (m) { m.classList.remove("open"); });
        section.classList.toggle("open", open);
        openSheetMenuId = open ? menu.id : null;
      });
      section.appendChild(title);
      section.appendChild(buildSheetItems(menu, 0));
      sheetMenusEl.appendChild(section);
    });
  }

  document.getElementById("open-sheet").addEventListener("click", openSheet);
  document.getElementById("close-sheet").addEventListener("click", closeSheet);

  // Synthetic keyboard events. SDL reads KeyboardEvent.code for the scancode
  // and keypress charCode for text, so both are filled in.
  var KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, " ": 32,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  function keyCodeFor(key, code) {
    if (/^Numpad\d$/.test(code)) return 96 + parseInt(code.slice(6), 10);
    if (KEY_CODES[key] !== undefined) return KEY_CODES[key];
    if (key.length === 1) return key.toUpperCase().charCodeAt(0);
    return 0;
  }
  function codeForChar(ch) {
    if (/^[a-z]$/i.test(ch)) return "Key" + ch.toUpperCase();
    if (/^[0-9]$/.test(ch)) return "Digit" + ch;
    if (ch === " ") return "Space";
    return "";
  }
  function sendKey(type, key, code, extra) {
    var kc = keyCodeFor(key, code);
    var init = { key: key, code: code, keyCode: kc, which: kc, bubbles: true, cancelable: true,
      location: /^Numpad/.test(code) ? 3 : 0 };
    if (type === "keypress") {
      init.charCode = key.length === 1 ? key.charCodeAt(0) : (key === "Enter" ? 13 : 0);
      init.keyCode = init.charCode;
      init.which = init.charCode;
    }
    if (extra) Object.keys(extra).forEach(function (k) { init[k] = extra[k]; });
    window.dispatchEvent(new KeyboardEvent(type, init));
  }
  function tapKey(key, code) {
    sendKey("keydown", key, code);
    if (key.length === 1 || key === "Enter") sendKey("keypress", key, code);
    sendKey("keyup", key, code);
  }

  // D-pad and action buttons: tap for one step, hold to keep walking.
  document.querySelectorAll("#controls button").forEach(function (btn) {
    var timer = null;
    var key = btn.dataset.key, code = btn.dataset.code;
    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      btn.classList.remove("pressed");
    }
    btn.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      btn.setPointerCapture(ev.pointerId);
      btn.classList.add("pressed");
      tapKey(key, code);
      var repeat = function () { tapKey(key, code); timer = setTimeout(repeat, 220); };
      timer = setTimeout(repeat, 450);
    });
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("lostpointercapture", stop);
    btn.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
  });

  // Soft keyboard: a hidden text field brings up the phone's keyboard, and
  // what's typed into it is forwarded to the game as key events. The field
  // always holds a sentinel so Backspace produces an input event even when
  // nothing has been typed yet (iOS and Android both need that).
  var SENTINEL = "__";
  var kbInput = document.getElementById("keyboard-input");
  var kbButton = document.getElementById("show-keyboard");
  var textField = null; // {x, y, w, h} in 800x600 game coordinates, or null

  function resetKbInput() {
    kbInput.value = SENTINEL;
    try { kbInput.setSelectionRange(SENTINEL.length, SENTINEL.length); } catch (e) { /* not focused */ }
  }

  function showKeyboard() {
    resetKbInput();
    kbInput.focus({ preventScroll: true });
    resetKbInput();
  }

  function hideKeyboard() {
    kbInput.blur();
  }

  // Called by the game (WindowManager) when an edit field gains or loses focus.
  Module.realmzTextInput = function (active, x, y, w, h) {
    if (active) {
      textField = { x: x, y: y, w: w, h: h };
      // The Abc button pulses while the game is waiting for typed text.
      document.body.classList.add("wants-text");
      // Works where the browser allows focusing without a fresh tap (Android
      // usually does); iOS needs the tap handled below.
      if (isTouch) showKeyboard();
    } else {
      textField = null;
      document.body.classList.remove("wants-text");
      if (document.activeElement === kbInput) hideKeyboard();
    }
  };

  // iOS only opens the keyboard from inside a touch handler, so while the game
  // has a text field focused, any tap on the game screen opens it.
  // Only taps on (or just around) the field itself count, so tapping the
  // dialog's OK button doesn't flash the keyboard up.
  function tapIsOnTextField(clientX, clientY) {
    if (!textField) return false;
    var rect = canvas.getBoundingClientRect();
    var scale = rect.width / 800;
    var gx = (clientX - rect.left) / scale, gy = (clientY - rect.top) / scale;
    var pad = 14;
    return gx >= textField.x - pad && gx <= textField.x + textField.w + pad &&
        gy >= textField.y - pad && gy <= textField.y + textField.h + pad;
  }
  stageEl.addEventListener("touchend", function (ev) {
    var t = ev.changedTouches && ev.changedTouches[0];
    if (t && document.activeElement !== kbInput && tapIsOnTextField(t.clientX, t.clientY)) showKeyboard();
  }, { passive: true });
  stageEl.addEventListener("click", function (ev) {
    if (isTouch && document.activeElement !== kbInput && tapIsOnTextField(ev.clientX, ev.clientY)) showKeyboard();
  });

  kbButton.addEventListener("click", function () {
    if (document.activeElement === kbInput) hideKeyboard();
    else showKeyboard();
  });
  kbInput.addEventListener("focus", function () {
    kbButton.classList.add("on");
    document.body.classList.add("typing");
  });
  kbInput.addEventListener("blur", function () {
    kbButton.classList.remove("on");
    document.body.classList.remove("typing");
    window.scrollTo(0, 0);
  });
  kbInput.addEventListener("keydown", function (ev) {
    ev.stopPropagation();
    if (ev.isComposing || ev.key === "Unidentified" || ev.key === "Process") return;
    // Printable characters and Backspace arrive through the input event.
    if (ev.key.length === 1 || ev.key === "Backspace") return;
    ev.preventDefault();
    tapKey(ev.key, ev.code || ev.key);
    // The phone's Return/Done key: pass it on, then put the keyboard away so
    // the dialog's buttons are reachable.
    if (ev.key === "Enter") hideKeyboard();
  });
  kbInput.addEventListener("keyup", function (ev) { ev.stopPropagation(); });
  kbInput.addEventListener("keypress", function (ev) { ev.stopPropagation(); });
  kbInput.addEventListener("input", function () {
    var v = kbInput.value;
    if (v.length < SENTINEL.length) {
      for (var i = v.length; i < SENTINEL.length; i++) tapKey("Backspace", "Backspace");
    } else {
      var typed = v.indexOf(SENTINEL) === 0 ? v.slice(SENTINEL.length) : v.replace(SENTINEL, "");
      Array.from(typed).forEach(function (ch) {
        if (ch === "\n") tapKey("Enter", "Enter");
        else tapKey(ch, codeForChar(ch));
      });
    }
    resetKbInput();
  });
  if (window.visualViewport) {
    // Keep the page pinned when the keyboard slides up.
    window.visualViewport.addEventListener("scroll", function () {
      if (document.activeElement === kbInput) window.scrollTo(0, 0);
    });
  }

  document.getElementById("toggle-controls").addEventListener("click", function () {
    document.body.classList.toggle("controls-hidden");
    this.classList.toggle("on", !document.body.classList.contains("controls-hidden"));
    fitCanvas();
  });
  document.getElementById("toggle-controls").classList.add("on");

  var fsButton = document.getElementById("fullscreen");
  var fsTarget = document.documentElement;
  if (!(fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen)) {
    fsButton.hidden = true; // iPhone Safari: use Add to Home Screen instead
  }
  fsButton.addEventListener("click", function () {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      var p = (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen).call(fsTarget);
      if (p && p.then && screen.orientation && screen.orientation.lock) {
        p.then(function () { return screen.orientation.lock("landscape"); }).catch(function () {});
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Emscripten module

  Module.canvas = canvas;
  Module.noInitialRun = true;
  // Version the wasm and data URLs like the page's other assets.
  Module.locateFile = function (path, prefix) {
    return prefix + path + (window.REALMZ_BUILD ? "?v=" + window.REALMZ_BUILD : "");
  };
  Module.print = function (t) { console.log(t); };
  Module.printErr = function (t) { console.log(t); };
  Module.setStatus = function (text) {
    var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
    if (m) {
      statusEl.textContent = m[1].trim() + "...";
      progressEl.hidden = false;
      progressEl.value = (parseInt(m[2], 10) * 100) / parseInt(m[4], 10);
    } else if (text) {
      statusEl.textContent = text;
    }
  };
  Module.preRun = [
    function () {
      var FS = Module.FS;
      FS.mkdir(PERSIST_DIR);
      FS.mount(FS.filesystems.IDBFS, {}, PERSIST_DIR);
      Module.addRunDependency("realmz-saves");
      FS.syncfs(true, function (err) {
        if (err) console.warn("Realmz: could not load saves", err);
        Module.removeRunDependency("realmz-saves");
      });
    },
  ];
  Module.onRuntimeInitialized = function () {
    // Browsers only allow audio after a user gesture, so wait for a click.
    statusEl.textContent = "Ready.";
    progressEl.hidden = true;
    startEl.hidden = false;
    if (!isTouch) startEl.focus();
  };
  Module.onAbort = function (what) {
    overlayEl.classList.remove("hidden");
    statusEl.textContent = "Realmz crashed: " + what + ". Your last save is kept; reload to continue.";
    startEl.hidden = true;
  };
  window.addEventListener("error", function (ev) {
    console.error(ev.error || ev.message);
  });

  // Scale the 800x600 game screen to the largest 4:3 size that fits, using
  // whole-number steps when there's room so pixel art stays crisp.
  function fitCanvas() {
    if (typeof resetZoom === "function" && zoom && zoom.s !== 1) resetZoom();
    var cs = getComputedStyle(stageEl);
    var w = stageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = stageEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var scale = Math.min(w / 800, h / 600);
    if (scale >= 1) scale = Math.max(1, Math.floor(scale * 2) / 2);
    canvas.style.setProperty("width", Math.floor(800 * scale) + "px", "important");
    canvas.style.setProperty("height", Math.floor(600 * scale) + "px", "important");
  }
  window.addEventListener("resize", fitCanvas);
  window.addEventListener("orientationchange", function () { setTimeout(fitCanvas, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", fitCanvas);
  fitCanvas();

  startEl.addEventListener("click", function () {
    overlayEl.classList.add("hidden");
    focusGame();
    Module.callMain([]);
    fitCanvas();
  });

  // ---------------------------------------------------------------------------
  // Pinch to zoom and two-finger pan (touch devices).
  //
  // One finger always belongs to the game: taps, holds and drags go to Realmz
  // exactly as before. Two fingers always belong to the camera, and nothing
  // from a two-finger gesture reaches the game. Because a second finger might
  // still be on its way when the first lands, a single touch is only handed to
  // the game once it's clearly a one-finger action: it's released (a tap), it
  // moves past a small slop (a drag), or it's held briefly.

  var zoom = { s: 1, tx: 0, ty: 0 };
  var ZOOM_MAX = 4;
  var TAP_SLOP = 8; // px a finger may wander and still count as a tap
  var HOLD_MS = 120; // after this long, a still single finger goes to the game
  var fitButton = document.getElementById("zoom-fit");

  function applyZoom() {
    if (zoom.s <= 1.001) {
      zoom.s = 1;
      zoom.tx = 0;
      zoom.ty = 0;
    }
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = zoom.s === 1 ? "" :
        "translate(" + zoom.tx + "px," + zoom.ty + "px) scale(" + zoom.s + ")";
    // Clip the zoomed game to its own area so it never shows behind the
    // side controls (the stage's padding).
    if (zoom.s === 1) {
      stageEl.style.clipPath = "";
    } else {
      var cs = getComputedStyle(stageEl);
      stageEl.style.clipPath = "inset(" + cs.paddingTop + " " + cs.paddingRight + " " +
          cs.paddingBottom + " " + cs.paddingLeft + ")";
    }
    if (fitButton) fitButton.hidden = zoom.s === 1;
  }

  function resetZoom() {
    zoom.s = 1;
    applyZoom();
  }

  // The canvas's untransformed position, and the part of the stage the game
  // may occupy (the content box, so zoomed content never slides under the
  // side controls).
  function zoomFrame() {
    var prev = canvas.style.transform;
    canvas.style.transform = "";
    var base = canvas.getBoundingClientRect();
    canvas.style.transform = prev;
    var st = stageEl.getBoundingClientRect();
    var cs = getComputedStyle(stageEl);
    var area = {
      left: st.left + parseFloat(cs.paddingLeft),
      top: st.top + parseFloat(cs.paddingTop),
      right: st.right - parseFloat(cs.paddingRight),
      bottom: st.bottom - parseFloat(cs.paddingBottom),
    };
    return { base: base, area: area };
  }

  function clampAxis(t, baseStart, size, areaStart, areaEnd) {
    var start = baseStart + t;
    var span = areaEnd - areaStart;
    var lo, hi;
    if (size >= span) {
      lo = areaEnd - size;
      hi = areaStart;
    } else {
      lo = areaStart;
      hi = areaEnd - size;
    }
    start = Math.min(hi, Math.max(lo, start));
    return start - baseStart;
  }

  function setZoom(s, tx, ty, frame) {
    s = Math.max(1, Math.min(ZOOM_MAX, s));
    var b = frame.base;
    zoom.s = s;
    zoom.tx = clampAxis(tx, b.left, b.width * s, frame.area.left, frame.area.right);
    zoom.ty = clampAxis(ty, b.top, b.height * s, frame.area.top, frame.area.bottom);
    applyZoom();
  }

  if (fitButton) fitButton.addEventListener("click", resetZoom);

  var touches = new Map(); // pointerId -> {x, y, sx, sy}
  var touchMode = "idle"; // idle | pending | game | gesture
  var gamePointerId = null;
  var holdTimer = null;
  var pinch = null;

  function sendToGame(type, id, x, y) {
    var down = type === "pointerdown";
    var ev = new PointerEvent(type, {
      pointerId: id, pointerType: "touch", isPrimary: true,
      clientX: x, clientY: y,
      button: type === "pointermove" ? -1 : 0,
      buttons: (down || type === "pointermove") ? 1 : 0,
      bubbles: true, cancelable: true,
    });
    ev.realmzSynthetic = true;
    canvas.dispatchEvent(ev);
  }

  function startGameTouch(id) {
    var t = touches.get(id);
    clearTimeout(holdTimer);
    touchMode = "game";
    gamePointerId = id;
    sendToGame("pointerdown", id, t.sx, t.sy);
    if (t.x !== t.sx || t.y !== t.sy) sendToGame("pointermove", id, t.x, t.y);
  }

  function beginPinch() {
    var pts = Array.from(touches.values()).slice(0, 2);
    var frame = zoomFrame();
    var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
    pinch = {
      frame: frame,
      dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
      s: zoom.s,
      // The game-canvas point (unscaled CSS px) under the fingers' midpoint.
      ux: (mx - frame.base.left - zoom.tx) / zoom.s,
      uy: (my - frame.base.top - zoom.ty) / zoom.s,
    };
  }

  function updatePinch() {
    var pts = Array.from(touches.values()).slice(0, 2);
    if (pts.length < 2 || !pinch) return;
    var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
    var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    var s = Math.max(1, Math.min(ZOOM_MAX, pinch.s * d / pinch.dist));
    // Keep the same game point under the midpoint: this zooms around the
    // fingers and pans as they move together.
    setZoom(s, mx - pinch.frame.base.left - pinch.ux * s,
        my - pinch.frame.base.top - pinch.uy * s, pinch.frame);
  }

  function onTouchPointer(ev) {
    if (ev.pointerType !== "touch" || ev.realmzSynthetic) return;
    if (ev.target.closest && ev.target.closest("button, .menu, #controls")) return;
    // Everything below is ours; SDL only sees what sendToGame forwards.
    ev.stopPropagation();
    ev.preventDefault();
    var id = ev.pointerId;

    if (ev.type === "pointerdown") {
      touches.set(id, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY });
      if (touches.size === 1 && touchMode === "idle") {
        touchMode = "pending";
        holdTimer = setTimeout(function () {
          if (touchMode === "pending" && touches.size === 1) startGameTouch(id);
        }, HOLD_MS);
      } else if (touches.size === 2) {
        clearTimeout(holdTimer);
        if (touchMode === "game") {
          // The first finger was already passed to the game; release it far
          // off-screen so the game sees the button go up without a click on
          // anything.
          sendToGame("pointerup", gamePointerId, -10000, -10000);
          gamePointerId = null;
        }
        touchMode = "gesture";
        beginPinch();
      }
      return;
    }

    var t = touches.get(id);
    if (!t) return;

    if (ev.type === "pointermove") {
      t.x = ev.clientX;
      t.y = ev.clientY;
      if (touchMode === "pending" && Math.hypot(t.x - t.sx, t.y - t.sy) > TAP_SLOP) {
        startGameTouch(id);
      } else if (touchMode === "game" && id === gamePointerId) {
        sendToGame("pointermove", id, t.x, t.y);
      } else if (touchMode === "gesture") {
        updatePinch();
      }
      return;
    }

    // pointerup / pointercancel
    touches.delete(id);
    if (touchMode === "pending") {
      // A quick tap: hand the game a press and release at the touch point.
      clearTimeout(holdTimer);
      sendToGame("pointerdown", id, t.sx, t.sy);
      sendToGame("pointerup", id, t.sx, t.sy);
    } else if (touchMode === "game" && id === gamePointerId) {
      sendToGame("pointerup", id, t.x, t.y);
      gamePointerId = null;
    } else if (touchMode === "gesture" && touches.size >= 2) {
      beginPinch();
    } else if (touchMode === "gesture" && touches.size === 1) {
      pinch = null; // a leftover finger stays with the gesture until lifted
    }
    if (touches.size === 0) {
      touchMode = "idle";
      pinch = null;
    }
  }

  if (isTouch) {
    ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (type) {
      stageEl.addEventListener(type, onTouchPointer, { capture: true, passive: false });
    });
    // Safari's own pinch gestures on the page.
    ["gesturestart", "gesturechange"].forEach(function (type) {
      document.addEventListener(type, function (ev) { ev.preventDefault(); }, { passive: false });
    });
  }

  // ---------------------------------------------------------------------------
  // Audio unlock. SDL retries AudioContext.resume() from a timer, but iOS only
  // honours it inside a real tap or keypress, and suspends ("interrupts")
  // audio again after a phone call, the lock screen or another app's audio.
  // So retry on every genuine user gesture.

  function unlockAudio(ev) {
    if (ev && ev.isTrusted === false) return;
    var sdl = Module.SDL3;
    var ctx = sdl && sdl.audioContext;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
      ctx.resume().catch(function () {});
    }
  }
  ["pointerdown", "touchend", "mousedown", "keydown", "click"].forEach(function (type) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") unlockAudio();
  });
  Module.realmzAudioState = function () {
    var ctx = Module.SDL3 && Module.SDL3.audioContext;
    return ctx ? ctx.state : "none";
  };

  // ---------------------------------------------------------------------------
  // Offline play: a service worker stores the whole game on the device, so
  // the home-screen app works with no network (see sw.js).

  var offlineEl = document.getElementById("offline-status");
  var sheetOfflineEl = document.getElementById("sheet-offline-status");
  var standalone = window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
  function setOfflineStatus(text, ready) {
    [offlineEl, sheetOfflineEl].forEach(function (el) {
      if (!el) return;
      el.hidden = false;
      el.textContent = text;
      el.classList.toggle("ready", !!ready);
    });
  }
  var readyText = standalone
    ? "Installed. Works offline."
    : "Saved for offline play. Share \u2192 Add to Home Screen to install.";

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.addEventListener("message", function (ev) {
      var m = ev.data || {};
      if (m.type === "realmz-offline-progress") {
        setOfflineStatus("Saving game for offline play... " + Math.round((m.done * 100) / m.total) + "%");
      } else if (m.type === "realmz-offline-ready" && m.build === window.REALMZ_BUILD) {
        setOfflineStatus(readyText, true);
      }
    });
    navigator.serviceWorker.register("sw.js?v=" + window.REALMZ_BUILD).then(function (reg) {
      if (reg.active && !reg.installing && !reg.waiting &&
          reg.active.scriptURL.indexOf(window.REALMZ_BUILD) !== -1) {
        setOfflineStatus(readyText, true);
      } else {
        setOfflineStatus("Saving game for offline play...");
      }
    }).catch(function (e) {
      console.warn("Realmz: offline install failed", e);
      setOfflineStatus("Offline play unavailable: " + e.message);
    });
    // Ask the browser not to evict the game or the saves under storage pressure.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  }
  if (standalone) {
    document.body.classList.add("standalone");
    document.getElementById("fullscreen").hidden = true;
  }

  window.RealmzModule = Module;
})();
