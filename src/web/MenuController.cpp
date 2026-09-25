// Browser menu bar glue. The menu structure is serialized to JSON and rendered
// as an HTML menu bar by shell/realmz-web.js. Selections are queued on the JS
// side and polled from the event loop (WebMenuPoll), so no JS event handler
// ever calls back into wasm while Asyncify has the main loop suspended.

#include <emscripten.h>

#include <resource_file/TextCodecs.hh>
#include <string>

#include "MenuController.h"
#include "WebMenuController.h"

static void (*menu_callback)(int16_t, int16_t) = nullptr;

static void append_json_string(std::string& out, const std::string& s) {
  out.push_back('"');
  for (unsigned char ch : s) {
    switch (ch) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (ch < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", ch);
          out += buf;
        } else {
          out.push_back(static_cast<char>(ch));
        }
    }
  }
  out.push_back('"');
}

static void append_menu_json(std::string& out, const Menu& menu) {
  out += "{\"id\":" + std::to_string(menu.menu_id) + ",\"title\":";
  // Menu text is stored in Mac Roman; the apple menu title is a lone 0x14.
  append_json_string(out, (menu.title == "\x14") ? "\uF8FF" : ResourceDASM::decode_mac_roman(menu.title));
  out += std::string(",\"enabled\":") + (menu.enabled ? "true" : "false") + ",\"items\":[";
  bool first = true;
  for (const auto& item : menu.items) {
    if (!first) {
      out.push_back(',');
    }
    first = false;
    // Realmz fills unused slots in its dynamic menus with "\0" placeholders,
    // which the Mac Menu Manager didn't draw.
    bool hidden = !item.name.empty() && (item.name[0] == '\0');
    out += std::string("{\"hidden\":") + (hidden ? "true" : "false") + ",\"name\":";
    append_json_string(out, hidden ? std::string() : ResourceDASM::decode_mac_roman(item.name));
    out += ",\"key\":" + std::to_string(static_cast<uint8_t>(item.key_equivalent));
    out += ",\"mark\":" + std::to_string(static_cast<uint8_t>(item.mark_character));
    out += ",\"style\":" + std::to_string(item.style_flags);
    out += std::string(",\"enabled\":") + (item.enabled ? "true" : "false");
    out += std::string(",\"checked\":") + (item.checked ? "true" : "false") + "}";
  }
  out += "]}";
}

static std::string menu_list_json(const MenuList& list) {
  std::string out = "{\"menus\":[";
  bool first = true;
  for (const auto& m : list.menus) {
    if (!first) {
      out.push_back(',');
    }
    first = false;
    append_menu_json(out, *m);
  }
  out += "],\"submenus\":[";
  first = true;
  for (const auto& m : list.submenus) {
    if (!first) {
      out.push_back(',');
    }
    first = false;
    append_menu_json(out, *m);
  }
  out += "]}";
  return out;
}

void MCSync(std::shared_ptr<MenuList> menuList, void (*callback)(int16_t, int16_t)) {
  menu_callback = callback;
  std::string json = menu_list_json(*menuList);
  EM_ASM({
    if (Module.realmzMenus) {
      Module.realmzMenus.sync(UTF8ToString($0));
    }
  }, json.c_str());
}

void MCCreatePopupMenu(
    void*, // unused
    std::shared_ptr<Menu> menu,
    std::pair<int16_t, int16_t> loc,
    void (*callback)(int16_t, int16_t)) {
  std::string json;
  append_menu_json(json, *menu);
  EM_ASM({
    if (Module.realmzMenus) {
      Module.realmzMenus.popup(UTF8ToString($0), $1, $2);
    } else {
      Module.realmzPopupResult = 0;
    }
  }, json.c_str(), loc.second, loc.first);

  // Block (via Asyncify) until the popup is dismissed. -1 means still open.
  int32_t result;
  WebFlushDisplay();
  while ((result = EM_ASM_INT({
    var r = Module.realmzPopupResult;
    if (r === undefined || r === null) {
      return -1;
    }
    Module.realmzPopupResult = null;
    return r;
  })) == -1) {
    emscripten_sleep(16);
    WebFlushDisplay();
  }
  callback(menu->menu_id, static_cast<int16_t>(result));
}

void WebMenuPoll(void) {
  if (!menu_callback) {
    return;
  }
  for (;;) {
    int32_t packed = EM_ASM_INT({
      var q = Module.realmzMenuQueue;
      if (!q || q.length == 0) {
        return 0;
      }
      var s = q.shift();
      return (s[0] << 16) | (s[1] & 0xFFFF);
    });
    if (packed == 0) {
      break;
    }
    menu_callback(static_cast<int16_t>(packed >> 16), static_cast<int16_t>(packed & 0xFFFF));
  }
}

// Debug helpers for the browser build: expose the composited screen so
// automated tests can check what the game drew independently of WebGL.
#include "WindowManager.hpp"

extern "C" EMSCRIPTEN_KEEPALIVE const void* realmz_web_screen_data(void) {
  return WindowManager::instance().screen_port.data.get_data();
}

extern "C" EMSCRIPTEN_KEEPALIVE int32_t realmz_web_screen_width(void) {
  return WindowManager::instance().screen_port.data.get_width();
}

extern "C" EMSCRIPTEN_KEEPALIVE int32_t realmz_web_screen_height(void) {
  return WindowManager::instance().screen_port.data.get_height();
}

// Benchmark: milliseconds for n draw-and-present cycles in a tight loop with
// no yield (the treasure screen's selection animation does ~100), including
// getting the final frame on screen.
extern "C" EMSCRIPTEN_KEEPALIVE double realmz_web_bench_draws(int32_t n) {
  auto& wm = WindowManager::instance();
  bool was_enabled = wm.set_enable_recomposite(true);
  double start = emscripten_get_now();
  for (int32_t i = 0; i < n; i++) {
    wm.recomposite_all();
  }
  WebFlushDisplay();
  double ms = emscripten_get_now() - start;
  wm.set_enable_recomposite(was_enabled);
  return ms;
}

extern double web_stat_composite_ms, web_stat_present_ms;
extern int32_t web_stat_composites, web_stat_presents, web_stat_skipped;

// Returns compositor counters since the last call, as a JSON string.
extern "C" EMSCRIPTEN_KEEPALIVE const char* realmz_web_stats(void) {
  static std::string out;
  out = "{\"composites\":" + std::to_string(web_stat_composites) +
      ",\"compositeMs\":" + std::to_string(web_stat_composite_ms) +
      ",\"presents\":" + std::to_string(web_stat_presents) +
      ",\"presentMs\":" + std::to_string(web_stat_present_ms) +
      ",\"skipped\":" + std::to_string(web_stat_skipped) + "}";
  web_stat_composite_ms = web_stat_present_ms = 0;
  web_stat_composites = web_stat_presents = web_stat_skipped = 0;
  return out.c_str();
}

void WebFlushDisplay(void) {
  WindowManager::instance().flush_present();
}
