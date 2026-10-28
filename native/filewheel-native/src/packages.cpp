/**
 * packages.cpp -- WinRT Package Manager queries
 *
 * Searches installed Windows packages (MSIX/AppX) by family name or
 * display name. Returns the AUMID needed for activation, the install
 * path, and the display name.
 *
 * Uses C++/WinRT with the Windows.Management.Deployment and
 * Windows.ApplicationModel namespaces.
 *
 * Exports:
 *   findPackage(packageFamilyName) -> {found, aumid, installPath, displayName} | null
 *   findPackageByDisplayName(name) -> {found, aumid, installPath, displayName} | null
 */

#include <napi.h>

#ifdef _WIN32

#include <windows.h>

// C++/WinRT headers
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Management.Deployment.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.ApplicationModel.Core.h>

#include <string>
#include <algorithm>

namespace filewheel {

// ---- Helpers ----

static std::string HStringToUtf8(const winrt::hstring& hs) {
  std::wstring wide(hs.c_str(), hs.size());
  if (wide.empty()) return {};
  int len = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()),
                                 nullptr, 0, nullptr, nullptr);
  std::string utf8(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()),
                       utf8.data(), len, nullptr, nullptr);
  return utf8;
}

static std::wstring Utf8ToWide(const std::string& utf8) {
  if (utf8.empty()) return {};
  int len = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(len, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), wide.data(), len);
  return wide;
}

static std::wstring ToLower(const std::wstring& s) {
  std::wstring lower = s;
  std::transform(lower.begin(), lower.end(), lower.begin(), ::towlower);
  return lower;
}

// Build the result object for a found package
static Napi::Object BuildPackageResult(
    Napi::Env env,
    const winrt::Windows::ApplicationModel::Package& pkg,
    const std::string& aumid) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("found", Napi::Boolean::New(env, true));
  result.Set("aumid", Napi::String::New(env, aumid));

  try {
    auto path = pkg.InstalledPath();
    result.Set("installPath", Napi::String::New(env, HStringToUtf8(path)));
  } catch (...) {
    result.Set("installPath", Napi::String::New(env, ""));
  }

  try {
    result.Set("displayName", Napi::String::New(env, HStringToUtf8(pkg.DisplayName())));
  } catch (...) {
    result.Set("displayName", Napi::String::New(env, ""));
  }

  return result;
}

// Get the first AUMID from a package's app list entries
static std::string GetFirstAumid(const winrt::Windows::ApplicationModel::Package& pkg) {
  try {
    auto entries = pkg.GetAppListEntries();
    if (entries.Size() > 0) {
      auto entry = entries.GetAt(0);
      return HStringToUtf8(entry.AppUserModelId());
    }
  } catch (...) {
    // Some packages may not support GetAppListEntries
  }
  return {};
}

// ---- findPackage ----

static Napi::Value FindPackage(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected packageFamilyName string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string familyName = info[0].As<Napi::String>().Utf8Value();

  try {
    winrt::Windows::Management::Deployment::PackageManager pm;
    auto packages = pm.FindPackagesForUser(L"", winrt::hstring(Utf8ToWide(familyName)));

    for (const auto& pkg : packages) {
      std::string aumid = GetFirstAumid(pkg);
      if (!aumid.empty()) {
        return BuildPackageResult(env, pkg, aumid);
      }

      // If no AUMID from app list entries, try constructing from family name + !App
      aumid = familyName + "!App";
      return BuildPackageResult(env, pkg, aumid);
    }
  } catch (const winrt::hresult_error&) {
    // Fall through to return null
  } catch (...) {
    // Fall through to return null
  }

  return env.Null();
}

// ---- findPackageByDisplayName ----

static Napi::Value FindPackageByDisplayName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected display name string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring searchName = ToLower(Utf8ToWide(info[0].As<Napi::String>().Utf8Value()));

  try {
    winrt::Windows::Management::Deployment::PackageManager pm;
    auto packages = pm.FindPackagesForUser(L"");

    for (const auto& pkg : packages) {
      std::wstring displayName;
      try {
        displayName = ToLower(std::wstring(pkg.DisplayName().c_str()));
      } catch (...) {
        continue; // Skip packages that fail to return display name
      }

      if (displayName.find(searchName) != std::wstring::npos) {
        std::string aumid = GetFirstAumid(pkg);
        if (aumid.empty()) {
          // Fallback AUMID
          aumid = HStringToUtf8(pkg.Id().FamilyName()) + "!App";
        }
        return BuildPackageResult(env, pkg, aumid);
      }
    }
  } catch (const winrt::hresult_error&) {
    // Fall through to return null
  } catch (...) {
    // Fall through to return null
  }

  return env.Null();
}

// ---- Init ----

Napi::Object InitPackages(Napi::Env env, Napi::Object exports) {
  exports.Set("findPackage", Napi::Function::New(env, FindPackage));
  exports.Set("findPackageByDisplayName", Napi::Function::New(env, FindPackageByDisplayName));
  return exports;
}

} // namespace filewheel

#else
// Stub for non-Windows
namespace filewheel {
Napi::Object InitPackages(Napi::Env env, Napi::Object exports) { return exports; }
}
#endif
