#pragma once

#include <SDL3/SDL_timer.h>

#ifdef __EMSCRIPTEN__
#include "web/WebMenuController.h"
#endif

// SDL_Delay, but in the browser build first presents any drawing deferred
// since the last frame, since sleeping is when the canvas gets shown.
inline void port_delay(uint32_t ms) {
#ifdef __EMSCRIPTEN__
  WebFlushDisplay();
#endif
  SDL_Delay(ms);
}
