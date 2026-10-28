/**
 * filewheel-native — N-API addon entry point
 *
 * This native addon provides Win32 functionality that cannot be done from JS:
 *   - Low-level mouse/keyboard hooks for drag detection
 *   - OLE IDropTarget for receiving Explorer file drags
 *   - Shell association enumeration (SHAssocEnumHandlers, AssocQueryString)
 *   - App icon extraction
 *   - Process launch via CreateProcessW
 *   - Monitor/DPI info
 *   - Elevation check
 *   - Package manager queries (WinRT)
 */

#include <napi.h>

// Forward declarations for module components
namespace filewheel {
  Napi::Object InitHook(Napi::Env env, Napi::Object exports);
  Napi::Object InitDropTarget(Napi::Env env, Napi::Object exports);
  Napi::Object InitShellAssoc(Napi::Env env, Napi::Object exports);
  Napi::Object InitLaunch(Napi::Env env, Napi::Object exports);
  Napi::Object InitIcons(Napi::Env env, Napi::Object exports);
  Napi::Object InitMonitors(Napi::Env env, Napi::Object exports);
  Napi::Object InitPackages(Napi::Env env, Napi::Object exports);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  filewheel::InitHook(env, exports);
  filewheel::InitDropTarget(env, exports);
  filewheel::InitShellAssoc(env, exports);
  filewheel::InitLaunch(env, exports);
  filewheel::InitIcons(env, exports);
  filewheel::InitMonitors(env, exports);
  filewheel::InitPackages(env, exports);
  return exports;
}

NODE_API_MODULE(filewheel_native, Init)
