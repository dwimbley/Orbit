/**
 * hook.cpp — Low-level mouse & keyboard hooks for drag detection
 *
 * A dedicated thread owns WH_MOUSE_LL (and WH_KEYBOARD_LL in modifier mode)
 * with its own message loop. The hook callback is minimal: copy the event
 * and post it to the worker. Never call slow APIs inside the callback.
 *
 * Exports:
 *   hookStart(config: { mode, delayMs, modifier }) → void
 *   hookStop() → void
 *   hookUpdateConfig(config) → void
 *   hookOnEvent(callback: ThreadSafeFunction) → void
 */

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>

namespace filewheel {

// Thread-safe function for sending events to JS
static Napi::ThreadSafeFunction tsfn;
static std::thread hookThread;
static std::atomic<bool> hookRunning{false};
static HHOOK mouseHook = nullptr;
static HHOOK keyboardHook = nullptr;

// Config (guarded by mutex)
static std::mutex configMutex;
static std::string activationMode = "auto";
static int delayMs = 350;
static std::string modifier = "Alt";

// Drag state
static POINT dragStartPoint = {0, 0};
static bool buttonDown = false;
static bool dragPending = false;
static DWORD dragStartTime = 0;
static DWORD dragTimerId = 0;
static bool surfaceShown = false;

// Check if the window under the cursor belongs to explorer.exe
static bool IsExplorerWindow(POINT pt) {
  HWND hwnd = WindowFromPoint(pt);
  if (!hwnd) return false;
  hwnd = GetAncestor(hwnd, GA_ROOT);
  if (!hwnd) return false;

  DWORD processId = 0;
  GetWindowThreadProcessId(hwnd, &processId);
  if (processId == 0) return false;

  HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!hProcess) return false;

  wchar_t exePath[MAX_PATH] = {0};
  DWORD size = MAX_PATH;
  bool isExplorer = false;

  if (QueryFullProcessImageNameW(hProcess, 0, exePath, &size)) {
    // Check if it ends with \explorer.exe (case-insensitive)
    std::wstring path(exePath);
    for (auto& c : path) c = towlower(c);
    isExplorer = (path.find(L"\\explorer.exe") != std::wstring::npos);
  }

  CloseHandle(hProcess);
  return isExplorer;
}

// Emit event to JS
enum class HookEventType { Pending, SurfaceRequested, Ended };

static void EmitEvent(HookEventType type, int x = 0, int y = 0) {
  if (!tsfn) return;

  struct EventData {
    HookEventType type;
    int x, y;
  };

  auto data = new EventData{type, x, y};
  tsfn.NonBlockingCall(data, [](Napi::Env env, Napi::Function fn, EventData* d) {
    Napi::Object event = Napi::Object::New(env);
    switch (d->type) {
      case HookEventType::Pending:
        event.Set("type", Napi::String::New(env, "pending"));
        event.Set("cursorX", Napi::Number::New(env, d->x));
        event.Set("cursorY", Napi::Number::New(env, d->y));
        break;
      case HookEventType::SurfaceRequested:
        event.Set("type", Napi::String::New(env, "surfaceRequested"));
        event.Set("cursorX", Napi::Number::New(env, d->x));
        event.Set("cursorY", Napi::Number::New(env, d->y));
        break;
      case HookEventType::Ended:
        event.Set("type", Napi::String::New(env, "ended"));
        break;
    }
    fn.Call({event});
    delete d;
  });
}

static void CALLBACK DragTimerProc(HWND, UINT, UINT_PTR, DWORD) {
  if (!buttonDown || !dragPending) return;

  POINT pt;
  GetCursorPos(&pt);
  surfaceShown = true;
  EmitEvent(HookEventType::SurfaceRequested, pt.x, pt.y);

  if (dragTimerId) {
    KillTimer(nullptr, dragTimerId);
    dragTimerId = 0;
  }
}

static LRESULT CALLBACK MouseHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode >= 0) {
    auto* ms = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
    POINT pt = ms->pt;

    switch (wParam) {
      case WM_LBUTTONDOWN: {
        if (IsExplorerWindow(pt)) {
          dragStartPoint = pt;
          dragStartTime = GetTickCount();
          buttonDown = true;
          dragPending = false;
          surfaceShown = false;
        }
        break;
      }

      case WM_MOUSEMOVE: {
        if (buttonDown && !dragPending) {
          int cx = GetSystemMetrics(SM_CXDRAG);
          int cy = GetSystemMetrics(SM_CYDRAG);
          if (abs(pt.x - dragStartPoint.x) > cx || abs(pt.y - dragStartPoint.y) > cy) {
            dragPending = true;
            EmitEvent(HookEventType::Pending, pt.x, pt.y);

            std::lock_guard<std::mutex> lock(configMutex);
            if (activationMode == "auto") {
              dragTimerId = SetTimer(nullptr, 0, delayMs, DragTimerProc);
            }
          }
        }
        break;
      }

      case WM_LBUTTONUP: {
        if (buttonDown) {
          buttonDown = false;
          dragPending = false;
          if (dragTimerId) {
            KillTimer(nullptr, dragTimerId);
            dragTimerId = 0;
          }
          EmitEvent(HookEventType::Ended);
        }
        break;
      }
    }
  }
  return CallNextHookEx(mouseHook, nCode, wParam, lParam);
}

static LRESULT CALLBACK KeyboardHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode >= 0 && dragPending && !surfaceShown) {
    auto* kb = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
    if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
      std::lock_guard<std::mutex> lock(configMutex);
      bool match = false;
      if (modifier == "Alt" && (kb->vkCode == VK_LMENU || kb->vkCode == VK_RMENU)) match = true;
      if (modifier == "Ctrl" && (kb->vkCode == VK_LCONTROL || kb->vkCode == VK_RCONTROL)) match = true;
      if (modifier == "Shift" && (kb->vkCode == VK_LSHIFT || kb->vkCode == VK_RSHIFT)) match = true;

      if (match) {
        POINT pt;
        GetCursorPos(&pt);
        surfaceShown = true;
        EmitEvent(HookEventType::SurfaceRequested, pt.x, pt.y);
      }
    }
  }
  return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
}

static void HookThreadProc() {
  mouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseHookProc, nullptr, 0);
  if (!mouseHook) return;

  {
    std::lock_guard<std::mutex> lock(configMutex);
    if (activationMode == "modifier") {
      keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardHookProc, nullptr, 0);
    }
  }

  MSG msg;
  while (hookRunning.load() && GetMessage(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  if (mouseHook) { UnhookWindowsHookEx(mouseHook); mouseHook = nullptr; }
  if (keyboardHook) { UnhookWindowsHookEx(keyboardHook); keyboardHook = nullptr; }
}

// N-API exports

static Napi::Value HookStart(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (hookRunning.load()) return env.Undefined();

  if (info.Length() > 0 && info[0].IsObject()) {
    auto config = info[0].As<Napi::Object>();
    std::lock_guard<std::mutex> lock(configMutex);
    if (config.Has("mode")) activationMode = config.Get("mode").As<Napi::String>().Utf8Value();
    if (config.Has("delayMs")) delayMs = config.Get("delayMs").As<Napi::Number>().Int32Value();
    if (config.Has("modifier")) modifier = config.Get("modifier").As<Napi::String>().Utf8Value();
  }

  hookRunning.store(true);
  hookThread = std::thread(HookThreadProc);
  return env.Undefined();
}

static Napi::Value HookStop(const Napi::CallbackInfo& info) {
  hookRunning.store(false);
  if (hookThread.joinable()) {
    PostThreadMessage(GetThreadId(hookThread.native_handle()), WM_QUIT, 0, 0);
    hookThread.join();
  }
  if (tsfn) {
    tsfn.Release();
    tsfn = nullptr;
  }
  return info.Env().Undefined();
}

static Napi::Value HookUpdateConfig(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() > 0 && info[0].IsObject()) {
    auto config = info[0].As<Napi::Object>();
    std::lock_guard<std::mutex> lock(configMutex);
    if (config.Has("mode")) activationMode = config.Get("mode").As<Napi::String>().Utf8Value();
    if (config.Has("delayMs")) delayMs = config.Get("delayMs").As<Napi::Number>().Int32Value();
    if (config.Has("modifier")) modifier = config.Get("modifier").As<Napi::String>().Utf8Value();
  }
  return env.Undefined();
}

static Napi::Value HookOnEvent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (tsfn) tsfn.Release();
  tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "HookEvent", 0, 1);
  return env.Undefined();
}

Napi::Object InitHook(Napi::Env env, Napi::Object exports) {
  exports.Set("hookStart", Napi::Function::New(env, HookStart));
  exports.Set("hookStop", Napi::Function::New(env, HookStop));
  exports.Set("hookUpdateConfig", Napi::Function::New(env, HookUpdateConfig));
  exports.Set("hookOnEvent", Napi::Function::New(env, HookOnEvent));
  return exports;
}

} // namespace filewheel

#else
// Stub for non-Windows
namespace filewheel {
Napi::Object InitHook(Napi::Env env, Napi::Object exports) { return exports; }
}
#endif
