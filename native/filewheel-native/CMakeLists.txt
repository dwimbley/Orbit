cmake_minimum_required(VERSION 3.15)
project(filewheel-native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Node.js / N-API
include_directories(${CMAKE_JS_INC})
file(GLOB SOURCE_FILES "src/*.cpp" "src/*.h")

# Find the delay-load hook from cmake-js (required for Electron)
set(DELAY_HOOK "")
if(WIN32 AND CMAKE_JS_SRC)
  set(DELAY_HOOK ${CMAKE_JS_SRC})
elseif(WIN32)
  # Find it relative to project root in node_modules
  file(GLOB_RECURSE DELAY_HOOK_SEARCH "${CMAKE_SOURCE_DIR}/../../node_modules/cmake-js/lib/cpp/win_delay_load_hook.cc")
  if(DELAY_HOOK_SEARCH)
    list(GET DELAY_HOOK_SEARCH 0 DELAY_HOOK)
    message(STATUS "Found delay-load hook: ${DELAY_HOOK}")
  endif()
endif()

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${DELAY_HOOK})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

# Link node-addon-api
execute_process(
  COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
target_include_directories(${PROJECT_NAME} PRIVATE ${NODE_ADDON_API_DIR})

# N-API version
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=9 NAPI_DISABLE_CPP_EXCEPTIONS)

# Windows-specific
if(WIN32)
  target_link_libraries(${PROJECT_NAME}
    ${CMAKE_JS_LIB}
    ole32.lib
    oleaut32.lib
    shell32.lib
    shlwapi.lib
    advapi32.lib
    user32.lib
    gdi32.lib
    shcore.lib
    gdiplus.lib
    windowsapp.lib
  )
  target_compile_definitions(${PROJECT_NAME} PRIVATE
    UNICODE _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    _WIN32_WINNT=0x0A00
  )
  # DELAYLOAD needed for Electron native addons (node.exe doesn't exist as a DLL)
  target_link_libraries(${PROJECT_NAME} delayimp.lib)
  target_link_options(${PROJECT_NAME} PRIVATE "/DELAYLOAD:NODE.EXE")
endif()
