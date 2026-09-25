#pragma once

// Delivers menu selections queued by the HTML menu bar to the Menu Manager.
void WebMenuPoll(void);

// Presents any drawing deferred since the last browser frame.
void WebFlushDisplay(void);
