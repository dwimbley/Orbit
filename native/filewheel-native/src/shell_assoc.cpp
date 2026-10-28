/**
 * shell_assoc.cpp -- Shell association and file type info
 *
 * Queries Windows shell association data for file extensions:
 *   - Enumerate registered handlers (SHAssocEnumHandlers)
 *   - Get default handler info (AssocQueryStringW)
 *   - Invoke a handler on files
 *   - Retrieve file type metadata (type name, MIME, perceived type)
 *   - Check if an extension is dangerous (AssocIsDangerous)
 *   - Check for Mark of the Web (Zone.Identifier alternate stream)
 *   - Show the Open With dialog (SHOpenWithDialog)
 *
 * Exports:
 *   enumHandlers(ext) -> [{id, name, uiName, iconLocation, isRecommended, exePath}]
 *   getDefaultHandler(ext) -> {friendlyName, exePath, appId}
 *   invokeHandler(handlerId, filePaths) -> bool
 *   getFileTypeInfo(path) -> {typeName, mime, perceivedType, size, isFolder, childCount}
 *   isDangerous(ext) -> bool
 *   hasMotw(path) -> bool
 *   openWithDialog(path) -> void
 */

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <fstream>

#pragma comment(lib, "shlwapi.lib")

namespace filewheel {

// ---- Helpers ----

static std::wstring Utf8ToWide(const std::string& utf8) {
  if (utf8.empty()) return {};
  int len = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(len, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), wide.data(), len);
  return wide;
}

static std::string WideToUtf8(const std::wstring& wide) {
  if (wide.empty()) return {};
  int len = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  std::string utf8(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()), utf8.data(), len, nullptr, nullptr);
  return utf8;
}

static std::string WideToUtf8(PCWSTR wide) {
  if (!wide) return {};
  return WideToUtf8(std::wstring(wide));
}

// Cache of IAssocHandler objects keyed by handler id for invokeHandler
static std::mutex handlerCacheMutex;
static std::map<std::string, IAssocHandler*> handlerCache;

static void CacheHandler(const std::string& id, IAssocHandler* handler) {
  std::lock_guard<std::mutex> lock(handlerCacheMutex);
  auto it = handlerCache.find(id);
  if (it == handlerCache.end()) {
    handler->AddRef();
    handlerCache[id] = handler;
  }
}

// ---- enumHandlers ----

static Napi::Value EnumHandlers(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected extension string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring ext = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  if (!ext.empty() && ext[0] != L'.') ext = L"." + ext;

  IEnumAssocHandlers* pEnum = nullptr;
  HRESULT hr = SHAssocEnumHandlers(ext.c_str(), ASSOC_FILTER_RECOMMENDED, &pEnum);
  if (FAILED(hr) || !pEnum) {
    return Napi::Array::New(env, 0);
  }

  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;

  IAssocHandler* pHandler = nullptr;
  ULONG fetched = 0;
  while (pEnum->Next(1, &pHandler, &fetched) == S_OK && fetched > 0) {
    Napi::Object obj = Napi::Object::New(env);

    // Name (internal)
    PWSTR pszName = nullptr;
    if (SUCCEEDED(pHandler->GetName(&pszName)) && pszName) {
      std::string name = WideToUtf8(pszName);
      obj.Set("id", Napi::String::New(env, name));
      obj.Set("name", Napi::String::New(env, name));
      CacheHandler(name, pHandler);
      CoTaskMemFree(pszName);
    } else {
      obj.Set("id", Napi::String::New(env, ""));
      obj.Set("name", Napi::String::New(env, ""));
    }

    // UI Name (display name)
    PWSTR pszUIName = nullptr;
    if (SUCCEEDED(pHandler->GetUIName(&pszUIName)) && pszUIName) {
      obj.Set("uiName", Napi::String::New(env, WideToUtf8(pszUIName)));
      CoTaskMemFree(pszUIName);
    } else {
      obj.Set("uiName", Napi::String::New(env, ""));
    }

    // Icon location
    PWSTR pszIconPath = nullptr;
    int iconIndex = 0;
    if (SUCCEEDED(pHandler->GetIconLocation(&pszIconPath, &iconIndex)) && pszIconPath) {
      std::string loc = WideToUtf8(pszIconPath) + "," + std::to_string(iconIndex);
      obj.Set("iconLocation", Napi::String::New(env, loc));
      CoTaskMemFree(pszIconPath);
    } else {
      obj.Set("iconLocation", Napi::String::New(env, ""));
    }

    // isRecommended
    BOOL isRecommended = FALSE;
    pHandler->IsRecommended();
    isRecommended = (pHandler->IsRecommended() == S_OK);
    obj.Set("isRecommended", Napi::Boolean::New(env, isRecommended));

    // exePath -- get from the handler Name which is typically the exe path
    // The Name returned by GetName is usually the exe path on disk
    PWSTR pszExe = nullptr;
    if (SUCCEEDED(pHandler->GetName(&pszExe)) && pszExe) {
      obj.Set("exePath", Napi::String::New(env, WideToUtf8(pszExe)));
      CoTaskMemFree(pszExe);
    } else {
      obj.Set("exePath", Napi::String::New(env, ""));
    }

    result.Set(idx++, obj);
    pHandler->Release();
  }

  pEnum->Release();
  return result;
}

// ---- getDefaultHandler ----

static Napi::Value GetDefaultHandler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected extension string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring ext = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  if (!ext.empty() && ext[0] != L'.') ext = L"." + ext;

  Napi::Object result = Napi::Object::New(env);
  wchar_t buf[512] = {};
  DWORD bufLen;

  // Friendly app name
  bufLen = _countof(buf);
  if (SUCCEEDED(AssocQueryStringW(ASSOCF_NONE, ASSOCSTR_FRIENDLYAPPNAME, ext.c_str(), nullptr, buf, &bufLen))) {
    result.Set("friendlyName", Napi::String::New(env, WideToUtf8(buf)));
  } else {
    result.Set("friendlyName", Napi::String::New(env, ""));
  }

  // Executable path
  bufLen = _countof(buf);
  if (SUCCEEDED(AssocQueryStringW(ASSOCF_NONE, ASSOCSTR_EXECUTABLE, ext.c_str(), nullptr, buf, &bufLen))) {
    result.Set("exePath", Napi::String::New(env, WideToUtf8(buf)));
  } else {
    result.Set("exePath", Napi::String::New(env, ""));
  }

  // App ID
  bufLen = _countof(buf);
  if (SUCCEEDED(AssocQueryStringW(ASSOCF_NONE, ASSOCSTR_APPID, ext.c_str(), nullptr, buf, &bufLen))) {
    result.Set("appId", Napi::String::New(env, WideToUtf8(buf)));
  } else {
    result.Set("appId", Napi::String::New(env, ""));
  }

  return result;
}

// ---- invokeHandler ----

static Napi::Value InvokeHandler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsArray()) {
    Napi::TypeError::New(env, "Expected (handlerId: string, filePaths: string[])").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  std::string handlerId = info[0].As<Napi::String>().Utf8Value();
  auto pathsArr = info[1].As<Napi::Array>();

  IAssocHandler* handler = nullptr;
  {
    std::lock_guard<std::mutex> lock(handlerCacheMutex);
    auto it = handlerCache.find(handlerId);
    if (it != handlerCache.end()) {
      handler = it->second;
    }
  }

  if (!handler) {
    return Napi::Boolean::New(env, false);
  }

  // Build IShellItemArray from paths
  std::vector<IShellItem*> items;
  for (uint32_t i = 0; i < pathsArr.Length(); i++) {
    std::wstring path = Utf8ToWide(pathsArr.Get(i).As<Napi::String>().Utf8Value());
    IShellItem* psi = nullptr;
    if (SUCCEEDED(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(&psi)))) {
      items.push_back(psi);
    }
  }

  if (items.empty()) {
    return Napi::Boolean::New(env, false);
  }

  // Create IShellItemArray from the items
  IShellItemArray* psia = nullptr;
  HRESULT hr = SHCreateShellItemArrayFromShellItem(items[0], IID_PPV_ARGS(&psia));

  // For multiple items, use the data object approach
  if (items.size() > 1) {
    // Use SHCreateShellItemArrayFromIDLists
    std::vector<PIDLIST_ABSOLUTE> pidls;
    for (auto* item : items) {
      PIDLIST_ABSOLUTE pidl = nullptr;
      SHGetIDListFromObject(item, &pidl);
      if (pidl) pidls.push_back(pidl);
    }

    if (!pidls.empty()) {
      if (psia) psia->Release();
      SHCreateShellItemArrayFromIDLists(static_cast<UINT>(pidls.size()),
                                         const_cast<PCIDLIST_ABSOLUTE*>(pidls.data()),
                                         &psia);
      for (auto pidl : pidls) CoTaskMemFree(pidl);
    }
  }

  bool success = false;
  if (psia) {
    // Get IDataObject from the array
    IDataObject* pdo = nullptr;
    if (SUCCEEDED(psia->BindToHandler(nullptr, BHID_DataObject, IID_PPV_ARGS(&pdo)))) {
      success = SUCCEEDED(handler->Invoke(pdo));
      pdo->Release();
    }
    psia->Release();
  }

  for (auto* item : items) item->Release();

  return Napi::Boolean::New(env, success);
}

// ---- getFileTypeInfo ----

static Napi::Value GetFileTypeInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected path string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring path = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  Napi::Object result = Napi::Object::New(env);

  // Type name via SHGetFileInfoW
  SHFILEINFOW sfi = {};
  if (SHGetFileInfoW(path.c_str(), 0, &sfi, sizeof(sfi), SHGFI_TYPENAME)) {
    result.Set("typeName", Napi::String::New(env, WideToUtf8(sfi.szTypeName)));
  } else {
    result.Set("typeName", Napi::String::New(env, ""));
  }

  // Extract extension for registry queries
  std::wstring ext;
  size_t dotPos = path.rfind(L'.');
  if (dotPos != std::wstring::npos) {
    ext = path.substr(dotPos);
  }

  // MIME type from HKCR\.ext\Content Type
  std::string mime;
  if (!ext.empty()) {
    HKEY hKey = nullptr;
    if (RegOpenKeyExW(HKEY_CLASSES_ROOT, ext.c_str(), 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
      wchar_t mimeVal[256] = {};
      DWORD mimeLen = sizeof(mimeVal);
      if (RegQueryValueExW(hKey, L"Content Type", nullptr, nullptr,
                           reinterpret_cast<LPBYTE>(mimeVal), &mimeLen) == ERROR_SUCCESS) {
        mime = WideToUtf8(mimeVal);
      }
      RegCloseKey(hKey);
    }
  }
  result.Set("mime", Napi::String::New(env, mime));

  // Perceived type via AssocGetPerceivedType
  std::string perceived;
  if (!ext.empty()) {
    PERCEIVED perceivedType = PERCEIVED_TYPE_UNSPECIFIED;
    PERCEIVEDFLAG flag = {};
    PWSTR pszType = nullptr;
    if (SUCCEEDED(AssocGetPerceivedType(ext.c_str(), &perceivedType, &flag, &pszType))) {
      if (pszType) {
        perceived = WideToUtf8(pszType);
        CoTaskMemFree(pszType);
      }
    }
  }
  result.Set("perceivedType", Napi::String::New(env, perceived));

  // File size, isFolder, childCount
  WIN32_FILE_ATTRIBUTE_DATA fad = {};
  bool isFolder = false;
  uint64_t fileSize = 0;
  int childCount = 0;

  if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &fad)) {
    isFolder = (fad.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    if (!isFolder) {
      ULARGE_INTEGER uli;
      uli.HighPart = fad.nFileSizeHigh;
      uli.LowPart = fad.nFileSizeLow;
      fileSize = uli.QuadPart;
    } else {
      // Count immediate children
      std::wstring searchPath = path;
      if (searchPath.back() != L'\\') searchPath += L'\\';
      searchPath += L'*';

      WIN32_FIND_DATAW fd;
      HANDLE hFind = FindFirstFileW(searchPath.c_str(), &fd);
      if (hFind != INVALID_HANDLE_VALUE) {
        do {
          if (wcscmp(fd.cFileName, L".") != 0 && wcscmp(fd.cFileName, L"..") != 0) {
            childCount++;
          }
        } while (FindNextFileW(hFind, &fd));
        FindClose(hFind);
      }
    }
  }

  result.Set("size", Napi::Number::New(env, static_cast<double>(fileSize)));
  result.Set("isFolder", Napi::Boolean::New(env, isFolder));
  result.Set("childCount", Napi::Number::New(env, childCount));

  return result;
}

// ---- isDangerous ----

static Napi::Value IsDangerous(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected extension string").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  std::wstring ext = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  if (!ext.empty() && ext[0] != L'.') ext = L"." + ext;

  BOOL dangerous = AssocIsDangerous(ext.c_str());
  return Napi::Boolean::New(env, dangerous != FALSE);
}

// ---- hasMotw ----

static Napi::Value HasMotw(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected path string").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  std::wstring path = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  std::wstring adsPath = path + L":Zone.Identifier";

  // Read the Zone.Identifier alternate data stream
  HANDLE hFile = CreateFileW(adsPath.c_str(), GENERIC_READ, FILE_SHARE_READ,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (hFile == INVALID_HANDLE_VALUE) {
    return Napi::Boolean::New(env, false);
  }

  char buf[512] = {};
  DWORD bytesRead = 0;
  ReadFile(hFile, buf, sizeof(buf) - 1, &bytesRead, nullptr);
  CloseHandle(hFile);

  buf[bytesRead] = '\0';
  std::string content(buf);

  // Look for ZoneId=N where N >= 3
  size_t pos = content.find("ZoneId=");
  if (pos != std::string::npos) {
    int zoneId = std::atoi(content.c_str() + pos + 7);
    return Napi::Boolean::New(env, zoneId >= 3);
  }

  return Napi::Boolean::New(env, false);
}

// ---- openWithDialog ----

static Napi::Value OpenWithDialog(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected path string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring path = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());

  OPENASINFO oai = {};
  oai.pcszFile = path.c_str();
  oai.oaifInFlags = static_cast<OPEN_AS_INFO_FLAGS>(OAIF_EXEC | OAIF_HIDE_REGISTRATION);

  SHOpenWithDialog(nullptr, &oai);
  return env.Undefined();
}

// ---- Init ----

Napi::Object InitShellAssoc(Napi::Env env, Napi::Object exports) {
  exports.Set("enumHandlers", Napi::Function::New(env, EnumHandlers));
  exports.Set("getDefaultHandler", Napi::Function::New(env, GetDefaultHandler));
  exports.Set("invokeHandler", Napi::Function::New(env, InvokeHandler));
  exports.Set("getFileTypeInfo", Napi::Function::New(env, GetFileTypeInfo));
  exports.Set("isDangerous", Napi::Function::New(env, IsDangerous));
  exports.Set("hasMotw", Napi::Function::New(env, HasMotw));
  exports.Set("openWithDialog", Napi::Function::New(env, OpenWithDialog));
  return exports;
}

} // namespace filewheel

#else
// Stub for non-Windows
namespace filewheel {
Napi::Object InitShellAssoc(Napi::Env env, Napi::Object exports) { return exports; }
}
#endif
