/**
 * launch.cpp -- Process launching
 *
 * Creates child processes via CreateProcessW and activates UWP/packaged
 * apps via IApplicationActivationManager::ActivateForFile.
 *
 * Exports:
 *   createProcess(exePath, args, workingDir) -> {success, error, errorCode}
 *   activateForFile(aumid, filePaths) -> bool
 */

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <string>
#include <vector>

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

/**
 * Quote a single argument following CommandLineToArgvW escaping rules:
 *   - If the arg contains spaces, tabs, or double-quotes, wrap in double-quotes.
 *   - Backslashes before a double-quote must be doubled.
 *   - A trailing run of backslashes before the closing quote must be doubled.
 */
static std::wstring QuoteArg(const std::wstring& arg) {
  if (arg.empty()) return L"\"\"";

  bool needsQuote = false;
  for (auto ch : arg) {
    if (ch == L' ' || ch == L'\t' || ch == L'"') {
      needsQuote = true;
      break;
    }
  }

  if (!needsQuote) return arg;

  std::wstring result = L"\"";
  size_t backslashes = 0;

  for (auto ch : arg) {
    if (ch == L'\\') {
      backslashes++;
    } else if (ch == L'"') {
      // Double backslashes before a quote, then escape the quote
      result.append(backslashes * 2 + 1, L'\\');
      result += L'"';
      backslashes = 0;
    } else {
      result.append(backslashes, L'\\');
      result += ch;
      backslashes = 0;
    }
  }

  // Double trailing backslashes before closing quote
  result.append(backslashes * 2, L'\\');
  result += L'"';
  return result;
}

// ---- createProcess ----

static Napi::Value CreateProcessNapi(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsArray() || !info[2].IsString()) {
    Napi::TypeError::New(env, "Expected (exePath: string, args: string[], workingDir: string)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring exePath = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  auto argsArr = info[1].As<Napi::Array>();
  std::wstring workingDir = Utf8ToWide(info[2].As<Napi::String>().Utf8Value());

  // Build command line: quoted exe + quoted args
  std::wstring cmdLine = QuoteArg(exePath);
  for (uint32_t i = 0; i < argsArr.Length(); i++) {
    std::wstring arg = Utf8ToWide(argsArr.Get(i).As<Napi::String>().Utf8Value());
    cmdLine += L' ';
    cmdLine += QuoteArg(arg);
  }

  STARTUPINFOW si = {};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi = {};

  Napi::Object result = Napi::Object::New(env);

  // CreateProcessW needs a mutable command line buffer
  std::vector<wchar_t> cmdBuf(cmdLine.begin(), cmdLine.end());
  cmdBuf.push_back(L'\0');

  BOOL ok = CreateProcessW(
    nullptr,               // lpApplicationName -- let it parse from command line
    cmdBuf.data(),         // lpCommandLine
    nullptr,               // lpProcessAttributes
    nullptr,               // lpThreadAttributes
    FALSE,                 // bInheritHandles
    CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
    nullptr,               // lpEnvironment
    workingDir.empty() ? nullptr : workingDir.c_str(),
    &si,
    &pi
  );

  if (ok) {
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    result.Set("success", Napi::Boolean::New(env, true));
    result.Set("error", Napi::String::New(env, ""));
    result.Set("errorCode", Napi::Number::New(env, 0));
  } else {
    DWORD err = GetLastError();
    wchar_t* msgBuf = nullptr;
    FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, err, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      reinterpret_cast<LPWSTR>(&msgBuf), 0, nullptr
    );
    std::string errMsg = msgBuf ? WideToUtf8(msgBuf) : "Unknown error";
    if (msgBuf) LocalFree(msgBuf);

    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", Napi::String::New(env, errMsg));
    result.Set("errorCode", Napi::Number::New(env, static_cast<double>(err)));
  }

  return result;
}

// ---- activateForFile ----

static Napi::Value ActivateForFile(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsArray()) {
    Napi::TypeError::New(env, "Expected (aumid: string, filePaths: string[])")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  std::wstring aumid = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  auto pathsArr = info[1].As<Napi::Array>();

  // Build IShellItemArray from file paths
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

  // Build PIDL array and create IShellItemArray
  std::vector<PIDLIST_ABSOLUTE> pidls;
  for (auto* item : items) {
    PIDLIST_ABSOLUTE pidl = nullptr;
    SHGetIDListFromObject(item, &pidl);
    if (pidl) pidls.push_back(pidl);
  }

  IShellItemArray* psia = nullptr;
  bool success = false;

  if (!pidls.empty()) {
    HRESULT hr = SHCreateShellItemArrayFromIDLists(
      static_cast<UINT>(pidls.size()),
      const_cast<PCIDLIST_ABSOLUTE*>(pidls.data()),
      &psia
    );

    if (SUCCEEDED(hr) && psia) {
      IApplicationActivationManager* paam = nullptr;
      hr = CoCreateInstance(
        CLSID_ApplicationActivationManager, nullptr, CLSCTX_LOCAL_SERVER,
        IID_PPV_ARGS(&paam)
      );

      if (SUCCEEDED(hr) && paam) {
        DWORD pid = 0;
        hr = paam->ActivateForFile(aumid.c_str(), psia, nullptr, &pid);
        success = SUCCEEDED(hr);
        paam->Release();
      }
      psia->Release();
    }

    for (auto pidl : pidls) CoTaskMemFree(pidl);
  }

  for (auto* item : items) item->Release();

  return Napi::Boolean::New(env, success);
}

// ---- Init ----

Napi::Object InitLaunch(Napi::Env env, Napi::Object exports) {
  exports.Set("createProcess", Napi::Function::New(env, CreateProcessNapi));
  exports.Set("activateForFile", Napi::Function::New(env, ActivateForFile));
  return exports;
}

} // namespace filewheel

#else
// Stub for non-Windows
namespace filewheel {
Napi::Object InitLaunch(Napi::Env env, Napi::Object exports) { return exports; }
}
#endif
