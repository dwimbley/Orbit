/**
 * monitors.cpp -- Display info and system state queries
 *
 * Provides monitor enumeration with DPI-aware geometry, cursor position,
 * elevation check, and reduced-motion detection.
 *
 * All coordinates are in physical (device) pixels with signed values
 * to handle multi-monitor layouts where monitors can be to the left
 * of or above the primary.
 *
 * Exports:
 *   getCursorPos() -> {x, y}
 *   getMonitors() -> [{id, x, y, width, height, workAreaX, workAreaY,
 *                       workAreaWidth, workAreaHeight, scale, isPrimary}]
 *   getMonitorForPoint(x, y) -> monitor info
 *   isElevated() -> bool
 *   isReducedMotion() -> bool
 */

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <shellscalingapi.h>
#include <string>
#include <vector>

#pragma comment(lib, "shcore.lib")

namespace filewheel {

// ---- Helpers ----

struct MonitorInfo {
  std::wstring id;
  int x, y, width, height;
  int workAreaX, workAreaY, workAreaWidth, workAreaHeight;
  double scale;
  bool isPrimary;
};

static Napi::Object MonitorInfoToObject(Napi::Env env, const MonitorInfo& m) {
  Napi::Object obj = Napi::Object::New(env);

  // Convert wide id to UTF-8
  int len = WideCharToMultiByte(CP_UTF8, 0, m.id.c_str(), static_cast<int>(m.id.size()),
                                 nullptr, 0, nullptr, nullptr);
  std::string id(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, m.id.c_str(), static_cast<int>(m.id.size()),
                       id.data(), len, nullptr, nullptr);

  obj.Set("id", Napi::String::New(env, id));
  obj.Set("x", Napi::Number::New(env, m.x));
  obj.Set("y", Napi::Number::New(env, m.y));
  obj.Set("width", Napi::Number::New(env, m.width));
  obj.Set("height", Napi::Number::New(env, m.height));
  obj.Set("workAreaX", Napi::Number::New(env, m.workAreaX));
  obj.Set("workAreaY", Napi::Number::New(env, m.workAreaY));
  obj.Set("workAreaWidth", Napi::Number::New(env, m.workAreaWidth));
  obj.Set("workAreaHeight", Napi::Number::New(env, m.workAreaHeight));
  obj.Set("scale", Napi::Number::New(env, m.scale));
  obj.Set("isPrimary", Napi::Boolean::New(env, m.isPrimary));

  return obj;
}

static MonitorInfo GetMonitorDetails(HMONITOR hMonitor) {
  MonitorInfo info = {};

  MONITORINFOEXW mi = {};
  mi.cbSize = sizeof(mi);
  if (!GetMonitorInfoW(hMonitor, &mi)) return info;

  info.id = mi.szDevice;
  info.x = mi.rcMonitor.left;
  info.y = mi.rcMonitor.top;
  info.width = mi.rcMonitor.right - mi.rcMonitor.left;
  info.height = mi.rcMonitor.bottom - mi.rcMonitor.top;
  info.workAreaX = mi.rcWork.left;
  info.workAreaY = mi.rcWork.top;
  info.workAreaWidth = mi.rcWork.right - mi.rcWork.left;
  info.workAreaHeight = mi.rcWork.bottom - mi.rcWork.top;
  info.isPrimary = (mi.dwFlags & MONITORINFOF_PRIMARY) != 0;

  // DPI
  UINT dpiX = 96, dpiY = 96;
  GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
  info.scale = static_cast<double>(dpiX) / 96.0;

  return info;
}

// Callback for EnumDisplayMonitors
struct MonitorEnumContext {
  std::vector<MonitorInfo> monitors;
};

static BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC, LPRECT, LPARAM lParam) {
  auto* ctx = reinterpret_cast<MonitorEnumContext*>(lParam);
  ctx->monitors.push_back(GetMonitorDetails(hMonitor));
  return TRUE;
}

// ---- getCursorPos ----

static Napi::Value GetCursorPosNapi(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  POINT pt = {};
  GetCursorPos(&pt);

  result.Set("x", Napi::Number::New(env, pt.x));
  result.Set("y", Napi::Number::New(env, pt.y));
  return result;
}

// ---- getMonitors ----

static Napi::Value GetMonitors(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  MonitorEnumContext ctx;
  EnumDisplayMonitors(nullptr, nullptr, MonitorEnumProc, reinterpret_cast<LPARAM>(&ctx));

  Napi::Array result = Napi::Array::New(env, ctx.monitors.size());
  for (size_t i = 0; i < ctx.monitors.size(); i++) {
    result.Set(static_cast<uint32_t>(i), MonitorInfoToObject(env, ctx.monitors[i]));
  }

  return result;
}

// ---- getMonitorForPoint ----

static Napi::Value GetMonitorForPoint(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (x: number, y: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  POINT pt;
  pt.x = info[0].As<Napi::Number>().Int32Value();
  pt.y = info[1].As<Napi::Number>().Int32Value();

  HMONITOR hMonitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
  if (!hMonitor) {
    return env.Null();
  }

  MonitorInfo mi = GetMonitorDetails(hMonitor);
  return MonitorInfoToObject(env, mi);
}

// ---- isElevated ----

static Napi::Value IsElevated(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  HANDLE hToken = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
    return Napi::Boolean::New(env, false);
  }

  TOKEN_ELEVATION elevation = {};
  DWORD size = sizeof(elevation);
  BOOL result = GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &size);
  CloseHandle(hToken);

  if (!result) {
    return Napi::Boolean::New(env, false);
  }

  return Napi::Boolean::New(env, elevation.TokenIsElevated != 0);
}

// ---- isReducedMotion ----

static Napi::Value IsReducedMotion(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  BOOL animEnabled = TRUE;
  SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animEnabled, 0);

  // Reduced motion = animations disabled
  return Napi::Boolean::New(env, !animEnabled);
}

// ---- Init ----

Napi::Object InitMonitors(Napi::Env env, Napi::Object exports) {
  exports.Set("getCursorPos", Napi::Function::New(env, GetCursorPosNapi));
  exports.Set("getMonitors", Napi::Function::New(env, GetMonitors));
  exports.Set("getMonitorForPoint", Napi::Function::New(env, GetMonitorForPoint));
  exports.Set("isElevated", Napi::Function::New(env, IsElevated));
  exports.Set("isReducedMotion", Napi::Function::New(env, IsReducedMotion));
  return exports;
}

} // namespace filewheel

#else
// Stub for non-Windows
namespace filewheel {
Napi::Object InitMonitors(Napi::Env env, Napi::Object exports) { return exports; }
}
#endif
