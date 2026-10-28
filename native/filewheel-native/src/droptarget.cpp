/**
 * droptarget.cpp — OLE IDropTarget on a dedicated STA thread
 *
 * Creates an invisible but hit-testable layered window registered as an
 * OLE drop target. Hit-tests synchronously inside DragOver using the
 * same algorithm as /packages/core (shared test vectors).
 *
 * The window uses:
 *   WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
 *   (no WS_EX_TRANSPARENT — it must receive drag events)
 *
 * Never returns DROPEFFECT_MOVE. Prefers LINK, then COPY.
 */

#define _USE_MATH_DEFINES
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <ole2.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>
#include <cmath>

namespace filewheel {

// Geometry for hit-testing
struct DropGeometry {
  double centerX, centerY;
  double outerR, innerR;
  int wedgeCount;
  bool isEmpty;
  double scale;
};

static Napi::ThreadSafeFunction dropTsfn;
static std::thread dropThread;
static std::atomic<bool> dropRunning{false};
static HWND dropHwnd = nullptr;
static std::mutex geomMutex;
static DropGeometry currentGeom = {};

// Hit-test: same algorithm as packages/core/src/hit-test.ts
struct HitResult {
  enum Type { Center, Wedge, Outside } type;
  int index; // only meaningful for Wedge
};

static HitResult HitTest(double px, double py, const DropGeometry& g) {
  double dx = px - g.centerX;
  double dy = py - g.centerY;
  double d = std::sqrt(dx * dx + dy * dy);

  if (g.isEmpty) {
    if (d <= g.outerR + 12 + 24) return {HitResult::Center, -1};
    return {HitResult::Outside, -1};
  }

  if (d <= g.innerR) return {HitResult::Center, -1};

  if (d <= g.outerR + 12 + 24 && g.wedgeCount > 0) {
    // Angle: 0 at 12 o'clock, clockwise
    double angle = std::atan2(dx, -dy); // Note: swapped for 12-o'clock origin
    if (angle < 0) angle += 2.0 * M_PI;
    double step = 2.0 * M_PI / g.wedgeCount;
    int index = static_cast<int>(std::floor(std::fmod(angle + step / 2.0, 2.0 * M_PI) / step));
    if (index >= g.wedgeCount) index = 0;
    return {HitResult::Wedge, index};
  }

  return {HitResult::Outside, -1};
}

// Emit events to JS
enum class DropEventType { Enter, Hover, Drop, Leave };

static void EmitDropEvent(DropEventType type, const std::vector<std::wstring>& paths = {},
                           HitResult hit = {HitResult::Outside, -1}) {
  if (!dropTsfn) return;

  struct EventData {
    DropEventType type;
    std::vector<std::wstring> paths;
    HitResult hit;
  };

  auto data = new EventData{type, paths, hit};
  dropTsfn.NonBlockingCall(data, [](Napi::Env env, Napi::Function fn, EventData* d) {
    Napi::Object event = Napi::Object::New(env);

    switch (d->type) {
      case DropEventType::Enter: {
        event.Set("type", Napi::String::New(env, "enter"));
        auto items = Napi::Array::New(env, d->paths.size());
        for (size_t i = 0; i < d->paths.size(); i++) {
          // Convert wstring to UTF-8
          int len = WideCharToMultiByte(CP_UTF8, 0, d->paths[i].c_str(), -1, nullptr, 0, nullptr, nullptr);
          std::string utf8(len - 1, 0);
          WideCharToMultiByte(CP_UTF8, 0, d->paths[i].c_str(), -1, utf8.data(), len, nullptr, nullptr);
          items.Set(static_cast<uint32_t>(i), Napi::String::New(env, utf8));
        }
        event.Set("items", items);
        break;
      }
      case DropEventType::Hover: {
        event.Set("type", Napi::String::New(env, "hover"));
        Napi::Object target = Napi::Object::New(env);
        switch (d->hit.type) {
          case HitResult::Center: target.Set("type", Napi::String::New(env, "center")); break;
          case HitResult::Wedge:
            target.Set("type", Napi::String::New(env, "wedge"));
            target.Set("index", Napi::Number::New(env, d->hit.index));
            break;
          case HitResult::Outside: target.Set("type", Napi::String::New(env, "outside")); break;
        }
        event.Set("target", target);
        break;
      }
      case DropEventType::Drop: {
        event.Set("type", Napi::String::New(env, "drop"));
        Napi::Object target = Napi::Object::New(env);
        switch (d->hit.type) {
          case HitResult::Center: target.Set("type", Napi::String::New(env, "center")); break;
          case HitResult::Wedge:
            target.Set("type", Napi::String::New(env, "wedge"));
            target.Set("index", Napi::Number::New(env, d->hit.index));
            break;
          case HitResult::Outside: target.Set("type", Napi::String::New(env, "outside")); break;
        }
        event.Set("target", target);
        auto items = Napi::Array::New(env, d->paths.size());
        for (size_t i = 0; i < d->paths.size(); i++) {
          int len = WideCharToMultiByte(CP_UTF8, 0, d->paths[i].c_str(), -1, nullptr, 0, nullptr, nullptr);
          std::string utf8(len - 1, 0);
          WideCharToMultiByte(CP_UTF8, 0, d->paths[i].c_str(), -1, utf8.data(), len, nullptr, nullptr);
          items.Set(static_cast<uint32_t>(i), Napi::String::New(env, utf8));
        }
        event.Set("items", items);
        break;
      }
      case DropEventType::Leave:
        event.Set("type", Napi::String::New(env, "leave"));
        break;
    }

    fn.Call({event});
    delete d;
  });
}

// Extract file paths from IDataObject
static std::vector<std::wstring> ExtractPaths(IDataObject* pDataObj) {
  std::vector<std::wstring> paths;

  // Try SHCreateShellItemArrayFromDataObject first
  IShellItemArray* psia = nullptr;
  if (SUCCEEDED(SHCreateShellItemArrayFromDataObject(pDataObj, IID_PPV_ARGS(&psia)))) {
    DWORD count = 0;
    psia->GetCount(&count);
    for (DWORD i = 0; i < count; i++) {
      IShellItem* psi = nullptr;
      if (SUCCEEDED(psia->GetItemAt(i, &psi))) {
        PWSTR pszPath = nullptr;
        if (SUCCEEDED(psi->GetDisplayName(SIGDN_FILESYSPATH, &pszPath))) {
          paths.emplace_back(pszPath);
          CoTaskMemFree(pszPath);
        }
        psi->Release();
      }
    }
    psia->Release();
    if (!paths.empty()) return paths;
  }

  // Fallback to CF_HDROP
  FORMATETC fmt = {CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
  STGMEDIUM stg = {};
  if (SUCCEEDED(pDataObj->GetData(&fmt, &stg))) {
    HDROP hDrop = static_cast<HDROP>(GlobalLock(stg.hGlobal));
    if (hDrop) {
      UINT count = DragQueryFileW(hDrop, 0xFFFFFFFF, nullptr, 0);
      for (UINT i = 0; i < count; i++) {
        UINT len = DragQueryFileW(hDrop, i, nullptr, 0);
        std::wstring path(len, L'\0');
        DragQueryFileW(hDrop, i, path.data(), len + 1);
        paths.push_back(path);
      }
      GlobalUnlock(stg.hGlobal);
    }
    ReleaseStgMedium(&stg);
  }

  return paths;
}

// IDropTarget implementation
class FileWheelDropTarget : public IDropTarget {
  LONG refCount = 1;
  IDropTargetHelper* pHelper = nullptr;
  std::vector<std::wstring> currentPaths;
  HitResult lastHit = {HitResult::Outside, -1};

public:
  FileWheelDropTarget() {
    CoCreateInstance(CLSID_DragDropHelper, nullptr, CLSCTX_INPROC_SERVER,
                     IID_PPV_ARGS(&pHelper));
  }

  ~FileWheelDropTarget() {
    if (pHelper) pHelper->Release();
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (riid == IID_IUnknown || riid == IID_IDropTarget) {
      *ppv = static_cast<IDropTarget*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }

  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG c = InterlockedDecrement(&refCount);
    if (c == 0) delete this;
    return c;
  }

  HRESULT STDMETHODCALLTYPE DragEnter(IDataObject* pDataObj, DWORD grfKeyState,
                                        POINTL pt, DWORD* pdwEffect) override {
    if (pHelper) pHelper->DragEnter(dropHwnd, pDataObj, reinterpret_cast<POINT*>(&pt), *pdwEffect);

    currentPaths = ExtractPaths(pDataObj);
    EmitDropEvent(DropEventType::Enter, currentPaths);

    // Never MOVE
    *pdwEffect &= ~DROPEFFECT_MOVE;
    if (*pdwEffect & DROPEFFECT_LINK) *pdwEffect = DROPEFFECT_LINK;
    else if (*pdwEffect & DROPEFFECT_COPY) *pdwEffect = DROPEFFECT_COPY;
    else *pdwEffect = DROPEFFECT_NONE;

    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE DragOver(DWORD grfKeyState, POINTL pt, DWORD* pdwEffect) override {
    if (pHelper) pHelper->DragOver(reinterpret_cast<POINT*>(&pt), *pdwEffect);

    // Synchronous hit-test
    DropGeometry geom;
    {
      std::lock_guard<std::mutex> lock(geomMutex);
      geom = currentGeom;
    }

    // Convert screen coords to geometry-relative coords
    RECT rc;
    GetWindowRect(dropHwnd, &rc);
    double localX = (pt.x - rc.left) / geom.scale;
    double localY = (pt.y - rc.top) / geom.scale;

    HitResult hit = HitTest(localX, localY, geom);

    // Only emit when target changes
    if (hit.type != lastHit.type || hit.index != lastHit.index) {
      lastHit = hit;
      EmitDropEvent(DropEventType::Hover, {}, hit);
    }

    // Never MOVE
    *pdwEffect &= ~DROPEFFECT_MOVE;
    if (hit.type == HitResult::Wedge) {
      if (*pdwEffect & DROPEFFECT_LINK) *pdwEffect = DROPEFFECT_LINK;
      else if (*pdwEffect & DROPEFFECT_COPY) *pdwEffect = DROPEFFECT_COPY;
      else *pdwEffect = DROPEFFECT_NONE;
    } else {
      *pdwEffect = DROPEFFECT_NONE;
    }

    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE DragLeave() override {
    if (pHelper) pHelper->DragLeave();
    currentPaths.clear();
    lastHit = {HitResult::Outside, -1};
    EmitDropEvent(DropEventType::Leave);
    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE Drop(IDataObject* pDataObj, DWORD grfKeyState,
                                    POINTL pt, DWORD* pdwEffect) override {
    if (pHelper) pHelper->Drop(pDataObj, reinterpret_cast<POINT*>(&pt), *pdwEffect);

    auto paths = ExtractPaths(pDataObj);

    DropGeometry geom;
    {
      std::lock_guard<std::mutex> lock(geomMutex);
      geom = currentGeom;
    }

    RECT rc;
    GetWindowRect(dropHwnd, &rc);
    double localX = (pt.x - rc.left) / geom.scale;
    double localY = (pt.y - rc.top) / geom.scale;

    HitResult hit = HitTest(localX, localY, geom);
    EmitDropEvent(DropEventType::Drop, paths, hit);

    // Never MOVE
    *pdwEffect &= ~DROPEFFECT_MOVE;
    if (hit.type == HitResult::Wedge) {
      if (*pdwEffect & DROPEFFECT_LINK) *pdwEffect = DROPEFFECT_LINK;
      else *pdwEffect = DROPEFFECT_COPY;
    } else {
      *pdwEffect = DROPEFFECT_NONE;
    }

    currentPaths.clear();
    lastHit = {HitResult::Outside, -1};
    return S_OK;
  }
};

static FileWheelDropTarget* pDropTarget = nullptr;
static const wchar_t* DROP_CLASS = L"FileWheelDropSurface";

static LRESULT CALLBACK DropWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static void DropThreadProc() {
  OleInitialize(nullptr);

  WNDCLASSEXW wc = {};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = DropWndProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = DROP_CLASS;
  RegisterClassExW(&wc);

  dropHwnd = CreateWindowExW(
    WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
    DROP_CLASS, L"", WS_POPUP,
    0, 0, 1, 1,
    nullptr, nullptr, GetModuleHandleW(nullptr), nullptr
  );

  if (dropHwnd) {
    // Invisible but hit-testable
    SetLayeredWindowAttributes(dropHwnd, 0, 1, LWA_ALPHA);

    pDropTarget = new FileWheelDropTarget();
    RegisterDragDrop(dropHwnd, pDropTarget);
  }

  MSG msg;
  while (dropRunning.load() && GetMessage(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  if (dropHwnd) {
    RevokeDragDrop(dropHwnd);
    DestroyWindow(dropHwnd);
    dropHwnd = nullptr;
  }
  if (pDropTarget) {
    pDropTarget->Release();
    pDropTarget = nullptr;
  }

  OleUninitialize();
}

// N-API exports

static Napi::Value DropSurfaceStart(const Napi::CallbackInfo& info) {
  if (dropRunning.load()) return info.Env().Undefined();
  dropRunning.store(true);
  dropThread = std::thread(DropThreadProc);
  return info.Env().Undefined();
}

static Napi::Value DropSurfaceStop(const Napi::CallbackInfo& info) {
  dropRunning.store(false);
  if (dropHwnd) PostMessage(dropHwnd, WM_QUIT, 0, 0);
  if (dropThread.joinable()) dropThread.join();
  if (dropTsfn) { dropTsfn.Release(); dropTsfn = nullptr; }
  return info.Env().Undefined();
}

static Napi::Value DropSurfaceShow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!dropHwnd || info.Length() < 2) return env.Undefined();

  auto rect = info[0].As<Napi::Object>();
  int x = rect.Get("x").As<Napi::Number>().Int32Value();
  int y = rect.Get("y").As<Napi::Number>().Int32Value();
  int w = rect.Get("width").As<Napi::Number>().Int32Value();
  int h = rect.Get("height").As<Napi::Number>().Int32Value();

  auto geom = info[1].As<Napi::Object>();
  {
    std::lock_guard<std::mutex> lock(geomMutex);
    currentGeom.centerX = geom.Get("centerX").As<Napi::Number>().DoubleValue();
    currentGeom.centerY = geom.Get("centerY").As<Napi::Number>().DoubleValue();
    currentGeom.outerR = geom.Get("outerRadius").As<Napi::Number>().DoubleValue();
    currentGeom.innerR = geom.Get("innerRadius").As<Napi::Number>().DoubleValue();
    currentGeom.wedgeCount = geom.Get("wedgeCount").As<Napi::Number>().Int32Value();
    currentGeom.isEmpty = geom.Get("isEmpty").As<Napi::Boolean>().Value();
    currentGeom.scale = geom.Get("scale").As<Napi::Number>().DoubleValue();
  }

  SetWindowPos(dropHwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  return env.Undefined();
}

static Napi::Value DropSurfaceHide(const Napi::CallbackInfo& info) {
  if (dropHwnd) ShowWindow(dropHwnd, SW_HIDE);
  return info.Env().Undefined();
}

static Napi::Value DropSurfaceOnEvent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (dropTsfn) dropTsfn.Release();
  dropTsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "DropEvent", 0, 1);
  return env.Undefined();
}

Napi::Object InitDropTarget(Napi::Env env, Napi::Object exports) {
  exports.Set("dropSurfaceStart", Napi::Function::New(env, DropSurfaceStart));
  exports.Set("dropSurfaceStop", Napi::Function::New(env, DropSurfaceStop));
  exports.Set("dropSurfaceShow", Napi::Function::New(env, DropSurfaceShow));
  exports.Set("dropSurfaceHide", Napi::Function::New(env, DropSurfaceHide));
  exports.Set("dropSurfaceOnEvent", Napi::Function::New(env, DropSurfaceOnEvent));
  return exports;
}

} // namespace filewheel

#else
namespace filewheel {
Napi::Object InitDropTarget(Napi::Env env, Napi::Object exports) { return exports; }
}
#endif
