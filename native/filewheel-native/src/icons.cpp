/**
 * icons.cpp -- Icon extraction
 *
 * Extracts application icons as PNG buffers for display in the file wheel.
 * Uses SHDefExtractIconW for traditional desktop apps and
 * IShellItemImageFactory via shell:AppsFolder for packaged/UWP apps.
 *
 * Exports:
 *   extractIcon(exePath, size) -> Buffer (PNG)
 *   extractPackageIcon(aumid, size) -> Buffer (PNG)
 */

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <gdiplus.h>
#include <string>
#include <vector>

#pragma comment(lib, "gdiplus.lib")

namespace filewheel {

// ---- GDI+ lifecycle ----

static ULONG_PTR gdipToken = 0;

static void EnsureGdiPlus() {
  if (gdipToken == 0) {
    Gdiplus::GdiplusStartupInput input;
    Gdiplus::GdiplusStartup(&gdipToken, &input, nullptr);
  }
}

// ---- Helpers ----

static std::wstring Utf8ToWide(const std::string& utf8) {
  if (utf8.empty()) return {};
  int len = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(len, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), wide.data(), len);
  return wide;
}

// Get the CLSID for a GDI+ encoder by MIME type
static bool GetEncoderClsid(const wchar_t* format, CLSID* pClsid) {
  UINT num = 0, size = 0;
  Gdiplus::GetImageEncodersSize(&num, &size);
  if (size == 0) return false;

  std::vector<BYTE> buf(size);
  auto* codecs = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buf.data());
  Gdiplus::GetImageEncoders(num, size, codecs);

  for (UINT i = 0; i < num; i++) {
    if (wcscmp(codecs[i].MimeType, format) == 0) {
      *pClsid = codecs[i].Clsid;
      return true;
    }
  }
  return false;
}

// Convert an HBITMAP to PNG bytes in a buffer
static std::vector<uint8_t> HBitmapToPng(HBITMAP hBitmap, int width, int height) {
  EnsureGdiPlus();
  std::vector<uint8_t> result;

  Gdiplus::Bitmap* bmp = Gdiplus::Bitmap::FromHBITMAP(hBitmap, nullptr);
  if (!bmp) return result;

  CLSID pngClsid;
  if (!GetEncoderClsid(L"image/png", &pngClsid)) {
    delete bmp;
    return result;
  }

  // Write to an IStream
  IStream* pStream = nullptr;
  if (SUCCEEDED(CreateStreamOnHGlobal(nullptr, TRUE, &pStream))) {
    if (bmp->Save(pStream, &pngClsid, nullptr) == Gdiplus::Ok) {
      // Get stream size
      STATSTG stat;
      pStream->Stat(&stat, STATFLAG_NONAME);
      ULONG size = stat.cbSize.LowPart;

      // Seek to beginning and read
      LARGE_INTEGER li = {};
      pStream->Seek(li, STREAM_SEEK_SET, nullptr);
      result.resize(size);
      ULONG read = 0;
      pStream->Read(result.data(), size, &read);
      result.resize(read);
    }
    pStream->Release();
  }

  delete bmp;
  return result;
}

// Convert HICON to PNG bytes
static std::vector<uint8_t> HIconToPng(HICON hIcon, int size) {
  EnsureGdiPlus();
  std::vector<uint8_t> result;

  Gdiplus::Bitmap* bmp = Gdiplus::Bitmap::FromHICON(hIcon);
  if (!bmp) return result;

  // Resize if needed
  Gdiplus::Bitmap* resized = nullptr;
  if (static_cast<int>(bmp->GetWidth()) != size || static_cast<int>(bmp->GetHeight()) != size) {
    resized = new Gdiplus::Bitmap(size, size, PixelFormat32bppARGB);
    Gdiplus::Graphics g(resized);
    g.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
    g.DrawImage(bmp, 0, 0, size, size);
    delete bmp;
    bmp = resized;
  }

  CLSID pngClsid;
  if (!GetEncoderClsid(L"image/png", &pngClsid)) {
    delete bmp;
    return result;
  }

  IStream* pStream = nullptr;
  if (SUCCEEDED(CreateStreamOnHGlobal(nullptr, TRUE, &pStream))) {
    if (bmp->Save(pStream, &pngClsid, nullptr) == Gdiplus::Ok) {
      STATSTG stat;
      pStream->Stat(&stat, STATFLAG_NONAME);
      ULONG pngSize = stat.cbSize.LowPart;

      LARGE_INTEGER li = {};
      pStream->Seek(li, STREAM_SEEK_SET, nullptr);
      result.resize(pngSize);
      ULONG read = 0;
      pStream->Read(result.data(), pngSize, &read);
      result.resize(read);
    }
    pStream->Release();
  }

  delete bmp;
  return result;
}

// ---- extractIcon ----

static Napi::Value ExtractIcon(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (exePath: string, size: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring exePath = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  int size = info[1].As<Napi::Number>().Int32Value();
  if (size <= 0) size = 80;

  // Try IShellItemImageFactory first for best quality
  IShellItem* psi = nullptr;
  if (SUCCEEDED(SHCreateItemFromParsingName(exePath.c_str(), nullptr, IID_PPV_ARGS(&psi)))) {
    IShellItemImageFactory* pFactory = nullptr;
    if (SUCCEEDED(psi->QueryInterface(IID_PPV_ARGS(&pFactory)))) {
      HBITMAP hBitmap = nullptr;
      SIZE sz = {size, size};
      if (SUCCEEDED(pFactory->GetImage(sz, SIIGBF_RESIZETOFIT, &hBitmap))) {
        auto png = HBitmapToPng(hBitmap, size, size);
        DeleteObject(hBitmap);
        pFactory->Release();
        psi->Release();

        if (!png.empty()) {
          return Napi::Buffer<uint8_t>::Copy(env, png.data(), png.size());
        }
      }
      pFactory->Release();
    }
    psi->Release();
  }

  // Fallback: SHDefExtractIconW
  HICON hIconLarge = nullptr;
  HICON hIconSmall = nullptr;
  UINT iconSize = MAKELONG(size, 16);
  HRESULT hr = SHDefExtractIconW(exePath.c_str(), 0, 0, &hIconLarge, &hIconSmall, iconSize);

  if (SUCCEEDED(hr) && hIconLarge) {
    auto png = HIconToPng(hIconLarge, size);
    DestroyIcon(hIconLarge);
    if (hIconSmall) DestroyIcon(hIconSmall);

    if (!png.empty()) {
      return Napi::Buffer<uint8_t>::Copy(env, png.data(), png.size());
    }
  }

  // Last fallback: ExtractIconExW
  HICON hIcon = nullptr;
  ExtractIconExW(exePath.c_str(), 0, &hIcon, nullptr, 1);
  if (hIcon) {
    auto png = HIconToPng(hIcon, size);
    DestroyIcon(hIcon);
    if (!png.empty()) {
      return Napi::Buffer<uint8_t>::Copy(env, png.data(), png.size());
    }
  }

  // Return empty buffer on failure
  return Napi::Buffer<uint8_t>::New(env, 0);
}

// ---- extractPackageIcon ----

static Napi::Value ExtractPackageIcon(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (aumid: string, size: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::wstring aumid = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  int size = info[1].As<Napi::Number>().Int32Value();
  if (size <= 0) size = 80;

  // Build the shell:AppsFolder\<AUMID> path to get a shell item
  std::wstring appsFolder = L"shell:AppsFolder\\" + aumid;

  IShellItem* psi = nullptr;
  HRESULT hr = SHCreateItemFromParsingName(appsFolder.c_str(), nullptr, IID_PPV_ARGS(&psi));

  // If direct parsing fails, try via KNOWNFOLDERID
  if (FAILED(hr)) {
    PIDLIST_ABSOLUTE pidlApps = nullptr;
    if (SUCCEEDED(SHGetKnownFolderIDList(FOLDERID_AppsFolder, 0, nullptr, &pidlApps))) {
      IShellFolder* pApps = nullptr;
      if (SUCCEEDED(SHBindToObject(nullptr, pidlApps, nullptr, IID_PPV_ARGS(&pApps)))) {
        PIDLIST_RELATIVE pidlChild = nullptr;
        ULONG eaten = 0;
        if (SUCCEEDED(pApps->ParseDisplayName(nullptr, nullptr, const_cast<LPWSTR>(aumid.c_str()),
                                               &eaten, &pidlChild, nullptr))) {
          PIDLIST_ABSOLUTE pidlFull = ILCombine(pidlApps, pidlChild);
          if (pidlFull) {
            SHCreateItemFromIDList(pidlFull, IID_PPV_ARGS(&psi));
            CoTaskMemFree(pidlFull);
          }
          CoTaskMemFree(pidlChild);
        }
        pApps->Release();
      }
      CoTaskMemFree(pidlApps);
    }
  }

  if (psi) {
    IShellItemImageFactory* pFactory = nullptr;
    if (SUCCEEDED(psi->QueryInterface(IID_PPV_ARGS(&pFactory)))) {
      HBITMAP hBitmap = nullptr;
      SIZE sz = {size, size};
      if (SUCCEEDED(pFactory->GetImage(sz, SIIGBF_RESIZETOFIT, &hBitmap))) {
        auto png = HBitmapToPng(hBitmap, size, size);
        DeleteObject(hBitmap);
        pFactory->Release();
        psi->Release();

        if (!png.empty()) {
          return Napi::Buffer<uint8_t>::Copy(env, png.data(), png.size());
        }
      }
      pFactory->Release();
    }
    psi->Release();
  }

  // Return empty buffer on failure
  return Napi::Buffer<uint8_t>::New(env, 0);
}

// ---- Init ----

Napi::Object InitIcons(Napi::Env env, Napi::Object exports) {
  EnsureGdiPlus();
  exports.Set("extractIcon", Napi::Function::New(env, ExtractIcon));
  exports.Set("extractPackageIcon", Napi::Function::New(env, ExtractPackageIcon));
  return exports;
}

} // namespace filewheel

#else
// Stub for non-Windows
namespace filewheel {
Napi::Object InitIcons(Napi::Env env, Napi::Object exports) { return exports; }
}
#endif
