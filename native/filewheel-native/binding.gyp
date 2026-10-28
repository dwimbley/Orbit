{
  "targets": [
    {
      "target_name": "filewheel-native",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": [
        "src/module.cpp",
        "src/hook.cpp",
        "src/droptarget.cpp",
        "src/shell_assoc.cpp",
        "src/launch.cpp",
        "src/icons.cpp",
        "src/monitors.cpp",
        "src/packages.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_VERSION=9",
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": ["/std:c++20", "/EHsc", "/await"],
                "ExceptionHandling": 1
              }
            },
            "defines": [
              "UNICODE",
              "_UNICODE",
              "WIN32_LEAN_AND_MEAN",
              "NOMINMAX",
              "_WIN32_WINNT=0x0A00"
            ],
            "libraries": [
              "-lole32.lib",
              "-loleaut32.lib",
              "-lshell32.lib",
              "-lshlwapi.lib",
              "-ladvapi32.lib",
              "-luser32.lib",
              "-lgdi32.lib",
              "-lshcore.lib",
              "-lgdiplus.lib",
              "-lwindowsapp.lib"
            ]
          }
        ]
      ]
    }
  ]
}
