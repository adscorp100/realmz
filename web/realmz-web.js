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

  document.getElementById("export-saves").addEventListener("click", function () {
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
  });

  document.getElementById("import-saves").addEventListener("change", function (ev) {
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
  });

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
    canvas.focus();
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

  document.addEventListener("mousedown", function (ev) {
    if (!ev.target.closest(".menu") && !ev.target.closest("#menubar")) {
      if (popupState) finishPopup(0);
      closeMenus();
    }
  }, true);

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
      if (wasOpen >= 0 && menuBarEl.children[wasOpen]) {
        openTitle(menuBarEl.children[wasOpen], currentMenus.menus[wasOpen]);
      }
    },
    popup: function (json, x, y) {
      closeMenus();
      var menu = JSON.parse(json);
      var rect = canvas.getBoundingClientRect();
      var sx = rect.width / canvas.clientWidth || 1;
      var panel = buildPanel(menu, function (id, item) { finishPopup(item); }, 0);
      panel.style.left = rect.left + x * sx + "px";
      panel.style.top = rect.top + y * sx + "px";
      document.body.appendChild(panel);
      popupState = { panel: panel };
    },
  };

  // ---------------------------------------------------------------------------
  // Emscripten module

  Module.canvas = canvas;
  Module.noInitialRun = true;
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
    startEl.focus();
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
  var stageEl = document.getElementById("stage");
  function fitCanvas() {
    var w = stageEl.clientWidth, h = stageEl.clientHeight;
    var scale = Math.min(w / 800, h / 600);
    if (scale >= 1) scale = Math.max(1, Math.floor(scale * 2) / 2);
    canvas.style.setProperty("width", Math.floor(800 * scale) + "px", "important");
    canvas.style.setProperty("height", Math.floor(600 * scale) + "px", "important");
  }
  window.addEventListener("resize", fitCanvas);
  fitCanvas();

  startEl.addEventListener("click", function () {
    overlayEl.classList.add("hidden");
    canvas.focus();
    Module.callMain([]);
    fitCanvas();
  });

  window.RealmzModule = Module;
})();
